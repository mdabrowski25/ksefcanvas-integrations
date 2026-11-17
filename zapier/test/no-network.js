'use strict';

// Hard guard under nock: no test may open a real socket. nock answers mocked requests without connecting, so any
// connection attempt means a request escaped the mocks (for example to the real KSeF Canvas API) and must fail.
const net = require('net');

const GUARD = Symbol.for('ksefcanvas.tests.noNetwork');

if (!net.Socket.prototype[GUARD]) {
  const blocked = function connect(...args) {
    const target = args[0] && typeof args[0] === 'object' ? args[0].host || args[0].path : args[1] || args[0];
    const error = new Error(`Network access is blocked in tests (attempted connection to ${target}).`);
    process.nextTick(() => this.destroy(error));
    return this;
  };
  Object.defineProperty(net.Socket.prototype, GUARD, { value: true });
  net.Socket.prototype.connect = blocked;
}
