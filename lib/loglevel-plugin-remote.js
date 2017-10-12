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
      /*
      if (queue.length + sent.length >= capacity) {
        this.confirm();
      }
      */
    };
  }

  function Storage(capacity) {
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

    var persist = function persist() {
      for (;;) {
        var json = JSON.stringify(queue);
        // console.log('json', json.length);
        // console.log('capacity', capacity * 512);
        if (json.length < capacity * 512) {
          try {
            set(queueKey, json);
            break;
            // eslint-disable-next-line no-empty
          } catch (quota) {}
        }
        queue.shift();
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
        set(sentKey, JSON.stringify(sent));
        queue = [];
        persist();
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
      persist();
      _this2.confirm();
    };

    this.unshift = function (messages) {
      if (messages.length) {
        queue = messages.concat(queue);
        persist();
      }
    };
  }

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
    persist: 'default',
    capacity: 0,
    trace: ['trace', 'warn', 'error'],
    depth: 0,
    json: false,
    timestamp: function timestamp() {
      return new Date().toISOString();
    }
  };

  var hasStacktraceSupport = !!getStacktrace();

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

    loglevel = logger;

    options = assign(defaults, options);

    var authorization = 'Bearer ' + options.token;
    var contentType = options.json ? 'application/json' : 'text/plain';

    if (!options.capacity) {
      options.capacity = options.persist === 'never' ? defaultMemoryCapacity : defaultPersistCapacity;
    }

    var storage = new Storage(options.capacity);

    if (!storage.push && options.persist !== 'never') {
      options.persist = 'never';
      options.capacity = defaultMemoryCapacity;
    }

    var memory = new Memory(options.capacity, options.persist === 'never');

    var isSending = false;
    var isSuspended = false;

    var interval = options.interval;
    var receiver = options.persist === 'always' ? storage : memory;
    var sender = receiver;

    function send() {
      if (isSuspended || isSending) {
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
        if (options.json) {
          sender.content = '{"messages":[' + messages.join(',') + ']}';
        } else {
          sender.content = messages.join('\n');
        }
      }

      isSending = true;

      var xhr = new window.XMLHttpRequest();
      xhr.open('POST', options.url, true);
      xhr.setRequestHeader('Content-Type', contentType);
      if (options.token) {
        xhr.setRequestHeader('Authorization', authorization);
      }

      function suspend(successful) {
        var pause = interval;

        if (!successful) {
          interval = options.backoff(interval);
          sender.fail();
          if (options.persist !== 'never' && receiver !== storage) {
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
          sender.confirm();
          if (options.persist !== 'always') {
            receiver = memory;
          }
          suspend(true);
        } else {
          suspend();
        }
      };

      xhr.send(sender.content);
    }

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

        var message = {
          message: format(args),
          level: methodName,
          logger: loggerName || '',
          timestamp: timestamp,
          stacktrace: stacktrace
        };

        var content = options.json ? JSON.stringify(message) : '' + message.message + (message.stacktrace ? '\n' + message.stacktrace : '');

        receiver.push([content]);

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
