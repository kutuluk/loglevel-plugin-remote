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

  var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) {
    return typeof obj;
  } : function (obj) {
    return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj;
  };

  var isAssigned = false;
  var CIRCULAR_ERROR_MESSAGE = void 0;

  // https://github.com/nodejs/node/blob/master/lib/util.js
  function tryStringify(arg) {
    try {
      return JSON.stringify(arg);
    } catch (err) {
      // Populate the circular error message lazily
      if (!CIRCULAR_ERROR_MESSAGE) {
        try {
          var a = {};
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

  var format = function format(argss) {
    var args = [].concat(argss);
    var result = '';

    if (args.length > 1 && typeof args[0] === 'string') {
      var template = args.shift();
      result = template.replace(/(%?)(%([sdo]))/g, function (match, escaped, ptn, flag) {
        if (!escaped) {
          var arg = args.shift();
          var a = '';
          switch (flag) {
            case ('s', 'd'):
              a = '' + arg;
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

    args.forEach(function (arg) {
      if (result.length) result += ' ';
      switch (typeof arg === 'undefined' ? 'undefined' : _typeof(arg)) {
        case 'object':
          {
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

  var stackTrace = function stackTrace() {
    try {
      throw new Error('');
    } catch (e) {
      return e.stack;
    }
  };

  var hasStack = !!stackTrace();

  var remote = function remote(logger, options) {
    if (!logger || !logger.getLogger) {
      throw new TypeError('Argument is not a root loglevel object');
    }

    if (isAssigned) {
      throw new TypeError('You can assign a plugin only one time');
    }

    isAssigned = true;

    options = options || {};
    options.url = options.url || window.location.origin + '/logger';
    options.call = options.call || true;
    options.timeout = options.timeout || 5000;
    options.clear = options.clear || 1;
    options.trace = options.trace || ['trace', 'warn', 'error'];

    var trace = {};
    for (var i = 0; i < options.trace.length; i += 1) {
      var key = options.trace[i];
      trace[key] = true;
    }

    var queue = [];
    var isSending = false;

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

      if (!msg.trace) {
        xhr.send(format(msg.message));
        return;
      }

      var lines = msg.trace.split('\n');
      lines.splice(0, options.clear + 2);
      msg.message.push('\n' + lines.join('\n'));

      xhr.send(format(msg.message));
      msg.message.pop();
    };

    var originalFactory = logger.methodFactory;
    logger.methodFactory = function methodFactory(methodName, logLevel, loggerName) {
      var rawMethod = originalFactory(methodName, logLevel, loggerName);

      return function () {
        for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
          args[_key] = arguments[_key];
        }

        var stack = hasStack && methodName in trace ? stackTrace() : undefined;

        queue.push({ level: methodName, message: args, trace: stack });
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
