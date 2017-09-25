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

let origin = '';
if (window && window.location) {
  origin = window.location.origin || '';
}
if (!origin && document && document.location) {
  origin = document.location.origin || '';
}

const defaults = {
  url: `${origin}/logger`,
  call: true,
  timeout: 0,
  trace: ['trace', 'warn', 'error'],
  clear: 1,
  token: '',
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

  const push = (array, stack) => {
    if (stack) {
      const lines = stack.split('\n');
      lines.splice(0, options.clear + 2);
      stack = `\n${lines.join('\n')}`;
    }

    queue.push(`${format(array)}${stack}`);
  };

  const send = () => {
    if (!queue.length || isSending) {
      return;
    }

    isSending = true;
    const msg = queue.shift();
    let timeout;

    const xhr = new window.XMLHttpRequest();
    xhr.open('POST', options.url, true);
    xhr.setRequestHeader('Content-Type', 'text/plain');

    if (options.token) {
      xhr.setRequestHeader('Authorization', `Bearer ${options.token}`);
    }

    const cancel = () => {
      // if (xhr.readyState !== 4) {
      xhr.abort();
      queue.unshift(msg);
      isSending = false;
      setTimeout(send, 0);
      // }
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) {
        return;
      }

      if (xhr.status !== 200) {
        queue.unshift(msg);
      }

      isSending = false;
      if (timeout) clearTimeout(timeout);
      setTimeout(send, 0);
    };

    if (hasTimeoutSupport) {
      xhr.timeout = options.timeout;
      xhr.ontimeout = cancel;
    }

    xhr.send(msg);

    if (!hasTimeoutSupport && options.timeout) {
      timeout = setTimeout(cancel, options.timeout);
    }
  };

  const originalFactory = logger.methodFactory;
  logger.methodFactory = function methodFactory(methodName, logLevel, loggerName) {
    const rawMethod = originalFactory(methodName, logLevel, loggerName);

    return (...args) => {
      const stack = hasStack && methodName in trace ? stackTrace() : '';

      push(args, stack);
      send();

      if (options.call) rawMethod(...args);
    };
  };

  logger.setLevel(logger.getLevel());
  return logger;
};

const remote = {};
remote.apply = apply;
remote.name = 'loglevel-plugin-remote';

const save = window ? window.remote : undefined;
remote.noConflict = () => {
  if (window && window.remote === remote) {
    window.remote = save;
  }
  return remote;
};

export default remote;
