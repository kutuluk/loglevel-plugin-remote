const expect = require('chai').expect;
const loglevel = require('loglevel');
const sinon = require('sinon');

// https://stackoverflow.com/questions/11485420/how-to-mock-localstorage-in-javascript-unit-tests
function StorageMock() {
  const storage = {};

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
    }
  };
}

global.window = {
  XMLHttpRequest: sinon.useFakeXMLHttpRequest(),
  localstorage: new StorageMock()
};

const plugin = require('../lib/loglevel-plugin-remote');
const other = require('loglevel-plugin-mock');

loglevel.setLevel('info');

const spy = sinon.spy();

describe('', () => {
  beforeEach(() => {
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

  describe('API', () => {
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

  describe('Remote', () => {
    it('All methods of the previous plugin should be called', () => {
      other.apply(loglevel, { method: spy });
      plugin.apply(loglevel);

      loglevel.enableAll();
      loglevel.trace();
      loglevel.debug();
      loglevel.info();
      loglevel.warn();
      loglevel.error();
      expect(spy.callCount).to.equal(5);
    });
  });
});

describe('Requests', () => {
  beforeEach(() => {
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

  it('Message should be sended', () => {
    const xhr = sinon.useFakeXMLHttpRequest();
    const requests = [];

    xhr.onCreate = (request) => {
      requests.push(request);
    };

    plugin.apply(loglevel);
    loglevel.info('test error');

    expect(requests[0].requestBody).to.equal('test error');
  });
});
