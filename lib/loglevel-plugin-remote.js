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

  var hasStackSupport = !!stackTrace();
  var queue = [];

  var isAssigned = false;

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
    suspend: 100,
    queueSize: 0,
    trace: ['trace', 'warn', 'error'],
    depth: 0,
    json: false,
    timestamp: function timestamp() {
      return new Date().toISOString();
    },
    backoff: function backoff(suspend) {
      var expFactor = 2;
      var jitter = 0.1;
      var maxSuspend = 30000;

      var newSuspend = suspend * expFactor;
      if (newSuspend > maxSuspend) {
        newSuspend = maxSuspend;
      }
      newSuspend += newSuspend * jitter * Math.random();
      return newSuspend;
    }
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

    options = merge({}, defaults, options);

    var trace = {};
    for (var i = 0; i < options.trace.length; i += 1) {
      var key = options.trace[i];
      trace[key] = true;
    }

    var authorization = 'Bearer ' + options.token;
    var contentType = options.json ? 'application/json' : 'text/plain';
    var hasTimeoutSupport = 'ontimeout' in new window.XMLHttpRequest();

    var isSending = false;
    var isSuspended = false;
    var suspendInterval = options.suspend;
    var sendingMessages = void 0;

    var send = function send() {
      if (isSuspended || isSending || !(queue.length || sendingMessages)) {
        return;
      }

      isSending = true;

      if (!sendingMessages) {
        sendingMessages = { messages: queue };
        queue = [];

        var content = '';

        if (options.json) {
          content = tryStringify({ messages: sendingMessages.messages });
        } else {
          var separator = '';
          sendingMessages.messages.forEach(function (message) {
            content += separator;
            content += message.message;
            separator = '\n';
          });
        }

        sendingMessages.content = content;
      }

      var timeout = void 0;

      var xhr = new window.XMLHttpRequest();
      xhr.open('POST', options.url, true);
      xhr.setRequestHeader('Content-Type', contentType);
      if (options.token) {
        xhr.setRequestHeader('Authorization', authorization);
      }

      var suspend = function suspend() {
        isSuspended = true;

        var up = function up() {
          isSuspended = false;
          send();
        };

        setTimeout(up, suspendInterval);

        suspendInterval = options.backoff(suspendInterval);
      };

      var cancel = function cancel() {
        isSending = false;
        xhr.abort();
        suspend();
      };

      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) {
          return;
        }

        isSending = false;
        clearTimeout(timeout);

        if (xhr.status === 200) {
          suspendInterval = options.suspend;
          sendingMessages = undefined;
          send();
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

      xhr.send(sendingMessages.content);
    };

    var originalFactory = logger.methodFactory;
    logger.methodFactory = function methodFactory(methodName, logLevel, loggerName) {
      var rawMethod = originalFactory(methodName, logLevel, loggerName);
      var hasStack = hasStackSupport && methodName in trace;

      return function () {
        for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
          args[_key] = arguments[_key];
        }

        var timestamp = void 0;

        if (options.json) {
          timestamp = options.timestamp();
        }

        if (options.queueSize && queue.length >= options.queueSize) {
          queue.shift();
        }

        var stack = hasStack ? stackTrace() : '';

        if (stack) {
          var lines = stack.split('\n');
          lines.splice(0, options.depth + 3);
          stack = lines.join('\n');
        }

        if (options.json) {
          queue.push({
            message: format(args),
            stacktrace: stack,
            timestamp: timestamp,
            level: methodName,
            logger: loggerName
          });
        } else {
          var stacktrace = stack ? '\n' + stack : '';
          queue.push({
            message: '' + format(args) + stacktrace
          });
        }

        send();

        rawMethod.apply(undefined, args);
      };
    };

    logger.setLevel(logger.getLevel());
    return logger;
  };

  var remote = { apply: apply };

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
