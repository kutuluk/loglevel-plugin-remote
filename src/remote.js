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

// Object.assign({}, ...sources) light ponyfill
function assign() {
  const target = {};
  for (let s = 0; s < arguments.length; s += 1) {
    const source = Object(arguments[s]);
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        target[key] = source[key];
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

  this.length = () => queue.length;

  this.push = (message) => {
    if (never && queue.length >= capacity) {
      queue.shift();
    }
    queue.push(message[0]);
  };

  this.send = () => {
    const sent = queue;
    queue = [];
    return sent;
  };
}

function Storage(capacity) {
  const local = window ? window.localStorage : undefined;
  const empty = { length: () => 0 };

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

  const persist = () => {
    for (;;) {
      const json = JSON.stringify(queue);
      if (json.length < capacity * 512) {
        try {
          set(queueKey, json);
          break;
          // eslint-disable-next-line no-empty
        } catch (quota) {}
      }
      queue.shift();
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

  persist();

  this.length = () => queue.length;

  this.push = (messages) => {
    if (messages.length) {
      queue = queue.concat(messages);
      persist();
    }
  };

  this.shift = (count) => {
    const shifted = queue.splice(0, count);
    persist();
    return shifted;
  };

  this.send = (count) => {
    const sent = this.shift(count);
    set(sentKey, JSON.stringify(sent));
    return sent;
  };

  this.confirm = () => {
    remove(sentKey);
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
  capacity: defaultPersistCapacity,
  trace: ['trace', 'warn', 'error'],
  depth: 0,
  json: false,
  timestamp: () => new Date().toISOString(),
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

  const authorization = `Bearer ${options.token}`;
  const contentType = options.json ? 'application/json' : 'text/plain';

  const storage = new Storage();

  if (!storage.push && options.persist !== 'never') {
    options.persist = 'never';
    options.capacity = defaultMemoryCapacity;
  }

  if (!options.capacity) {
    options.capacity = options.persist === 'never' ? defaultMemoryCapacity : defaultPersistCapacity;
  }

  const memory = new Memory(options.capacity, options.persist === 'never');

  let isSending = false;
  let isSuspended = false;

  let interval = options.interval;
  let sending = { messages: [] };
  let destination = options.persist === 'always' ? storage : memory;

  function send() {
    if (isSuspended || isSending) {
      return;
    }

    if (!sending.messages.length) {
      if (storage.length()) {
        // sending.messages = storage.send(options.capacity);
        sending.messages = storage.send(storage.length());
      } else if (memory.length()) {
        sending.messages = memory.send();
      } else {
        return;
      }
    }

    isSending = true;

    if (!sending.content) {
      if (options.json) {
        sending.content = tryStringify({ messages: sending.messages });
      } else {
        let separator = '';
        sending.content = '';
        sending.messages.forEach((message) => {
          const stacktrace = message.stacktrace ? `\n${message.stacktrace}` : '';
          sending.content += `${separator}${message.message}${stacktrace}`;
          separator = '\n';
        });
      }
    }

    const xhr = new window.XMLHttpRequest();
    xhr.open('POST', options.url, true);
    xhr.setRequestHeader('Content-Type', contentType);
    if (options.token) {
      xhr.setRequestHeader('Authorization', authorization);
    }

    function suspend(successful) {
      isSuspended = true;

      setTimeout(() => {
        isSuspended = false;
        send();
      }, interval);

      if (!successful) {
        interval = options.backoff(interval);
        if (options.persist !== 'never' && destination !== storage) {
          storage.unshift(sending.messages);
          storage.confirm();
          sending = { messages: [] };
          storage.push(memory.send());
          destination = storage;
        }
      }
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
        sending = { messages: [] };
        storage.confirm();
        if (options.persist !== 'always') {
          destination = memory;
        }
        suspend(true);
      } else {
        suspend();
      }
    };

    xhr.send(sending.content);
  }

  originalFactory = originalFactory || logger.methodFactory;

  pluginFactory = function methodFactory(methodName, logLevel, loggerName) {
    const rawMethod = originalFactory(methodName, logLevel, loggerName);
    const needStack = hasStacktraceSupport && options.trace.some(level => level === methodName);

    return (...args) => {
      const timestamp = options.timestamp();

      let stacktrace = needStack ? getStacktrace() : '';
      if (stacktrace) {
        const lines = stacktrace.split('\n');
        lines.splice(0, options.depth + 3);
        stacktrace = lines.join('\n');
      }

      destination.push([
        {
          message: format(args),
          level: methodName,
          logger: loggerName,
          timestamp,
          stacktrace,
        },
      ]);

      send();

      rawMethod(...args);
    };
  };

  logger.methodFactory = pluginFactory;
  logger.setLevel(logger.getLevel());
  return logger;
}

function disable() {
  if (!loglevel) {
    throw new Error("You can't disable a not appled plugin");
  }

  if (pluginFactory !== loglevel.methodFactory) {
    throw new Error("You can't disable a plugin after appling another plugin");
  }

  loglevel.methodFactory = originalFactory;
  loglevel.setLevel(loglevel.getLevel());
  originalFactory = undefined;
  loglevel = undefined;
}

const remote = {
  apply,
  disable,
};

const save = window ? window.remote : undefined;
remote.noConflict = () => {
  if (window && window.remote === remote) {
    window.remote = save;
  }
  return remote;
};

export default remote;
