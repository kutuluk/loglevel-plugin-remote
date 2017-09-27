# loglevel-plugin-remote
Plugin for sending [loglevel](https://github.com/pimterry/loglevel) messages to a remote log server

# Features
- Sends asynchronously and does not slow down the application
- Messages are sent one by one, so the order is maintained
- Support any server that accepts a Post request
- Support string substitutions like console and node.js (%s, %d, %j, %o)

## Installation

```sh
npm install loglevel-plugin-remote --save
```

## API

```javascript
apply(log[, options]);
```

**log** - root logger, imported from loglevel package

**options** - configuration object

```javascript
var defaults = {
  url: window.location.origin + '/logger',
  token: '',
  timeout: 0,
  trace: ['trace', 'warn', 'error'],
  depth: 0,
  format: 'text',
  timestampFormatter: function () {
    return new Date().toString();
  },
  maxQueueSize: 500,
  backoffStrategy: function (interval) {
    let doubleIt = interval  * 2
    return doubleIt > 30000 ? 30000 : doubleIt
  },
  onMessageDropped: (msg) => {},
}
```

- **url** - log server URL
- **token** - token for Bearer authentication scheme (e.g. UUID: "9fda563b-7103-4f3c-ad93-4fe0085ce75c") (see [RFC 6750](https://tools.ietf.org/html/rfc6750))
- **timeout** - timeout in milliseconds (see [MDN](https://developer.mozilla.org/docs/Web/API/XMLHttpRequest/timeout))
- **trace** - lots of levels for which to add the stack trace
- **depth** - number of following plugins (affects the number of rows to clear the stack trace)
- **format** - format message sent to log server as `text` or `json`
- **timestampFormatter** - a functions for formatting timestamp used when sending message as `json`
- **maxQueueSize** - the number of items in queue before we are throwing away the oldest message in queue.
- **backoffStrategy** - function used to calculate the next send interval.
- **onMessageDropped** - called when a message is dropped due to max queue size reached.

## Base usage

### Browser directly

Download [production version](https://raw.githubusercontent.com/kutuluk/loglevel-plugin-remote/master/dist/loglevel-plugin-remote.min.js)
and copy to your project folder
```html
<script src="loglevel.min.js"></script>
<script src="loglevel-plugin-remote.min.js"></script>

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
