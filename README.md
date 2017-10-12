# loglevel-plugin-remote

A [loglevel](https://github.com/pimterry/loglevel) plugin for sending logs to a server.

[![NPM version](https://img.shields.io/npm/v/loglevel-plugin-remote.svg?style=flat-square)](https://www.npmjs.com/package/loglevel-plugin-remote)[![Build Status](https://img.shields.io/travis/kutuluk/loglevel-plugin-remote/master.svg?style=flat-square)](https://travis-ci.org/kutuluk/loglevel-plugin-remote)

## Features

- Sends logs asynchronously with a specified frequency using only one request at a time.
- Slows the frequency of sending after a fail and restores after success.
- In the event of a failure in sending logs can be stored in the browser and sent to the server after the connection is restored or even the next time the user visits the site.
- Supports Bearer authentication scheme.
- Provides string substitutions like console and node.js (%s, %d, %j, %o).

## Installation

```sh
npm i loglevel-plugin-remote --save
```

## API

**This plugin is under active development and should be considered as an unstable. No guarantees regarding API stability are made. Backward compatibility is guaranteed only by path releases.**

#### ```apply(loglevel, options)```
This method applies the plugin to the loglevel.

#### Parameters
```loglevel``` - the root logger, imported from loglevel package

```options``` - an optional configuration object

```javascript
const defaults = {
  url: '/logger',
  token: '',
  timeout: 0,
  interval: 1000,
  backoff: (interval) => {
    const multiplier = 2;
    const jitter = 0.1;
    const limit = 30000;
    let next = interval * multiplier;
    if (next > limit) next = limit;
    next += next * jitter * Math.random();
    return next;
  },
  persist: 'default',
  capacity: 50,
  trace: ['trace', 'warn', 'error'],
  depth: 0,
  json: false,
  timestamp: () => new Date().toISOString(),
};
```

* **url** - a URL of the server logging API
* **token** - a token for Bearer authentication scheme (see [RFC 6750](https://tools.ietf.org/html/rfc6750)), e.g. [UUID](https://en.wikipedia.org/wiki/Universally_unique_identifier) or [JWT](https://jwt.io/).
* **timeout** - a timeout in milliseconds (see [XMLHttpRequest.timeout](https://developer.mozilla.org/docs/Web/API/XMLHttpRequest/timeout))
* **interval** - a time in milliseconds between sending messages. By default is 1000 (one second).
* **backoff** - a function used to increase the sending interval after each failed send. By default, it doubles the interval and adds 10% jitter. Having reached the value of 30 seconds, the interval increase stops. After successful sending, the interval will be reset to the initial value.
* **persist** - a string parameter that takes one of the following values: 'never', 'always', 'default'. This option defines the strategy for storing logs.
  * ```'never'``` Logs are stored only in memory. Highest productivity.
  * ```'always'``` Each log before sending will be stored on the [persistent storage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage). Very low productivity, used only in extreme cases, when it is necessary to guarantee the safety of logs.
  * ```'default'``` Logs will be stored on the persistent storage only if the sending fails and stops after recovery.
* **capacity**
  * if **persist** is ```'never'``` - the size of the queue in which messages are accumulated between sending. By default is 500.
  * if **persist** is not ```'never'``` - the size of the persistent storage in kilobytes. By default is 50.

In both cases overflow will delete the oldest messages. It is forbidden to set the value to 0 - in this case the default value will be used.
* **trace** - lots of levels for which to add the stack trace
* **depth** - the number of following plugins (affects the number of rows to clear the stack trace)
* **json** - when set to true, it sends messages in json format:

```json
{
    "messages": [
        {
            "message": "Message one",
            "stacktrace": "at http://localhost/test.js:11:5",
            "timestamp": "2017-05-29T12:53:46.000Z",
            "level": "info",
            "logger": ""
        },
        {
            "message": "Message two",
            "stacktrace": "at http://localhost/test.js:12:5",
            "timestamp": "2017-05-29T12:53:46.001Z",
            "level": "warn",
            "logger": ""
        }
    ]
}
```

* **timestamp** - a function that returns a timestamp and used when messages sending in json format. By default, it returns the time in the ISO format (see [ISO 8601](https://en.wikipedia.org/wiki/ISO_8601))

#### ```disable()```
This method cancels the effect of the plugin.

## Base usage

### Browser directly

```html
<script src="https://unpkg.com/loglevel/dist/loglevel.min.js"></script>
<script src="https://unpkg.com/loglevel-plugin-remote/dist/loglevel-plugin-remote.min.js"></script>

<script>
  var logger = log.noConflict();
  remote.noConflict().apply(logger);
  logger.warn('message');
</script>
```

### ES6
```javascript
import log from 'loglevel';
import remote from 'loglevel-plugin-remote';

remote.apply(log);
log.warn('message');
```

### CommonJS
```javascript
var log = require('loglevel');
var remote = require('loglevel-plugin-remote');

remote.apply(log);
log.warn('message');
```

### AMD
```javascript
define(['loglevel', 'loglevel-plugin-remote'], function(log, remote) {
  remote.apply(log);
  log.warn('message');
});
```

## Example

Code
```javascript
var log = require('loglevel');
var remote = require('loglevel-plugin-remote');

log.setLevel('trace');

remote.apply(log);

log.info('Log levels:');
log.trace('trace message');
log.debug('debug message');
log.info('info message');
log.warn('warn message');
log.error('error message');
```

Output in a log server
```
Log levels:
trace message
    at http://localhost/js/test.js:9:5
debug message
info message
warn message
    at http://localhost/js/test.js:12:5
error message
    at http://localhost/js/test.js:13:5
```

Code
```javascript
log.info('String substitutions: %% %t %s', 'one', 'two');
log.info('Number substitutions: %d %d %d %d', 16, 1e6, '16', '1e6');
```

Output in a log server
```
String substitutions: % %t one two
Number substitutions: 16 1000000 16 1000000
```

Code
```javascript
log.info('Object substitutions:');

function Rectangle(width, height) {
  this.width = width;
  this.height = height;
}
var object = new Rectangle(10, 10);
log.info('%s, %d, %o, %j', object, object, object, object, object);

var date = new Date();
log.info('date: %o', date);

var error = new Error('My error');
log.info('error: %o', error);

var string = 'My string';
log.info('string: %o', string);

var number = 123;
log.info('number: %o', number);

var bool = true;
log.info('boolean: %o', bool);

var array = [1, 2, 3];
log.info('array: %o', array);
```

Output in a log server
```
Object substitutions:
[object Object], NaN, Rectangle{"height":10,"width":10}, {"height":10,"width":10} [object Object]
date: Date<"2017-06-04T13:16:01.455Z">
error: Error{}
string: String<"My string">
number: Number<123>
boolean: Boolean<true>
array: Array[1,2,3]
```

## Multiple plugins

Code
```javascript
var log = require('loglevel');
var remote = require('loglevel-plugin-remote');
var prefix = require('loglevel-plugin-prefix');

// To clean the loglevel-plugin-prefix line in the stack-trace:
// options = { depth: 1 }
remote.apply(log, { depth: 1 });
prefix.apply(log);

var array = [1, 2, 3];
log.warn('array: %o', array);
```

Output in a log server
```
[12:53:46] WARN: array: Array[1,2,3]
    at http://localhost/js/test.js:11:5
```
