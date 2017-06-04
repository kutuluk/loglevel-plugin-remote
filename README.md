# loglevel-remote
Plugin for sending [loglevel](https://github.com/pimterry/loglevel) messages to a remote server

# Features
- Sends asynchronously and does not slow down the application
- Messages are sent one by one, so the order is maintained
- Support any server that accepts a Post request
- Support string substitutions like console and node.js (%s, %d, %j, %o)

## Installation

```sh
npm install loglevel-remote --save
```

## API

```javascript
remote(log[, options]);
```

**log** - root logger, imported from loglevel package

**options** - configuration object

```javascript
default_options = {
  url: window.location.origin
    ? window.location.origin + '/logger'
    : document.location.origin + '/logger',
  call: true,
  timeout: 5000,
  trace: ['trace', 'warn', 'error'],
  clear: 1
}
```

- **url** - URL of log server API
- **call** - if set to true, then the original loglevel method will be called
- **timeout** - number of milliseconds a request can take before automatically being terminated [MDN](https://developer.mozilla.org/docs/Web/API/XMLHttpRequest/timeout)
- **trace** - lots of levels for which to add the stack trace
- **clear** - the number of rows to clean stack trace

## Base usage

### Browser directly

Download [production version](https://raw.githubusercontent.com/kutuluk/loglevel-remote/master/dist/loglevel-remote.min.js)
and copy to your project folder
```html
<script src="loglevel.min.js"></script>
<script src="loglevel-remote.min.js"></script>

<script>
  remote(log);
  log.warn('message');
</script>
```

### ES6
```javascript

import log from 'loglevel';
import remote from 'loglevel-remote';

remote(log);
log.warn('message');
```

### CommonJS
```javascript
var log = require('loglevel');
var remote = require('loglevel-remote');
remote(log);

// or
// var log = require('loglevel-remote')(require('loglevel'));

log.warn('message');
```

### AMD
```javascript
define(['loglevel', 'loglevel-remote'], function(log, remote) {
  remote(log);
  log.warn('message');
});
```

## Example

```javascript
var log = require('loglevel');
var remote = require('loglevel-remote');

log.setLevel('trace');

remote(log);

log.info();

function Rectangle(width, height) {
  this.height = height;
  this.width = width;
}
var object = new Rectangle(10, 10);
log.info('object: %o', object);

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

log.trace('trace message');
log.debug('debug message');
log.info('info message');
log.warn('warn message');
log.error('error message');

log.info('%% %t %s', 'one', 'two');
log.info('number substitutions %d %d %d %d', 16, 1e6, '16', '1e6');
log.info('%s, %d, %o, %j', object, object, object, object, object);
```

Output
```
object: Rectangle{"height":10,"width":10}
date: Date<"2017-06-04T13:16:01.455Z">
error: Error{}
string: String<"My string">
number: Number<123>
boolean: Boolean<true>
array: Array[1,2,3]
trace message
    at http://localhost:8080/js/test.js:35:5
debug message
info message
warn message
    at http://localhost:8080/js/test.js:38:5
error message
    at http://localhost:8080/js/test.js:39:5
% %t one two
number substitutions 16 1000000 16 1000000
[object Object], NaN, Rectangle{"height":10,"width":10}, {"height":10,"width":10} [object Object]
```
