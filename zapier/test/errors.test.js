'use strict';

const App = require('../index');
const { requiredScope } = require('../lib/http');
const { api, appTester, parseError, problem, testAuth } = require('./helpers');

const createDraft = (inputData) => appTester(App.creates.create_draft.operation.perform, { authData: testAuth, inputData });

describe('error mapping', () => {
  it('shows an English summary, the code and every errors[] field and code for 422, never the Polish text', async () => {
    api()
      .post('/v1/drafts')
      .reply(
        ...problem(422, 'validation_failed', 'Szkic zawiera błędy.', {
          errors: [
            { code: 'invalid_nip', field: 'data.buyerNip', message: 'NIP nabywcy jest nieprawidłowy.' },
            { code: 'required', field: 'data.lines', message: 'Dodaj co najmniej jedną pozycję.' },
          ],
        }),
      );

    const error = parseError(await createDraft({ paymentMethod: 'Transfer' }).catch((e) => e));

    expect(error).toMatchObject({ name: 'AppError', code: 'validation_failed', status: 422 });
    expect(error.message).toBe(
      'KSeF Canvas rejected the data. [validation_failed] Fields: data.buyerNip (invalid_nip), data.lines (required). ' +
        'Trace ID: 00-trace-01.',
    );
  });

  it('names the missing scope for 403 insufficient_scope', async () => {
    api().post('/v1/drafts').reply(...problem(403, 'insufficient_scope', 'Ten klucz nie ma zakresu drafts:write.'));

    const error = parseError(await createDraft({ paymentMethod: 'Transfer' }).catch((e) => e));

    expect(error).toMatchObject({ code: 'insufficient_scope', status: 403 });
    expect(error.message).toMatch(/^This API key does not have the drafts:write scope\./);
    expect(error.message).toContain('[insufficient_scope]');
    expect(error.message).not.toContain('Ten klucz');
  });

  it('knows the scope of every route', () => {
    const base = 'https://staging-api.ksefcanvas.pl';
    expect(requiredScope('POST', `${base}/v1/webhooks`)).toBe('webhooks:write');
    expect(requiredScope('DELETE', `${base}/v1/webhooks/abc`)).toBe('webhooks:write');
    expect(requiredScope('POST', `${base}/v1/drafts/abc/issue`)).toBe('invoices:issue');
    expect(requiredScope('POST', `${base}/v1/drafts/abc/validate`)).toBe('drafts:write');
    expect(requiredScope('GET', `${base}/v1/drafts/abc`)).toBe('invoices:read');
    expect(requiredScope('GET', `${base}/v1/issues/abc/pdf`)).toBe('invoices:read');
    expect(requiredScope('GET', `${base}/v1/key`)).toBeNull();
  });

  it('suggests removing unused webhooks for 409 webhook_limit_reached', async () => {
    api()
      .post('/v1/webhooks')
      .reply(...problem(409, 'webhook_limit_reached', 'Firma może mieć najwyżej 3 adresy webhooków.'));

    const error = parseError(
      await appTester(App.triggers.invoice_accepted.operation.performSubscribe, {
        authData: testAuth,
        targetUrl: 'https://hooks.zapier.com/hooks/standard/1/abc/',
      }).catch((e) => e),
    );

    expect(error).toMatchObject({ code: 'webhook_limit_reached', status: 409 });
    expect(error.message).toContain('Remove unused webhooks in KSeF Canvas under Ustawienia → Integracje → API');
    expect(error.message).not.toContain('Firma');
  });

  it('turns 429 into a ThrottledError with the Retry-After delay', async () => {
    api()
      .get('/v1/drafts/d-1')
      .reply(429, { status: 429, code: 'rate_limited', detail: 'Zbyt wiele żądań.' }, {
        'Content-Type': 'application/problem+json',
        'Retry-After': '17',
      });

    const error = await appTester(App.creates.get_draft.operation.perform, {
      authData: testAuth,
      inputData: { draftId: 'd-1' },
    }).catch((e) => e);

    expect(error.name).toBe('ThrottledError');
    const parsed = JSON.parse(error.message);
    expect(parsed.delay).toBe(17);
    expect(parsed.message).toContain('Too many requests to KSeF Canvas.');
    expect(parsed.message).toContain('[rate_limited]');
    expect(parsed.message).not.toContain('Zbyt');
  });

  it('falls back to a status summary for unknown codes and non-JSON bodies', async () => {
    api().get('/v1/drafts/d-1').reply(502, '<html>Bad gateway</html>', { 'Content-Type': 'text/html' });

    const error = parseError(
      await appTester(App.creates.get_draft.operation.perform, { authData: testAuth, inputData: { draftId: 'd-1' } }).catch(
        (e) => e,
      ),
    );

    expect(error).toMatchObject({ code: 'http_502', status: 502 });
    expect(error.message).toMatch(/^KSeF Canvas or KSeF had a temporary problem/);
  });
});
