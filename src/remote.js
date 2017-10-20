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

function interpolate(array) {
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
            let obj = tryStringify(arg);
            if (obj[0] !== '{' && obj[0] !== '[') {
              obj = `<${obj}>`;
            }
            a = getConstructorName(arg) + obj;
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

function Storage(capacity, isJson) {
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
      const value = isJson ? `[${array.join(',')}]` : JSON.stringify(array);

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

const hasStacktraceSupport = !!getStacktrace();

let loglevel;
let originalFactory;
let pluginFactory;

function plain() {
  return {
    json: false,
    formatter(log) {
      return `[${log.timestamp}] ${log.logger ? `(${log.logger}) ` : ''}${log.level.toUpperCase()}: ${log.message}${log.stacktrace ? `\n${log.stacktrace}` : ''}`;
    },
  };
}

function json() {
  return {
    json: true,
    formatter(log) {
      delete log.levelVal;
      return log;
    },
  };
}

function setToken() {
  throw new Error("You can't set token for a not appled plugin");
}

const save = window ? window.remote : undefined;

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
  persist: 'never',
  capacity: 0,
  stacktrace: {
    levels: ['trace', 'warn', 'error'],
    depth: 3,
    excess: 0,
  },
  timestamp: () => new Date().toISOString(),
  format: plain,
};

const remote = {
  noConflict() {
    if (window && window.remote === remote) {
      window.remote = save;
    }
    return remote;
  },
  plain,
  json,
  apply(logger, options) {
    if (!logger || !logger.getLogger) {
      throw new TypeError('Argument is not a root loglevel object');
    }

    if (loglevel) {
      throw new Error('You can assign a plugin only one time');
    }

    if (!window || !window.XMLHttpRequest) return logger;

    loglevel = logger;

    const config = assign(defaults, options);
    const format = config.format();

    let authorization = `Bearer ${config.token}`;
    const contentType = format.json ? 'application/json' : 'text/plain';

    if (!config.capacity) {
      config.capacity = config.persist === 'never' ? defaultMemoryCapacity : defaultPersistCapacity;
    }

    const storage = new Storage(config.capacity, format.json);

    if (!storage.push && config.persist !== 'never') {
      config.persist = 'never';
      config.capacity = defaultMemoryCapacity;
    }

    const memory = new Memory(config.capacity, config.persist === 'never');

    let isSending = false;
    let isSuspended = false;

    let interval = config.interval;
    let receiver = config.persist === 'always' ? storage : memory;
    let sender = receiver;

    function send() {
      if (isSuspended || isSending || config.token === undefined) {
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

        const logs = sender.send();

        sender.content = format.json ? `{"logs":[${logs.join(',')}]}` : logs.join('\n');
      }

      isSending = true;

      const xhr = new window.XMLHttpRequest();
      xhr.open('POST', config.url, true);
      xhr.setRequestHeader('Content-Type', contentType);
      if (config.token) {
        xhr.setRequestHeader('Authorization', authorization);
      }

      function suspend(successful) {
        const pause = interval;

        if (!successful) {
          interval = config.backoff(interval);
          sender.fail();
          if (config.persist !== 'never' && receiver !== storage) {
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
      if (config.timeout) {
        timeout = setTimeout(() => {
          isSending = false;
          xhr.abort();
          suspend();
        }, config.timeout);
      }

      xhr.onreadystatechange = () => {
        if (xhr.readyState !== 4) {
          return;
        }

        isSending = false;
        clearTimeout(timeout);

        if (xhr.status === 200) {
          interval = config.interval;
          sender.confirm();
          if (config.persist !== 'always') {
            receiver = memory;
          }
          suspend(true);
        } else {
          if (xhr.status === 401) {
            config.token = undefined;
            loglevel.getLogger('logger').error('Authorization Failed');
          }
          suspend();
        }
      };

      xhr.send(sender.content);
    }

    originalFactory = logger.methodFactory;

    pluginFactory = function remoteMethodFactory(methodName, logLevel, loggerName) {
      const rawMethod = originalFactory(methodName, logLevel, loggerName);
      const needStack =
        hasStacktraceSupport && config.stacktrace.levels.some(level => level === methodName);
      const levelVal = loglevel.levels[methodName.toUpperCase()];

      return (...args) => {
        const timestamp = config.timestamp();

        let stacktrace = needStack ? getStacktrace() : '';
        if (stacktrace) {
          const lines = stacktrace.split('\n');
          lines.splice(0, config.stacktrace.excess + 3);
          const depth = config.stacktrace.depth;
          if (depth && lines.length !== depth + 1) {
            const shrink = lines.splice(0, depth);
            stacktrace = shrink.join('\n');
            if (lines.length) stacktrace += `\n    and ${lines.length} more`;
          } else {
            stacktrace = lines.join('\n');
          }
        }

        const log = {
          message: interpolate(args),
          level: methodName,
          levelVal,
          logger: loggerName || '',
          timestamp,
          stacktrace,
        };

        let content = '';
        if (format.json) {
          try {
            content += JSON.stringify(format.formatter(log));
          } catch (error) {
            rawMethod(...args);
            loglevel.getLogger('logger').error(error);
            return;
          }
        } else {
          content += format.formatter(log);
        }

        receiver.push([content]);
        send();

        rawMethod(...args);
      };
    };

    logger.methodFactory = pluginFactory;
    logger.setLevel(logger.getLevel());

    remote.setToken = (token) => {
      config.token = token;
      authorization = `Bearer ${token}`;
      send();
    };

    return logger;
  },
  disable() {
    if (!loglevel) {
      throw new Error("You can't disable a not appled plugin");
    }

    if (pluginFactory !== loglevel.methodFactory) {
      throw new Error("You can't disable a plugin after appling another plugin");
    }

    loglevel.methodFactory = originalFactory;
    loglevel.setLevel(loglevel.getLevel());
    loglevel = undefined;
    remote.setToken = setToken;
  },
  setToken,
};

export default remote;
