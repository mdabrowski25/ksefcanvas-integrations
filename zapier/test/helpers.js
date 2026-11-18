'use strict';

const crypto = require('crypto');
const nock = require('nock');
const zapier = require('zapier-platform-core');

const App = require('../index');

const appTester = zapier.createAppTester(App);

const TEST_API = 'https://staging-api.ksefcanvas.pl';
const LIVE_API = 'https://api.ksefcanvas.pl';

// Fake keys: tests never reach a real KSeF Canvas API (nock blocks every unmatched request).
const testAuth = { apiKey: 'kc_test_FAKEKEY000000000000' };
const liveAuth = { apiKey: 'kc_live_FAKEKEY000000000000' };

// Runs fn with KSEFCANVAS_ENVIRONMENT set to value (undefined removes it), then restores the test environment.
const withEnvironment = async (value, fn) => {
  if (value === undefined) delete process.env.KSEFCANVAS_ENVIRONMENT;
  else process.env.KSEFCANVAS_ENVIRONMENT = value;
  try {
    return await fn();
  } finally {
    process.env.KSEFCANVAS_ENVIRONMENT = 'test';
  }
};
const WEBHOOK_SECRET = 'kcwh_fake-secret-for-tests';

const api = (base = TEST_API, key = testAuth.apiKey) =>
  nock(base, { reqheaders: { authorization: `Bearer ${key}` } });

const problem = (status, code, detail, extra = {}) => [
  status,
  { type: null, title: 'Błąd', status, detail, code, traceId: '00-trace-01', ...extra },
  { 'Content-Type': 'application/problem+json' },
];

// The error Zapier receives: z.errors.Error and ThrottledError carry a JSON message.
const parseError = (error) => {
  try {
    return { name: error.name, ...JSON.parse(error.message) };
  } catch (e) {
    return { name: error.name, message: error.message };
  }
};

const sign = (secret, body, timestamp = Math.floor(Date.now() / 1000)) =>
  `t=${timestamp},v1=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

const delivery = (event, data, overrides = {}) => ({
  id: 'evt_0f1e2d3c4b5a69788796a5b4c3d2e1f0',
  type: event,
  createdAt: '2026-11-17T09:05:31+00:00',
  livemode: false,
  data,
  ...overrides,
});

// A hook bundle as Zapier builds it: headers prefixed with "Http-" and Camel-Cased, the body as raw text.
const hookBundle = (body, signature, subscribeData = { id: 'wh-1', secret: WEBHOOK_SECRET, events: ['invoice.accepted'] }) => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (signature !== undefined) headers['Http-Ksefcanvas-Signature'] = signature;
  headers['Http-Ksefcanvas-Event-Id'] = 'evt_0f1e2d3c4b5a69788796a5b4c3d2e1f0';
  return {
    authData: testAuth,
    subscribeData,
    rawRequest: { method: 'POST', querystring: '', headers, content: body },
    cleanedRequest: JSON.parse(body),
  };
};

module.exports = {
  withEnvironment,
  LIVE_API,
  TEST_API,
  WEBHOOK_SECRET,
  api,
  appTester,
  delivery,
  hookBundle,
  liveAuth,
  nock,
  parseError,
  problem,
  sign,
  testAuth,
};
