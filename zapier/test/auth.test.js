'use strict';

const App = require('../index');
const samples = require('../lib/samples');
const { LIVE_API, api, appTester, liveAuth, parseError, problem, testAuth } = require('./helpers');

describe('authentication', () => {
  it('tests the key with GET /v1/key on the test environment', async () => {
    const key = { ...samples.key, prefix: 'kc_test_AbCd', environment: 'test' };
    api().get('/v1/key').reply(200, key);

    const result = await appTester(App.authentication.test, { authData: testAuth });

    expect(result.firm.name).toBe('Przykładowa Firma sp. z o.o.');
  });

  it('uses the production API for the live environment and when the environment is empty', async () => {
    api(LIVE_API, liveAuth.apiKey).get('/v1/key').twice().reply(200, samples.key);

    await appTester(App.authentication.test, { authData: liveAuth });
    await appTester(App.authentication.test, { authData: { apiKey: liveAuth.apiKey } });
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
    expect(error.message).toContain('Use Production for kc_live_ keys and Test for kc_test_ keys');
    expect(error.message).toContain('KSeF Canvas: Klucz pochodzi z innego środowiska. [api_key_environment_mismatch]');
    expect(parseError(error).name).not.toBe('RefreshAuthError');
  });

  it('refuses an unknown environment instead of guessing a host', async () => {
    const error = await appTester(App.authentication.test, { authData: { apiKey: 'kc_test_x', environment: 'dev' } }).catch(
      (e) => e,
    );

    expect(parseError(error)).toMatchObject({ code: 'invalid_environment' });
  });

  it('never sends the key to another host', async () => {
    const { nock } = require('./helpers');
    nock('https://example.com', { badheaders: ['authorization'] }).get('/file').reply(200, 'ok');

    await appTester(async (z) => (await z.request({ url: 'https://example.com/file' })).content, { authData: testAuth });
  });
});
