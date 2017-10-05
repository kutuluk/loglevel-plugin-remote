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

  function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  }

  var _createClass = function () {
    function defineProperties(target, props) {
      for (var i = 0; i < props.length; i++) {
        var descriptor = props[i];
        descriptor.enumerable = descriptor.enumerable || false;
        descriptor.configurable = true;
        if ("value" in descriptor) descriptor.writable = true;
        Object.defineProperty(target, descriptor.key, descriptor);
      }
    }

    return function (Constructor, protoProps, staticProps) {
      if (protoProps) defineProperties(Constructor.prototype, protoProps);
      if (staticProps) defineProperties(Constructor, staticProps);
      return Constructor;
    };
  }();

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
      var descriptor = Object.getOwnPropertyDescriptor(obj, 'constructor');
      if (descriptor !== undefined && typeof descriptor.value === 'function' && descriptor.value.name !== '') {
        return descriptor.value.name;
      }

      obj = Object.getPrototypeOf(obj);
    }

    return '';
  }

  function format(array) {
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
  }

  // Object.assign({}, ...sources) light ponyfill
  function assign() {
    var target = {};
    for (var s = 0; s < arguments.length; s += 1) {
      var source = Object(arguments[s]);
      for (var key in source) {
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

  var defaults = {
    url: '/logger',
    token: '',
    timeout: 0,
    interval: 100,
    backoff: function backoff(interval) {
      var multiplier = 2;
      var jitter = 0.1;
      var limit = 30000;
      var next = interval * multiplier;
      if (next > limit) next = limit;
      next += next * jitter * Math.random();
      return next;
    },
    capacity: 0,
    trace: ['trace', 'warn', 'error'],
    depth: 0,
    json: false,
    timestamp: function timestamp() {
      return new Date().toISOString();
    }
  };

  var hasStacktraceSupport = !!getStacktrace();

  // let isAssigned = false;

  var loglevel = void 0;
  var originalFactory = void 0;
  var pluginFactory = void 0;

  function apply(logger, options) {
    if (!logger || !logger.getLogger) {
      throw new TypeError('Argument is not a root loglevel object');
    }

    if (loglevel) {
      throw new Error('You can assign a plugin only one time');
    }

    if (!window || !window.XMLHttpRequest) return logger;

    // isAssigned = true;
    loglevel = logger;

    options = assign(defaults, options);

    var authorization = 'Bearer ' + options.token;
    var contentType = options.json ? 'application/json' : 'text/plain';

    var isSending = false;
    var isSuspended = false;
    var isOverflowed = false;

    var interval = options.interval;
    var queue = [];
    var sending = { messages: [] };

    var Storage = function () {
      function Storage() {
        _classCallCheck(this, Storage);

        this.storage = window.localStorage;

        /*
        let buffer = '';
        for (;;) {
          try {
            buffer += new Array(1024 * 1024).join('A'); // 2 mB (each JS character is 2 bytes)
            this.storage.quota = buffer;
          } catch (quota) {
            this.QUOTA_EXCEEDED_ERR = quota.name;
            this.storage.removeItem('quota');
            break;
          }
        }
        */
      }

      _createClass(Storage, [{
        key: 'push',
        value: function push(messages) {
          var oldMessages = JSON.parse(this.storage.messages);
          for (;;) {
            var newMessages = JSON.stringify(oldMessages.concat(messages));
            try {
              this.storage.messages = newMessages;
              break;
            } catch (quota) {
              oldMessages.splice(0, options.capacity);
            }
          }
        }
      }, {
        key: 'shift',
        value: function shift(count) {
          var messages = JSON.parse(this.storage.messages);
          var shifted = messages.splice(0, count);
          this.storage.messages = JSON.stringify(messages);
          return shifted;
        }
      }, {
        key: 'unshift',
        value: function unshift(messages) {
          var oldMessages = JSON.parse(this.storage.messages);
          var newMessages = JSON.stringify(messages.concat(oldMessages));
          try {
            this.storage.messages = newMessages;
            // eslint-disable-next-line no-empty
          } catch (ignore) {}
        }
      }]);

      return Storage;
    }();

    var storage = new Storage();

    function send() {
      if (isSuspended || isSending || !(queue.length || sending.messages.length)) {
        return;
      }

      isSending = true;

      if (!sending.messages.length) {
        if (isOverflowed) {
          sending.messages = storage.shift(options.capacity);
          if (!sending.messages.length) {
            isOverflowed = false;
            sending.messages = queue;
            queue = [];
          }
        } else {
          sending.messages = queue;
          queue = [];
        }
      } else if (isOverflowed) {
        storage.unshift(sending.messages);
        sending.messages = storage.shift(options.capacity);
      }

      if (!sending.content) {
        if (options.json) {
          sending.content = tryStringify({ messages: sending.messages });
        } else {
          var separator = '';
          sending.content = '';
          sending.messages.forEach(function (message) {
            var stacktrace = message.stacktrace ? '\n' + message.stacktrace : '';
            sending.content += '' + separator + message.message + stacktrace;
            separator = '\n';
          });
        }
      }

      var xhr = new window.XMLHttpRequest();
      xhr.open('POST', options.url, true);
      xhr.setRequestHeader('Content-Type', contentType);
      if (options.token) {
        xhr.setRequestHeader('Authorization', authorization);
      }

      function suspend(successful) {
        isSuspended = true;

        setTimeout(function () {
          isSuspended = false;
          send();
        }, interval);

        if (!successful) {
          interval = options.backoff(interval);
        }
      }

      var timeout = void 0;
      if (options.timeout) {
        timeout = setTimeout(function () {
          isSending = false;
          xhr.abort();
          suspend();
        }, options.timeout);
      }

      xhr.onreadystatechange = function () {
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

    // const originalFactory = logger.methodFactory;
    originalFactory = originalFactory || logger.methodFactory;

    pluginFactory = function methodFactory(methodName, logLevel, loggerName) {
      var rawMethod = originalFactory(methodName, logLevel, loggerName);
      var needStack = hasStacktraceSupport && options.trace.some(function (level) {
        return level === methodName;
      });

      return function () {
        for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
          args[_key] = arguments[_key];
        }

        var timestamp = options.timestamp();

        var stacktrace = needStack ? getStacktrace() : '';
        if (stacktrace) {
          var lines = stacktrace.split('\n');
          lines.splice(0, options.depth + 3);
          stacktrace = lines.join('\n');
        }

        if (isOverflowed) {
          if (options.capacity && queue.length >= options.capacity) {
            storage.push(queue);
            queue = [];
          }
        } else if (options.capacity && queue.length + sending.messages.length >= options.capacity) {
          isOverflowed = true;
          storage.push(queue);
          queue = [];
        }

        queue.push({
          message: format(args),
          level: methodName,
          logger: loggerName,
          timestamp: timestamp,
          stacktrace: stacktrace
        });

        send();

        rawMethod.apply(undefined, args);
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

  var remote = {
    apply: apply,
    disable: disable
  };

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
