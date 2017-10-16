const expect = require('chai').expect;
const loglevel = require('loglevel');
const sinon = require('sinon');

// https://stackoverflow.com/questions/11485420/how-to-mock-localstorage-in-javascript-unit-tests
function StorageMock() {
  let storage = {};

  return {
    setItem(key, value) {
      storage[key] = value || '';
    },
    getItem(key) {
      return key in storage ? storage[key] : null;
    },
    removeItem(key) {
      delete storage[key];
    },
    get length() {
      return Object.keys(storage).length;
    },
    key(i) {
      const keys = Object.keys(storage);
      return keys[i] || null;
    },
    clear() {
      storage = {};
    }
  };
}

global.window = {
  XMLHttpRequest: sinon.useFakeXMLHttpRequest(),
  localStorage: StorageMock()
};

const plugin = require('../lib/loglevel-plugin-remote');
const other = require('loglevel-plugin-mock');

loglevel.setLevel('info');

const spy = sinon.spy();

describe('API', () => {
  afterEach(() => {
    try {
      plugin.disable();
      // eslint-disable-next-line no-empty
    } catch (ignore) {}
    try {
      other.disable();
      // eslint-disable-next-line no-empty
    } catch (ignore) {}
    try {
      plugin.disable();
      // eslint-disable-next-line no-empty
    } catch (ignore) {}
    spy.reset();
  });

  it('Methods', () => {
    expect(plugin).to.have.property('apply').with.be.a('function');
    expect(plugin).to.have.property('disable').with.be.a('function');
    expect(plugin).to.have.property('noConflict').with.be.a('function');
  });

  it('Empty arguments', () => {
    expect(plugin.apply).to.throw(TypeError, 'Argument is not a root loglevel object');
  });

  it('Not root loglevel argument', () => {
    expect(() => plugin.apply(loglevel.getLogger('log'))).to.throw(
      TypeError,
      'Argument is not a root loglevel object'
    );
  });

  it('Right applying', () => {
    expect(() => plugin.apply(loglevel)).to.not.throw();
  });

  it('Reapplying should throw an exception', () => {
    plugin.apply(loglevel);

    expect(() => plugin.apply(loglevel)).to.throw(Error, 'You can assign a plugin only one time');
  });

  it('Right disabling', () => {
    plugin.apply(loglevel);

    expect(plugin.disable).to.not.throw();
  });

  it('Disabling a not appled plugin should throw an exception', () => {
    expect(plugin.disable).to.throw(Error, "You can't disable a not appled plugin");
  });

  it('Disabling after using another plugin should throw an exception', () => {
    plugin.apply(loglevel);
    other.apply(loglevel);

    expect(plugin.disable).to.throw(
      Error,
      "You can't disable a plugin after appling another plugin"
    );
  });
});

describe('Common', () => {
  it('All methods of the previous plugin should be called', () => {
    other.apply(loglevel, { method: spy });
    plugin.apply(loglevel, { persist: 'never', interval: 0 });

    loglevel.enableAll();
    loglevel.trace('trace');
    loglevel.debug('debug');
    loglevel.info('info');
    loglevel.warn('warn');
    loglevel.error('error');
    expect(spy.callCount).to.equal(5);

    plugin.disable();
    other.disable();
  });
});

describe('Requests', () => {
  let server;
  const successful = [200, { 'Content-Type': 'text/plain', 'Content-Length': 2 }, 'OK'];
  const fail = [404, {}, ''];

  const quote = '"';
  const acute = '`';
  const apos = "'";
  const bs = '\\';
  const escape = `escape-${bs}n${bs}${quote}${bs}${acute}${bs}${apos}${bs}${bs}`;

  const time = new Date().toISOString();
  const timestamp = () => time;

  function requests() {
    const result = [];
    server.requests.forEach((request) => {
      result.push(`${request.status}: ${request.requestBody.replace(/\n/g, '')}`);
    });
    return result;
  }

  function receivedPlain() {
    let result = [];
    server.requests.forEach((request) => {
      if (request.status === 200) {
        result = result.concat(request.requestBody.split('\n'));
      }
    });
    return result;
  }

  function receivedJSON() {
    let result = [];
    server.requests.forEach((request) => {
      if (request.status === 200) {
        result = result.concat(JSON.parse(request.requestBody).messages);
      }
    });
    return result;
  }

  beforeEach(() => {
    other.apply(loglevel);
    server = sinon.fakeServer.create();
    global.window.localStorage.clear();
  });

  afterEach(() => {
    plugin.disable();
    other.disable();
  });

  it('The plain log must be received', () => {
    plugin.apply(loglevel, { persist: 'never', interval: 0 });

    loglevel.info('plain');

    server.respondWith(successful);
    server.respond();

    const expected = ['plain'];

    expect(expected).to.eql(receivedPlain());
  });

  it('The json log must be received', () => {
    plugin.apply(loglevel, { json: true, persist: 'never', interval: 0, timestamp });

    loglevel.info('json');

    server.respondWith(successful);
    server.respond();

    const expected = [
      {
        message: 'json',
        level: 'info',
        logger: '',
        timestamp: time,
        stacktrace: ''
      }
    ];

    expect(expected).to.eql(receivedJSON());
  });

  it('The old and new plain logs must be received', () => {
    plugin.apply(loglevel, { persist: 'always', interval: 0 });

    server.respondWith(fail);

    const old1 = `old-1-${escape}`;

    loglevel.info(old1);
    server.respond();
    loglevel.info('old-2');
    server.respond();

    plugin.disable();
    server = sinon.fakeServer.create();

    plugin.apply(loglevel, { persist: 'always', interval: 0 });

    server.respondWith(successful);

    server.respond();

    loglevel.info('new-1');
    server.respond();
    loglevel.info('new-2');
    server.respond();

    const expected = [old1, 'old-2', 'new-1', 'new-2'];

    expect(expected).to.eql(receivedPlain());
  });

  it('The old and new json logs must be received', () => {
    plugin.apply(loglevel, { json: true, persist: 'always', interval: 0, timestamp });

    server.respondWith(fail);

    const old1 = `old-1-${escape}`;

    loglevel.info(old1);
    server.respond();
    loglevel.info('old-2');
    server.respond();

    plugin.disable();
    server = sinon.fakeServer.create();

    plugin.apply(loglevel, { json: true, persist: 'always', interval: 0, timestamp });

    server.respondWith(successful);

    server.respond();

    loglevel.info('new-1');
    server.respond();
    loglevel.info('new-2');
    server.respond();

    const expected = [
      {
        message: old1,
        level: 'info',
        logger: '',
        timestamp: time,
        stacktrace: ''
      },
      {
        message: 'old-2',
        level: 'info',
        logger: '',
        timestamp: time,
        stacktrace: ''
      },
      {
        message: 'new-1',
        level: 'info',
        logger: '',
        timestamp: time,
        stacktrace: ''
      },
      {
        message: 'new-2',
        level: 'info',
        logger: '',
        timestamp: time,
        stacktrace: ''
      }
    ];

    expect(expected).to.eql(receivedJSON());
  });

  it('Test persist:never', () => {
    plugin.apply(loglevel, { persist: 'never', capacity: 3, interval: 0 });

    server.respondWith(fail);
    loglevel.info('A');
    server.respond();
    loglevel.info('B');
    server.respond();
    loglevel.info('C');
    server.respond();
    loglevel.info('D');
    server.respond();
    server.respondWith(successful);
    loglevel.info('E');
    server.respond();
    server.respond();

    /*
                         | sent | queue |                   | sent | queue |
    ------------------------------------------------------------------------
    info(A)              |      |     A |-> send(A)         |    A |       |
    respond(A)-> fail    |    A |       |-> send(A)         |    A |       |
    info(B)              |    A |     B |  !send (sending)  |--------------|
    respond(A)-> fail    |    A |     B |-> send(A)         |    A |     B |
    info(C)              |    A |    BC |  !send (sending)  |--------------|
    respond(A)-> fail    |      |    BC |-> send(BC)        |   BC |       |
    info(D)              |   BC |     D |  !send (sending)  |--------------|
    respond(BC)-> fail   |      |    CD |-> send(CD)        |   CD |       |
    info(E)              |   CD |     E |  !send (sending)  |--------------|
    respond(CD)-> succ   |      |     E |-> send(E)         |    E |       |
    respond(E)-> succ    |      |       |  !send (empty)    |--------------|
    */

    // const expected = ['404: A', '404: A', '404: A', '404: BC', '200: CD', '200: E'];
    const expected = ['C', 'D', 'E'];

    expect(expected).to.eql(receivedPlain());
  });

  it('Test persist:never 2', () => {
    plugin.apply(loglevel, { persist: 'never', capacity: 3, interval: 0 });

    server.respondWith(successful);
    loglevel.info('A');
    loglevel.info('B');
    loglevel.info('C');
    loglevel.info('D');
    loglevel.info('E');
    loglevel.info('F');
    server.respond();
    server.respond();

    /*
                         | sent | queue |                   | sent | queue |
    ------------------------------------------------------------------------
    info(A)              |      |     A |-> send(A)         |    A |       |
    info(B)              |    A |     B |  !send (sending)  |--------------|
    info(C)              |    A |    BC |  !send (sending)  |--------------|
    info(D)              |    A |   BCD |  !send (sending)  |--------------|
    info(E)              |    A |   CDE |  !send (sending)  |--------------|
    info(F)              |    A |   DEF |  !send (sending)  |--------------|
    respond(A)->(succ)   |      |   DEF |-> send(DEF)       |  DEF |       |
    respond(DEF)->(succ) |      |       |  !send (empty)    |--------------|
    */
    const expected = ['200: A', '200: DEF'];

    expect(expected).to.eql(requests());
  });

  /*
  it('Test persist:always', () => {
    plugin.apply(loglevel, { persist: 'always', capacity: 3, interval: 0 });

    const emptyMessage = {
      message: '',
      level: 'info',
      logger: '',
      timestamp: new Date().toISOString(),
      stacktrace: ''
    };

    const emptyLength = JSON.stringify(emptyMessage).length;

    const padding = Array(Math.floor(1024 * 0.99) - emptyLength).join('A');

    const full = {
      message: `0${padding}`,
      level: 'info',
      logger: '',
      timestamp: new Date().toISOString(),
      stacktrace: ''
    };

    console.log(JSON.stringify(full).length);

    const sent = ['0', '1', '2', '3', '4'];

    server.respondWith(fail);
    sent.forEach((message, index) => {
      if (index === 4) {
        server.respondWith(successful);
      }
      loglevel.info(message + padding);
      server.respond();
    });
    server.respond();

    const expected = ['2', '3', '4'];

    let received = [];

    server.requests.forEach((request) => {
      // received.push(`${request.status}: ${request.requestBody.split('\n')}`);
      if (request.status === 200) {
        // received = received.concat(request.requestBody.split('\n'));
        received = received.concat(request.requestBody.split('\n').map(message => message[0]));
      }
    });

    console.log(received);
    expect(expected).to.eql(received);
  });
  */
});
