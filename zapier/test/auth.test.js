'use strict';

const App = require('../index');
const samples = require('../lib/samples');
const { LIVE_API, api, appTester, liveAuth, parseError, problem, testAuth, withEnvironment } = require('./helpers');

describe('authentication', () => {
  it('asks only for the API key: public versions use production endpoints', () => {
    expect(App.authentication.fields.map((f) => f.key)).toEqual(['apiKey']);
  });

  it('tests the key with GET /v1/key on the test environment of a development version', async () => {
    const key = { ...samples.key, prefix: 'kc_test_AbCd', environment: 'test' };
    api().get('/v1/key').reply(200, key);

    const result = await appTester(App.authentication.test, { authData: testAuth });

    expect(result.firm.name).toBe('Przykładowa Firma sp. z o.o.');
  });

  it('uses the production API unless KSEFCANVAS_ENVIRONMENT says otherwise', async () => {
    api(LIVE_API, liveAuth.apiKey).get('/v1/key').twice().reply(200, samples.key);

    await withEnvironment(undefined, () => appTester(App.authentication.test, { authData: liveAuth }));
    await withEnvironment('live', () => appTester(App.authentication.test, { authData: liveAuth }));
  });

  it('labels the connection with the firm name and NIP, marking test keys', async () => {
    const live = await appTester(App.authentication.connectionLabel, { authData: liveAuth, inputData: samples.key });
    const test = await appTester(App.authentication.connectionLabel, {
      authData: testAuth,
      inputData: { ...samples.key, environment: 'test' },
    });
    const noNip = await appTester(App.authentication.connectionLabel, {
      authData: liveAuth,
      inputData: { ...samples.key, firm: { ...samples.key.firm, nip: null } },
    });

    expect(live).toBe('Przykładowa Firma sp. z o.o. (5252248481)');
    expect(test).toBe('Przykładowa Firma sp. z o.o. (5252248481) [Test]');
    expect(noNip).toBe('Przykładowa Firma sp. z o.o.');
  });

  it('turns 401 into an auth error that asks to reconnect, without a refresh', async () => {
    api().get('/v1/key').reply(...problem(401, 'api_key_environment_mismatch', 'Klucz pochodzi z innego środowiska.'));

    const error = await appTester(App.authentication.test, { authData: testAuth }).catch((e) => e);

    expect(error.name).toBe('ExpiredAuthError');
    expect(error.message).toContain('Create a production key (kc_live_)');
    expect(error.message).toContain('[api_key_environment_mismatch]');
    expect(error.message).not.toContain('Klucz');
    expect(parseError(error).name).not.toBe('RefreshAuthError');
  });

  it('refuses an unknown KSEFCANVAS_ENVIRONMENT instead of guessing a host', async () => {
    const error = await withEnvironment('dev', () =>
      appTester(App.authentication.test, { authData: { apiKey: 'kc_test_x' } }).catch((e) => e),
    );

    expect(parseError(error)).toMatchObject({ code: 'invalid_environment' });
  });

  it('never sends the key to another host', async () => {
    const { nock } = require('./helpers');
    nock('https://example.com', { badheaders: ['authorization'] }).get('/file').reply(200, 'ok');

    await appTester(async (z) => (await z.request({ url: 'https://example.com/file' })).content, { authData: testAuth });
  });
});
