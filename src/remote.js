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
    if (error.name === 'TypeError' && error.message === CIRCULAR_ERROR_MESSAGE) {
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

const format = function format(array) {
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
};

const merge = function merge(target) {
  for (let i = 1; i < arguments.length; i += 1) {
    for (const prop in arguments[i]) {
      if (Object.prototype.hasOwnProperty.call(arguments[i], prop)) {
        target[prop] = arguments[i][prop];
      }
    }
  }
  return target;
};

const stackTrace = () => {
  try {
    throw new Error('');
  } catch (test) {
    return test.stack;
  }
};

const hasStack = !!stackTrace();
const queue = [];

let isAssigned = false;
let isSending = false;
let isSuspended = false;

let origin = '';
if (window && window.location) {
  origin = window.location.origin || '';
}
if (!origin && document && document.location) {
  origin = document.location.origin || '';
}

const defaults = {
  url: `${origin}/logger`,
  token: '',
  timeout: 0,
  suspend: 100,
  queueSize: 0,
  trace: ['trace', 'warn', 'error'],
  depth: 0,
  json: false,
  timestamp: () => new Date().toISOString(),
  backoff: (suspend) => {
    const doubleSuspend = suspend * 2;
    return doubleSuspend > 30000 ? 30000 : doubleSuspend;
  },
  onMessageDropped: () => {},
};

const apply = function apply(logger, options) {
  if (!logger || !logger.getLogger) {
    throw new TypeError('Argument is not a root loglevel object');
  }

  if (isAssigned) {
    throw new TypeError('You can assign a plugin only one time');
  }

  if (!window || !window.XMLHttpRequest) return logger;

  isAssigned = true;
  const hasTimeoutSupport = 'ontimeout' in new window.XMLHttpRequest();

  options = merge({}, defaults, options);

  const trace = {};
  for (let i = 0; i < options.trace.length; i += 1) {
    const key = options.trace[i];
    trace[key] = true;
  }

  const authHeader = `Bearer ${options.token}`;

  const contentType = options.json ? 'application/json' : 'text/plain';

  let suspendInterval = options.suspend;

  const send = () => {
    if (!queue.length || isSending || isSuspended) {
      return;
    }

    isSending = true;
    const msg = queue.shift();
    let timeout;

    const xhr = new window.XMLHttpRequest();
    xhr.open('POST', options.url, true);
    xhr.setRequestHeader('Content-Type', contentType);

    if (options.token) {
      xhr.setRequestHeader('Authorization', authHeader);
    }

    const suspend = () => {
      isSuspended = true;

      if (!(options.queueSize && queue.length >= options.queueSize)) {
        queue.unshift(msg);
      } else {
        options.onMessageDropped(msg.message);
      }

      const up = () => {
        isSuspended = false;
        send();
      };

      setTimeout(up, suspendInterval);

      suspendInterval = options.backoff(suspendInterval);
    };

    const cancel = () => {
      isSending = false;
      xhr.abort();
      suspend();
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) {
        return;
      }

      isSending = false;
      clearTimeout(timeout);

      if (xhr.status === 200) {
        suspendInterval = options.suspend;
        setTimeout(send, 0);
      } else {
        suspend();
      }
    };

    if (hasTimeoutSupport) {
      xhr.timeout = options.timeout;
      xhr.ontimeout = cancel;
    } else if (options.timeout) {
      timeout = setTimeout(cancel, options.timeout);
    }

    if (options.json) {
      xhr.send(tryStringify(msg));
    } else {
      xhr.send(`${msg.message}${msg.stacktrace}`);
    }
  };

  const originalFactory = logger.methodFactory;
  logger.methodFactory = function methodFactory(methodName, logLevel, loggerName) {
    const rawMethod = originalFactory(methodName, logLevel, loggerName);

    return (...args) => {
      let timestamp;

      if (options.json) {
        timestamp = options.timestamp();
      }

      if (options.queueSize && queue.length >= options.queueSize) {
        const droppedMsg = queue.shift();
        options.onMessageDropped(droppedMsg.message);
      }

      let stack = hasStack && methodName in trace ? stackTrace() : '';

      if (stack) {
        const lines = stack.split('\n');
        lines.splice(0, options.depth + 3);
        stack = lines.join('\n');
      }

      if (options.json) {
        queue.push({
          message: format(args),
          stacktrace: stack,
          timestamp,
          level: methodName,
          logger: loggerName,
        });
      } else {
        queue.push({
          message: format(args),
          stacktrace: stack ? `\n${stack}` : '',
        });
      }

      send();

      rawMethod(...args);
    };
  };

  logger.setLevel(logger.getLevel());
  return logger;
};

const remote = {};
remote.apply = apply;

const save = window ? window.remote : undefined;
remote.noConflict = () => {
  if (window && window.remote === remote) {
    window.remote = save;
  }
  return remote;
};

export default remote;
