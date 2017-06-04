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

  // https://github.com/nodejs/node/blob/master/lib/internal/util.js
  function getConstructorName(obj) {
    if (!Object.getOwnPropertyDescriptor || !Object.getPrototypeOf) {
      return Object.prototype.toString.call(obj).slice(8, -1);
    }

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

  var remote = function remote(logger, options) {
    if (!logger || !logger.getLogger) {
      throw new TypeError('Argument is not a root loglevel object');
    }

    if (isAssigned) {
      throw new TypeError('You can assign a plugin only one time');
    }

    if (!XMLHttpRequest) return logger;

    isAssigned = true;

    options = options || {};
    options.url = options.url || window.location.origin ? window.location.origin + '/logger' : document.location.origin + '/logger';
    options.call = options.call || true;
    options.timeout = options.timeout || 5000;
    options.trace = options.trace || ['trace', 'warn', 'error'];
    options.clear = options.clear || 1;

    var trace = {};
    for (var i = 0; i < options.trace.length; i += 1) {
      var key = options.trace[i];
      trace[key] = true;
    }

    var send = function send() {
      if (!queue.length || isSending) {
        return;
      }

      isSending = true;

      var msg = queue.shift();

      var xhr = new XMLHttpRequest();
      xhr.open('POST', options.url + '?r=' + Math.random(), true);
      xhr.timeout = options.timeout;
      xhr.setRequestHeader('Content-Type', 'text/plain');

      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) {
          return;
        }

        if (xhr.status !== 200) {
          queue.unshift(msg);
        }

        isSending = false;
        setTimeout(send, 0);
      };

      if (!msg.content) {
        var traceStr = '';

        if (msg.trace) {
          var lines = msg.trace.split('\n');
          lines.splice(0, options.clear + 2);
          traceStr = '\n' + lines.join('\n');
        }

        msg.content = '' + format(msg.array) + traceStr;
        msg.array = [];
      }

      xhr.send(msg.content);
    };

    var originalFactory = logger.methodFactory;
    logger.methodFactory = function methodFactory(methodName, logLevel, loggerName) {
      var rawMethod = originalFactory(methodName, logLevel, loggerName);

      return function () {
        for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
          args[_key] = arguments[_key];
        }

        var stack = hasStack && methodName in trace ? stackTrace() : undefined;

        queue.push({ array: args, trace: stack });
        send();

        if (options.call) rawMethod.apply(undefined, args);
      };
    };

    logger.setLevel(logger.getLevel());
    return logger;
  };

  exports.default = remote;
  module.exports = exports['default'];
});
