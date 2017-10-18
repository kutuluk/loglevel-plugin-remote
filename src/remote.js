const signature = 'loglevel-plugin-remote';

let CIRCULAR_ERROR_MESSAGE;

// https://github.com/nodejs/node/blob/master/lib/util.js
function tryStringify(arg) {
  try {
    return JSON.stringify(arg);
  } catch (error) {
    // Populate the circular error message lazily
    if (!CIRCULAR_ERROR_MESSAGE) {
      try {
        const a = {};
        a.a = a;
        JSON.stringify(a);
      } catch (circular) {
        CIRCULAR_ERROR_MESSAGE = circular.message;
      }
    }
    if (error.message === CIRCULAR_ERROR_MESSAGE) {
      return '[Circular]';
    }
    throw error;
  }
}

function getConstructorName(obj) {
  if (!Object.getOwnPropertyDescriptor || !Object.getPrototypeOf) {
    return Object.prototype.toString.call(obj).slice(8, -1);
  }

  // https://github.com/nodejs/node/blob/master/lib/internal/util.js
  while (obj) {
    const descriptor = Object.getOwnPropertyDescriptor(obj, 'constructor');
    if (
      descriptor !== undefined &&
      typeof descriptor.value === 'function' &&
      descriptor.value.name !== ''
    ) {
      return descriptor.value.name;
    }

    obj = Object.getPrototypeOf(obj);
  }

  return '';
}

function format(array) {
  let result = '';
  let index = 0;

  if (array.length > 1 && typeof array[0] === 'string') {
    result = array[0].replace(/(%?)(%([sdjo]))/g, (match, escaped, ptn, flag) => {
      if (!escaped) {
        index += 1;
        const arg = array[index];
        let a = '';
        switch (flag) {
          case 's':
            a += arg;
            break;
          case 'd':
            a += +arg;
            break;
          case 'j':
            a = tryStringify(arg);
            break;
          case 'o': {
            let json = tryStringify(arg);
            if (json[0] !== '{' && json[0] !== '[') {
              json = `<${json}>`;
            }
            a = getConstructorName(arg) + json;
            break;
          }
        }
        return a;
      }
      return match;
    });

    // update escaped %% values
    result = result.replace(/%{2,2}/g, '%');

    index += 1;
  }

  // arguments remaining after formatting
  if (array.length > index) {
    if (result) result += ' ';
    result += array.slice(index).join(' ');
  }

  return result;
}

// Light deep Object.assign({}, ...sources)
function assign() {
  const target = {};
  for (let s = 0; s < arguments.length; s += 1) {
    const source = Object(arguments[s]);
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        target[key] = typeof source[key] === 'object' && !Array.isArray(source[key])
          ? assign(target[key], source[key])
          : source[key];
      }
    }
  }
  return target;
}

function getStacktrace() {
  try {
    throw new Error();
  } catch (trace) {
    return trace.stack;
  }
}

function Memory(capacity, never) {
  let queue = [];
  let sent = [];

  this.length = () => queue.length;
  this.sent = () => sent.length;

  this.push = (messages) => {
    queue.push(messages[0]);
    if (never && queue.length > capacity) {
      queue.shift();
    }
  };

  this.send = () => {
    if (!sent.length) {
      sent = queue;
      queue = [];
    }
    return sent;
  };

  this.confirm = () => {
    sent = [];
    this.content = '';
  };

  this.fail = () => {
    const overflow = 1 + queue.length + sent.length - capacity;

    if (overflow > 0) {
      sent.splice(0, overflow);
      queue = sent.concat(queue);
      this.confirm();
    }
    // if (queue.length + sent.length >= capacity) this.confirm();
  };
}

function Storage(capacity, json) {
  const local = window ? window.localStorage : undefined;

  const empty = {
    length: () => 0,
    confirm: () => {},
  };

  if (!local) {
    return empty;
  }

  let get;
  let set;
  let remove;

  try {
    get = local.getItem.bind(local);
    set = local.setItem.bind(local);
    remove = local.removeItem.bind(local);
    const testKey = `${signature}-test`;
    set(testKey, testKey);
    remove(testKey);
  } catch (notsupport) {
    return empty;
  }

  /*
  let buffer = '';
  const quotaKey = `${signature}-quota`;
  for (;;) {
    try {
      buffer += new Array(1024 * 1024).join('A'); // 2 mB (each JS character is 2 bytes)
      set(quotaKey, buffer);
    } catch (quota) {
      this.QUOTA_EXCEEDED_ERR = quota.name;
      remove(quotaKey);
      break;
    }
  }
  */

  const queueKey = `${signature}-queue`;
  const sentKey = `${signature}-sent`;

  let queue = [];
  let sent = [];

  const persist = (array) => {
    array = array || queue;
    const key = array === queue ? queueKey : sentKey;

    // console.log(array === queue ? 'queue' : 'sent');

    for (;;) {
      const value = json ? `[${array.join(',')}]` : JSON.stringify(array);

      // console.log(value.length);
      // console.log(capacity * 512);
      // console.log('-');

      if (value.length < capacity * 512) {
        try {
          // console.log('set:', value.length);
          // console.log('--');
          set(key, value);
          break;
        } catch (quota) {
          if (!array.length) {
            remove(key);
            break;
          }
        }
      }
      array.shift();
    }
  };

  const sentJSON = get(sentKey);
  if (sentJSON) {
    queue = JSON.parse(sentJSON);
    remove(sentKey);
  }

  const queueJSON = get(queueKey);
  if (queueJSON) {
    queue = queue.concat(JSON.parse(queueJSON));
  }

  if (queue.length && typeof queue[0] !== 'string') {
    queue = queue.map(message => JSON.stringify(message));
  }

  persist();

  this.length = () => queue.length;
  this.sent = () => queue.sent;

  this.push = (messages) => {
    if (messages.length) {
      queue = queue.concat(messages);
      persist();
    }
  };

  this.send = () => {
    if (!sent.length) {
      sent = queue;
      queue = [];
      persist();
      persist(sent);
    }
    return sent;
  };

  this.confirm = () => {
    sent = [];
    this.content = '';
    remove(sentKey);
  };

  this.fail = () => {
    queue = sent.concat(queue);
    this.confirm();
    persist();
  };

  this.unshift = (messages) => {
    if (messages.length) {
      queue = messages.concat(queue);
      persist();
    }
  };
}

const defaultMemoryCapacity = 500;
const defaultPersistCapacity = 50;
const defaults = {
  url: '/logger',
  token: '',
  timeout: 0,
  interval: 1000,
  backoff: (interval) => {
    const multiplier = 2;
    const jitter = 0.1;
    const limit = 30000;
    let next = interval * multiplier;
    if (next > limit) next = limit;
    next += next * jitter * Math.random();
    return next;
  },
  persist: 'default',
  capacity: 0,
  stacktrace: {
    levels: ['trace', 'warn', 'error'],
    depth: 3,
    excess: 0,
  },
  json: false,
  timestamp: () => new Date().toISOString(),
  handle: 'remote',
};

const hasStacktraceSupport = !!getStacktrace();

let loglevel;
let originalFactory;
let pluginFactory;

function apply(logger, options) {
  if (!logger || !logger.getLogger) {
    throw new TypeError('Argument is not a root loglevel object');
  }

  if (loglevel) {
    throw new Error('You can assign a plugin only one time');
  }

  if (!window || !window.XMLHttpRequest) return logger;

  loglevel = logger;

  options = assign(defaults, options);

  let authorization = `Bearer ${options.token}`;
  const contentType = options.json ? 'application/json' : 'text/plain';

  if (!options.capacity) {
    options.capacity = options.persist === 'never' ? defaultMemoryCapacity : defaultPersistCapacity;
  }

  const storage = new Storage(options.capacity, options.json);

  if (!storage.push && options.persist !== 'never') {
    options.persist = 'never';
    options.capacity = defaultMemoryCapacity;
  }

  const memory = new Memory(options.capacity, options.persist === 'never');

  let isSending = false;
  let isSuspended = false;

  let interval = options.interval;
  let receiver = options.persist === 'always' ? storage : memory;
  let sender = receiver;

  function send() {
    if (isSuspended || isSending || options.token === undefined) {
      return;
    }

    if (!sender.sent()) {
      if (storage.length()) {
        sender = storage;
      } else if (memory.length()) {
        sender = memory;
      } else {
        return;
      }

      const messages = sender.send();

      sender.content = options.json ? `{"messages":[${messages.join(',')}]}` : messages.join('\n');
    }

    isSending = true;

    const xhr = new window.XMLHttpRequest();
    xhr.open('POST', options.url, true);
    xhr.setRequestHeader('Content-Type', contentType);
    if (options.token) {
      xhr.setRequestHeader('Authorization', authorization);
    }

    function suspend(successful) {
      const pause = interval;

      if (!successful) {
        interval = options.backoff(interval);
        sender.fail();
        if (options.persist !== 'never' && receiver !== storage) {
          storage.push(memory.send());
          memory.confirm();
          storage.push(memory.send());
          memory.confirm();
          receiver = storage;
        }
      }

      if (pause) {
        isSuspended = true;
        setTimeout(() => {
          isSuspended = false;
          send();
        }, pause);
      } else send();
    }

    let timeout;
    if (options.timeout) {
      timeout = setTimeout(() => {
        isSending = false;
        xhr.abort();
        suspend();
      }, options.timeout);
    }

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) {
        return;
      }

      isSending = false;
      clearTimeout(timeout);

      if (xhr.status === 200) {
        interval = options.interval;
        sender.confirm();
        if (options.persist !== 'always') {
          receiver = memory;
        }
        suspend(true);
      } else {
        suspend();
      }
    };

    xhr.send(sender.content);
  }

  originalFactory = logger.methodFactory;

  pluginFactory = function methodFactory(methodName, logLevel, loggerName) {
    const rawMethod = originalFactory(methodName, logLevel, loggerName);
    const needStack =
      hasStacktraceSupport && options.stacktrace.levels.some(level => level === methodName);

    return (...args) => {
      const timestamp = options.timestamp();

      let stacktrace = needStack ? getStacktrace() : '';
      if (stacktrace) {
        const lines = stacktrace.split('\n');
        lines.splice(0, options.stacktrace.excess + 3);
        const depth = options.stacktrace.depth;
        if (depth && lines.length !== depth + 1) {
          const shrink = lines.splice(0, depth);
          stacktrace = shrink.join('\n');
          if (lines.length) stacktrace += `\n    and ${lines.length} more`;
        } else {
          stacktrace = lines.join('\n');
        }
      }

      const message = {
        message: format(args),
        level: methodName,
        logger: loggerName || '',
        timestamp,
        stacktrace,
      };

      const content = options.json
        ? JSON.stringify(message)
        : `${message.message}${message.stacktrace ? `\n${message.stacktrace}` : ''}`;

      receiver.push([content]);
      send();

      rawMethod(...args);
    };
  };

  logger.methodFactory = pluginFactory;
  logger.setLevel(logger.getLevel());

  if (!logger.plugins) logger.plugins = {};

  logger.plugins[options.handle] = {
    setToken: (token) => {
      options.token = token;
      authorization = `Bearer ${token}`;
      send();
    },
    disable: () => {
      if (pluginFactory !== loglevel.methodFactory) {
        throw new Error("You can't disable a plugin after appling another plugin");
      }

      loglevel.methodFactory = originalFactory;
      loglevel.setLevel(loglevel.getLevel());
      loglevel = undefined;
      delete logger.plugins[options.handle];
    },
  };

  return logger;
}

const save = window ? window.remote : undefined;

const remote = {
  apply,
  noConflict: () => {
    if (window && window.remote === remote) {
      window.remote = save;
    }
    return remote;
  },
};

export default remote;
