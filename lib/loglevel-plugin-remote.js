(function (global, factory) {
  if (typeof define === "function" && define.amd) {
    define(['module', 'exports'], factory);
  } else if (typeof exports !== "undefined") {
    factory(module, exports);
  } else {
    var mod = {
      exports: {}
    };
    factory(mod, mod.exports);
    global.remote = mod.exports;
  }
})(this, function (module, exports) {
  'use strict';

  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  var CIRCULAR_ERROR_MESSAGE = void 0;

  // https://github.com/nodejs/node/blob/master/lib/util.js
  function tryStringify(arg) {
    try {
      return JSON.stringify(arg);
    } catch (error) {
      // Populate the circular error message lazily
      if (!CIRCULAR_ERROR_MESSAGE) {
        try {
          var a = {};
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
      var descriptor = Object.getOwnPropertyDescriptor(obj, 'constructor');
      if (descriptor !== undefined && typeof descriptor.value === 'function' && descriptor.value.name !== '') {
        return descriptor.value.name;
      }

      obj = Object.getPrototypeOf(obj);
    }

    return '';
  }

  var format = function format(array) {
    var result = '';
    var index = 0;

    if (array.length > 1 && typeof array[0] === 'string') {
      result = array[0].replace(/(%?)(%([sdjo]))/g, function (match, escaped, ptn, flag) {
        if (!escaped) {
          index += 1;
          var arg = array[index];
          var a = '';
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
            case 'o':
              {
                var json = tryStringify(arg);
                if (json[0] !== '{' && json[0] !== '[') {
                  json = '<' + json + '>';
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

  var merge = function merge(target) {
    for (var i = 1; i < arguments.length; i += 1) {
      for (var prop in arguments[i]) {
        if (Object.prototype.hasOwnProperty.call(arguments[i], prop)) {
          target[prop] = arguments[i][prop];
        }
      }
    }
    return target;
  };

  var stackTrace = function stackTrace() {
    try {
      throw new Error('');
    } catch (test) {
      return test.stack;
    }
  };

  var hasStack = !!stackTrace();
  var queue = [];
  var isAssigned = false;
  var isSending = false;
  var sendInterval = 1;

  var origin = '';
  if (window && window.location) {
    origin = window.location.origin || '';
  }
  if (!origin && document && document.location) {
    origin = document.location.origin || '';
  }

  var defaults = {
    url: origin + '/logger',
    token: '',
    timeout: 0,
    trace: ['trace', 'warn', 'error'],
    depth: 0,
    format: 'text',
    timestampFormatter: function timestampFormatter() {
      return new Date().toString();
    },
    maxQueueSize: 500,
    backoffStrategy: function backoffStrategy(interval) {
      var doubleIt = interval * 2;
      return doubleIt > 30000 ? 30000 : doubleIt;
    },
    onMessageDropped: function onMessageDropped() {}
  };

  var apply = function apply(logger, options) {
    if (!logger || !logger.getLogger) {
      throw new TypeError('Argument is not a root loglevel object');
    }

    if (isAssigned) {
      throw new TypeError('You can assign a plugin only one time');
    }

    if (!window || !window.XMLHttpRequest) return logger;

    isAssigned = true;
    var hasTimeoutSupport = 'ontimeout' in new window.XMLHttpRequest();

    options = merge({}, defaults, options);

    var trace = {};
    for (var i = 0; i < options.trace.length; i += 1) {
      var key = options.trace[i];
      trace[key] = true;
    }

    var push = function push(array, stack, logLevelName, logLevel, loggerName) {
      if (stack) {
        var lines = stack.split('\n');
        lines.splice(0, options.depth + 3);
        stack = '\n' + lines.join('\n');
      }

      queue.push({
        timestamp: options.timestampFormatter(),
        logLevelName: logLevelName,
        logLevel: logLevel,
        loggerName: loggerName,
        message: '' + format(array),
        args: array,
        stacktrace: stack
      });
    };

    var send = function send() {
      if (!queue.length || isSending) {
        return;
      }

      isSending = true;
      var msg = queue.shift();
      var timeout = void 0;

      var xhr = new window.XMLHttpRequest();
      xhr.open('POST', options.url, true);
      xhr.setRequestHeader('Content-Type', 'text/plain');

      if (options.token) {
        xhr.setRequestHeader('Authorization', 'Bearer ' + options.token);
      }

      var cancel = function cancel() {
        // if (xhr.readyState !== 4) {
        xhr.abort();
        queue.unshift(msg);
        isSending = false;
        setTimeout(send, sendInterval);
        // }
      };

      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) {
          return;
        }

        if (xhr.status !== 200) {
          var queueMaxSizeReached = queue.length >= options.maxQueueSize;
          var queueEmptyAndDisabled = options.maxQueueSize === 0 && queue.length === 0;
          if (!queueMaxSizeReached || queueEmptyAndDisabled) {
            queue.unshift(msg);
          } else if (options.onMessageDropped) {
            options.onMessageDropped(msg);
          }
          sendInterval = options.backoffStrategy(sendInterval);
        } else {
          sendInterval = 1;
        }

        isSending = false;
        if (timeout) clearTimeout(timeout);
        setTimeout(send, sendInterval);
      };

      if (hasTimeoutSupport) {
        xhr.timeout = options.timeout;
        xhr.ontimeout = cancel;
      }

      if (options.format === 'json') {
        xhr.send(tryStringify(msg));
      } else {
        xhr.send('' + msg.message + msg.stacktrace);
      }

      if (!hasTimeoutSupport && options.timeout) {
        timeout = setTimeout(cancel, options.timeout);
      }
    };

    var originalFactory = logger.methodFactory;
    logger.methodFactory = function methodFactory(methodName, logLevel, loggerName) {
      var rawMethod = originalFactory(methodName, logLevel, loggerName);

      return function () {
        for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
          args[_key] = arguments[_key];
        }

        var stack = hasStack && methodName in trace ? stackTrace() : '';

        if (queue.length !== 0 && queue.length >= options.maxQueueSize) {
          var droppedMsg = queue.shift();
          if (options.onMessageDropped) {
            options.onMessageDropped(droppedMsg);
          }
        }

        push(args, stack, methodName, logLevel, loggerName);
        send();

        rawMethod.apply(undefined, args);
      };
    };

    logger.setLevel(logger.getLevel());
    return logger;
  };

  var remote = {};
  remote.apply = apply;
  remote.name = 'loglevel-plugin-remote';

  var save = window ? window.remote : undefined;
  remote.noConflict = function () {
    if (window && window.remote === remote) {
      window.remote = save;
    }
    return remote;
  };

  exports.default = remote;
  module.exports = exports['default'];
});
