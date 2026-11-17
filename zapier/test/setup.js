'use strict';

const nock = require('nock');

// Jest gives every test file its own nock module, but the HTTP interceptor is process-wide: each file activates its
// own nock and restores it at the end, so the next file's nock can take over. Never re-enable real connections.
beforeAll(() => {
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
  // z.console.log writes to the console in tests; keep the output readable.
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  const pending = nock.pendingMocks();
  nock.cleanAll();
  if (pending.length) throw new Error(`Unused HTTP mocks: ${pending.join(', ')}`);
});

afterAll(() => {
  nock.cleanAll();
  nock.restore();
});
