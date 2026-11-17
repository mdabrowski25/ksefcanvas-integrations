'use strict';

const https = require('https');
const nock = require('nock');

describe('test isolation', () => {
  it('blocks a real connection even when nock is not intercepting', async () => {
    nock.restore();
    try {
      const error = await new Promise((resolve) => {
        https
          .get('https://staging-api.ksefcanvas.pl/v1/key', () => resolve(new Error('the request reached the network')))
          .on('error', resolve);
      });
      expect(error.message).toMatch(/^Network access is blocked in tests/);
    } finally {
      nock.activate();
    }
  });
});
