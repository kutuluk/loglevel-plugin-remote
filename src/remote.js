let isAssigned = false;
let CIRCULAR_ERROR_MESSAGE;

// https://github.com/nodejs/node/blob/master/lib/util.js
function tryStringify(arg) {
  try {
    return JSON.stringify(arg);
  } catch (err) {
    // Populate the circular error message lazily
    if (!CIRCULAR_ERROR_MESSAGE) {
      try {
        const a = {};
        a.a = a;
        JSON.stringify(a);
      } catch (e) {
        CIRCULAR_ERROR_MESSAGE = e.message;
      }
    }
    if (err.name === 'TypeError' && err.message === CIRCULAR_ERROR_MESSAGE) return '[Circular]';
    throw err;
  }
}

function getClass(obj) {
  return {}.toString.call(obj).slice(8, -1);
}

const format = function format(argss) {
  const args = [].concat(argss);
  let result = '';

  if (args.length > 1 && typeof args[0] === 'string') {
    const template = args.shift();
    result = template.replace(/(%?)(%([sdo]))/g, (match, escaped, ptn, flag) => {
      if (!escaped) {
        const arg = args.shift();
        let a = '';
        switch (flag) {
          case ('s', 'd'):
            a = `${arg}`;
            break;
          case 'o':
            a = tryStringify(arg);
            break;
        }
        return a;
      }
      return match;
    });
  }

  // arguments remain after formatting
  /*
  if (args.length) {
    result += ` ${args.join(' ')}`;
  }
  */

  args.forEach((arg) => {
    if (result.length) result += ' ';
    switch (typeof arg) {
      case 'object': {
        result += getClass(arg);
        result += tryStringify(arg);
        break;
      }

      default:
        result += arg;
        break;
    }
  });

  // update escaped %% values
  result = result.replace(/%{2,2}/g, '%');

  return result;
};

const stackTrace = () => {
  try {
    throw new Error('');
  } catch (e) {
    return e.stack;
  }
};

const hasStack = !!stackTrace();

const remote = function remote(logger, options) {
  if (!logger || !logger.getLogger) {
    throw new TypeError('Argument is not a root loglevel object');
  }

  if (isAssigned) {
    throw new TypeError('You can assign a plugin only one time');
  }

  isAssigned = true;

  options = options || {};
  options.url = options.url || `${window.location.origin}/logger`;
  options.call = options.call || true;
  options.timeout = options.timeout || 5000;
  options.clear = options.clear || 1;
  options.trace = options.trace || ['trace', 'warn', 'error'];

  const trace = {};
  for (let i = 0; i < options.trace.length; i += 1) {
    const key = options.trace[i];
    trace[key] = true;
  }

  const queue = [];
  let isSending = false;

  const send = function send() {
    if (!queue.length || isSending) {
      return;
    }

    isSending = true;

    const msg = queue.shift();

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${options.url}?r=${Math.random()}`, true);
    xhr.timeout = options.timeout;
    xhr.setRequestHeader('Content-Type', 'text/plain');

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) {
        return;
      }

      if (xhr.status !== 200) {
        queue.unshift(msg);
      }

      isSending = false;
      setTimeout(send, 0);
    };

    if (!msg.trace) {
      xhr.send(format(msg.message));
      return;
    }

    const lines = msg.trace.split('\n');
    lines.splice(0, options.clear + 2);
    msg.message.push(`\n${lines.join('\n')}`);

    xhr.send(format(msg.message));
    msg.message.pop();
  };

  const originalFactory = logger.methodFactory;
  logger.methodFactory = function methodFactory(methodName, logLevel, loggerName) {
    const rawMethod = originalFactory(methodName, logLevel, loggerName);

    return (...args) => {
      const stack = hasStack && methodName in trace ? stackTrace() : undefined;

      queue.push({ level: methodName, message: args, trace: stack });
      send();

      if (options.call) rawMethod(...args);
    };
  };

  logger.setLevel(logger.getLevel());
  return logger;
};

export default remote;
