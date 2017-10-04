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

const defaults = {
  url: '/logger',
  token: '',
  timeout: 0,
  interval: 100,
  backoff: (interval) => {
    const multiplier = 2;
    const jitter = 0.1;
    const limit = 30000;
    let next = interval * multiplier;
    if (next > limit) next = limit;
    next += next * jitter * Math.random();
    return next;
  },
  capacity: 0,
  trace: ['trace', 'warn', 'error'],
  depth: 0,
  json: false,
  timestamp: () => new Date().toISOString(),
};

const hasStacktraceSupport = !!getStacktrace();
let isAssigned = false;

function apply(logger, options) {
  if (!logger || !logger.getLogger) {
    throw new TypeError('Argument is not a root loglevel object');
  }

  if (isAssigned) {
    throw new TypeError('You can assign a plugin only one time');
  }

  if (!window || !window.XMLHttpRequest) return logger;

  isAssigned = true;

  options = assign(defaults, options);

  const authorization = `Bearer ${options.token}`;
  const contentType = options.json ? 'application/json' : 'text/plain';

  let isSending = false;
  let isSuspended = false;
  let interval = options.interval;
  let queue = [];
  let sending = { messages: [] };

  function send() {
    if (isSuspended || isSending || !(queue.length || sending.messages.length)) {
      return;
    }

    isSending = true;

    if (!sending.messages.length) {
      sending.messages = queue;
      queue = [];
    }

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
        suspend(true);
      } else {
        suspend();
      }
    };

    xhr.send(sending.content);
  }

  const originalFactory = logger.methodFactory;
  logger.methodFactory = function methodFactory(methodName, logLevel, loggerName) {
    const rawMethod = originalFactory(methodName, logLevel, loggerName);
    const needStack = hasStacktraceSupport && options.trace.some(level => level === methodName);

    return (...args) => {
      if (options.capacity && queue.length + sending.messages.length >= options.capacity) {
        if (sending.messages.length) {
          sending.messages.shift();
          sending.content = '';
        } else {
          queue.shift();
        }
      }

      const timestamp = options.timestamp();

      let stacktrace = needStack ? getStacktrace() : '';
      if (stacktrace) {
        const lines = stacktrace.split('\n');
        lines.splice(0, options.depth + 3);
        stacktrace = lines.join('\n');
      }

      queue.push({
        message: format(args),
        level: methodName,
        logger: loggerName,
        timestamp,
        stacktrace,
      });

      send();

      rawMethod(...args);
    };
  };

  logger.setLevel(logger.getLevel());
  return logger;
}

const remote = { apply };

const save = window ? window.remote : undefined;
remote.noConflict = () => {
  if (window && window.remote === remote) {
    window.remote = save;
  }
  return remote;
};

export default remote;
