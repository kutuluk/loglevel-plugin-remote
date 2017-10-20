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

  var signature = 'loglevel-plugin-remote';

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

  function interpolate(array) {
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
                var obj = tryStringify(arg);
                if (obj[0] !== '{' && obj[0] !== '[') {
                  obj = '<' + obj + '>';
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
    var target = {};
    for (var s = 0; s < arguments.length; s += 1) {
      var source = Object(arguments[s]);
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          target[key] = _typeof(source[key]) === 'object' && !Array.isArray(source[key]) ? assign(target[key], source[key]) : source[key];
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
    var _this = this;

    var queue = [];
    var sent = [];

    this.length = function () {
      return queue.length;
    };
    this.sent = function () {
      return sent.length;
    };

    this.push = function (messages) {
      queue.push(messages[0]);
      if (never && queue.length > capacity) {
        queue.shift();
      }
    };

    this.send = function () {
      if (!sent.length) {
        sent = queue;
        queue = [];
      }
      return sent;
    };

    this.confirm = function () {
      sent = [];
      _this.content = '';
    };

    this.fail = function () {
      var overflow = 1 + queue.length + sent.length - capacity;

      if (overflow > 0) {
        sent.splice(0, overflow);
        queue = sent.concat(queue);
        _this.confirm();
      }
      // if (queue.length + sent.length >= capacity) this.confirm();
    };
  }

  function Storage(capacity, isJson) {
    var _this2 = this;

    var local = window ? window.localStorage : undefined;

    var empty = {
      length: function length() {
        return 0;
      },
      confirm: function confirm() {}
    };

    if (!local) {
      return empty;
    }

    var get = void 0;
    var set = void 0;
    var remove = void 0;

    try {
      get = local.getItem.bind(local);
      set = local.setItem.bind(local);
      remove = local.removeItem.bind(local);
      var testKey = signature + '-test';
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

    var queueKey = signature + '-queue';
    var sentKey = signature + '-sent';

    var queue = [];
    var sent = [];

    var persist = function persist(array) {
      array = array || queue;
      var key = array === queue ? queueKey : sentKey;

      // console.log(array === queue ? 'queue' : 'sent');

      for (;;) {
        var value = isJson ? '[' + array.join(',') + ']' : JSON.stringify(array);

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

    var sentJSON = get(sentKey);
    if (sentJSON) {
      queue = JSON.parse(sentJSON);
      remove(sentKey);
    }

    var queueJSON = get(queueKey);
    if (queueJSON) {
      queue = queue.concat(JSON.parse(queueJSON));
    }

    if (queue.length && typeof queue[0] !== 'string') {
      queue = queue.map(function (message) {
        return JSON.stringify(message);
      });
    }

    persist();

    this.length = function () {
      return queue.length;
    };
    this.sent = function () {
      return queue.sent;
    };

    this.push = function (messages) {
      if (messages.length) {
        queue = queue.concat(messages);
        persist();
      }
    };

    this.send = function () {
      if (!sent.length) {
        sent = queue;
        queue = [];
        persist();
        persist(sent);
      }
      return sent;
    };

    this.confirm = function () {
      sent = [];
      _this2.content = '';
      remove(sentKey);
    };

    this.fail = function () {
      queue = sent.concat(queue);
      _this2.confirm();
      persist();
    };

    this.unshift = function (messages) {
      if (messages.length) {
        queue = messages.concat(queue);
        persist();
      }
    };
  }

  var hasStacktraceSupport = !!getStacktrace();

  var loglevel = void 0;
  var originalFactory = void 0;
  var pluginFactory = void 0;

  function plain() {
    return {
      json: false,
      formatter: function formatter(log) {
        return '[' + log.timestamp + '] ' + (log.logger ? '(' + log.logger + ') ' : '') + log.level.toUpperCase() + ': ' + log.message + (log.stacktrace ? '\n' + log.stacktrace : '');
      }
    };
  }

  function json() {
    return {
      json: true,
      formatter: function formatter(log) {
        delete log.levelVal;
        return log;
      }
    };
  }

  var save = window ? window.remote : undefined;

  var defaultMemoryCapacity = 500;
  var defaultPersistCapacity = 50;
  var defaults = {
    url: '/logger',
    token: '',
    timeout: 0,
    interval: 1000,
    backoff: function backoff(interval) {
      var multiplier = 2;
      var jitter = 0.1;
      var limit = 30000;
      var next = interval * multiplier;
      if (next > limit) next = limit;
      next += next * jitter * Math.random();
      return next;
    },
    persist: 'never',
    capacity: 0,
    stacktrace: {
      levels: ['trace', 'warn', 'error'],
      depth: 3,
      excess: 0
    },
    timestamp: function timestamp() {
      return new Date().toISOString();
    },
    format: plain
  };

  var remote = {
    noConflict: function noConflict() {
      if (window && window.remote === remote) {
        window.remote = save;
      }
      return remote;
    },

    plain: plain,
    json: json,
    apply: function apply(logger, options) {
      if (!logger || !logger.getLogger) {
        throw new TypeError('Argument is not a root loglevel object');
      }

      if (loglevel) {
        throw new Error('You can assign a plugin only one time');
      }

      if (!window || !window.XMLHttpRequest) return logger;

      loglevel = logger;

      var config = assign(defaults, options);
      var format = config.format();

      var authorization = 'Bearer ' + config.token;
      var contentType = config.json ? 'application/json' : 'text/plain';

      if (!config.capacity) {
        config.capacity = config.persist === 'never' ? defaultMemoryCapacity : defaultPersistCapacity;
      }

      var storage = new Storage(config.capacity, format.json);

      if (!storage.push && config.persist !== 'never') {
        config.persist = 'never';
        config.capacity = defaultMemoryCapacity;
      }

      var memory = new Memory(config.capacity, config.persist === 'never');

      var isSending = false;
      var isSuspended = false;

      var interval = config.interval;
      var receiver = config.persist === 'always' ? storage : memory;
      var sender = receiver;

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

          var messages = sender.send();

          sender.content = format.json ? '{"logs":[' + messages.join(',') + ']}' : messages.join('\n');
        }

        isSending = true;

        var xhr = new window.XMLHttpRequest();
        xhr.open('POST', config.url, true);
        xhr.setRequestHeader('Content-Type', contentType);
        if (config.token) {
          xhr.setRequestHeader('Authorization', authorization);
        }

        function suspend(successful) {
          var pause = interval;

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
            setTimeout(function () {
              isSuspended = false;
              send();
            }, pause);
          } else send();
        }

        var timeout = void 0;
        if (config.timeout) {
          timeout = setTimeout(function () {
            isSending = false;
            xhr.abort();
            suspend();
          }, config.timeout);
        }

        xhr.onreadystatechange = function () {
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
        var rawMethod = originalFactory(methodName, logLevel, loggerName);
        var needStack = hasStacktraceSupport && config.stacktrace.levels.some(function (level) {
          return level === methodName;
        });
        var levelVal = loglevel.levels[methodName.toUpperCase()];

        return function () {
          for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
            args[_key] = arguments[_key];
          }

          var timestamp = config.timestamp();

          var stacktrace = needStack ? getStacktrace() : '';
          if (stacktrace) {
            var lines = stacktrace.split('\n');
            lines.splice(0, config.stacktrace.excess + 3);
            var depth = config.stacktrace.depth;
            if (depth && lines.length !== depth + 1) {
              var shrink = lines.splice(0, depth);
              stacktrace = shrink.join('\n');
              if (lines.length) stacktrace += '\n    and ' + lines.length + ' more';
            } else {
              stacktrace = lines.join('\n');
            }
          }

          var log = {
            message: interpolate(args),
            level: methodName,
            levelVal: levelVal,
            logger: loggerName || '',
            timestamp: timestamp,
            stacktrace: stacktrace
          };

          var content = '';
          if (format.json) {
            try {
              content += JSON.stringify(format.formatter(log));
            } catch (error) {
              rawMethod.apply(undefined, args);
              loglevel.getLogger('logger').error(error);
              return;
            }
          } else {
            content += format.formatter(log);
          }

          receiver.push([content]);
          send();

          rawMethod.apply(undefined, args);
        };
      };

      logger.methodFactory = pluginFactory;
      logger.setLevel(logger.getLevel());

      remote.setToken = function (token) {
        config.token = token;
        authorization = 'Bearer ' + token;
        send();
      };

      return logger;
    },
    disable: function disable() {
      if (!loglevel) {
        throw new Error("You can't disable a not appled plugin");
      }

      if (pluginFactory !== loglevel.methodFactory) {
        throw new Error("You can't disable a plugin after appling another plugin");
      }

      loglevel.methodFactory = originalFactory;
      loglevel.setLevel(loglevel.getLevel());
      loglevel = undefined;
      remote.setToken = function () {};
    },
    setToken: function setToken() {}
  };

  exports.default = remote;
  module.exports = exports['default'];
});
