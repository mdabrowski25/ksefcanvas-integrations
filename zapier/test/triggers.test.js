'use strict';

const App = require('../index');
const samples = require('../lib/samples');
const { headerValue, verifySignature } = require('../lib/signature');
const {
  WEBHOOK_SECRET,
  api,
  appTester,
  delivery,
  hookBundle,
  parseError,
  problem,
  sign,
  testAuth,
} = require('./helpers');

const accepted = App.triggers.invoice_accepted.operation;
const rejected = App.triggers.invoice_rejected.operation;
const TARGET = 'https://hooks.zapier.com/hooks/standard/1/abc/';

const acceptedData = {
  issueId: samples.issue.id,
  draftId: samples.issue.draftId,
  invoiceNumber: samples.issue.invoiceNumber,
  state: 'Accepted',
  ksefNumber: samples.issue.ksefNumber,
  rejection: null,
};

const created = (id, events, secret) => ({
  id,
  url: TARGET,
  events,
  enabled: true,
  disabledReason: null,
  createdAt: '2026-11-17T09:00:00+00:00',
  secret,
});

describe('subscribe and unsubscribe', () => {
  it('registers the Zapier hook URL for the trigger event and keeps the id and secret', async () => {
    api()
      .post('/v1/webhooks', { url: TARGET, events: ['invoice.accepted'] })
      .reply(201, created('wh-1', ['invoice.accepted'], WEBHOOK_SECRET));

    const subscribeData = await appTester(accepted.performSubscribe, { authData: testAuth, targetUrl: TARGET });

    expect(subscribeData).toEqual({ id: 'wh-1', secret: WEBHOOK_SECRET, events: ['invoice.accepted'] });
  });

  it('subscribes the rejected trigger to invoice.rejected only', async () => {
    api()
      .post('/v1/webhooks', { url: TARGET, events: ['invoice.rejected'] })
      .reply(201, created('wh-2', ['invoice.rejected'], WEBHOOK_SECRET));

    await appTester(rejected.performSubscribe, { authData: testAuth, targetUrl: TARGET });
  });

  it('removes the webhook again when the API returns no secret', async () => {
    api().post('/v1/webhooks').reply(201, { id: 'wh-3', url: TARGET, events: ['invoice.accepted'] });
    api().delete('/v1/webhooks/wh-3').reply(204);

    const error = parseError(
      await appTester(accepted.performSubscribe, { authData: testAuth, targetUrl: TARGET }).catch((e) => e),
    );

    expect(error.code).toBe('webhook_secret_missing');
  });

  it('deletes the webhook on unsubscribe', async () => {
    api().delete('/v1/webhooks/wh-1').reply(204);

    const result = await appTester(accepted.performUnsubscribe, {
      authData: testAuth,
      targetUrl: TARGET,
      subscribeData: { id: 'wh-1', secret: WEBHOOK_SECRET },
    });

    expect(result).toEqual({});
  });

  it('treats 404 on unsubscribe as already removed', async () => {
    api().delete('/v1/webhooks/wh-1').reply(...problem(404, 'resource_not_found', 'Nie znaleziono adresu webhooka.'));

    await expect(
      appTester(accepted.performUnsubscribe, { authData: testAuth, subscribeData: { id: 'wh-1', secret: WEBHOOK_SECRET } }),
    ).resolves.toEqual({});
  });

  it('reports other unsubscribe failures', async () => {
    api().delete('/v1/webhooks/wh-1').reply(...problem(403, 'insufficient_scope', 'Ten klucz nie ma zakresu webhooks:write.'));

    const error = parseError(
      await appTester(accepted.performUnsubscribe, {
        authData: testAuth,
        subscribeData: { id: 'wh-1', secret: WEBHOOK_SECRET },
      }).catch((e) => e),
    );

    expect(error.code).toBe('insufficient_scope');
    expect(error.message).toContain('webhooks:write');
  });
});

describe('deliveries', () => {
  it('accepts a correctly signed delivery and adds the full issue', async () => {
    const body = JSON.stringify(delivery('invoice.accepted', acceptedData));
    api().get(`/v1/issues/${samples.issue.id}`).reply(200, samples.issue);

    const items = await appTester(accepted.perform, hookBundle(body, sign(WEBHOOK_SECRET, body)));

    expect(items).toEqual([
      {
        id: samples.issue.id,
        ...acceptedData,
        eventId: 'evt_0f1e2d3c4b5a69788796a5b4c3d2e1f0',
        eventType: 'invoice.accepted',
        livemode: false,
        createdAt: '2026-11-17T09:05:31+00:00',
        issue: samples.issue,
      },
    ]);
  });

  it('gives deliveries the same shape as the sample', async () => {
    const body = JSON.stringify(delivery('invoice.accepted', acceptedData));
    api().get(`/v1/issues/${samples.issue.id}`).reply(200, samples.issue);

    const [fromHook] = await appTester(accepted.perform, hookBundle(body, sign(WEBHOOK_SECRET, body)));

    expect(Object.keys(fromHook).sort()).toEqual(Object.keys(accepted.sample).sort());
  });

  it('verifies the HMAC over the raw text, so Polish characters and spacing count', async () => {
    const data = { ...acceptedData, invoiceNumber: 'FV/2026/11/Żółć' };
    const body =
      '{ "id": "evt_1", "type": "invoice.accepted", "createdAt": "2026-11-17T09:05:31+00:00", ' +
      `"livemode": false, "data": ${JSON.stringify(data)} }`;
    api().get(`/v1/issues/${samples.issue.id}`).reply(200, samples.issue);

    const items = await appTester(accepted.perform, hookBundle(body, sign(WEBHOOK_SECRET, body)));

    expect(items).toHaveLength(1);
    expect(items[0].invoiceNumber).toBe('FV/2026/11/Żółć');
  });

  it('rejects a delivery signed with another secret', async () => {
    const body = JSON.stringify(delivery('invoice.accepted', acceptedData));

    expect(await appTester(accepted.perform, hookBundle(body, sign('kcwh_someone-else', body)))).toEqual([]);
  });

  it('rejects a delivery whose body was changed after signing', async () => {
    const body = JSON.stringify(delivery('invoice.accepted', acceptedData));
    const signature = sign(WEBHOOK_SECRET, body);
    const forged = body.replace(acceptedData.invoiceNumber, 'FV/2026/11/9999');

    expect(await appTester(accepted.perform, hookBundle(forged, signature))).toEqual([]);
  });

  it('rejects an expired signature (more than 300 s old) and one from the future', async () => {
    const body = JSON.stringify(delivery('invoice.accepted', acceptedData));
    const now = Math.floor(Date.now() / 1000);

    expect(await appTester(accepted.perform, hookBundle(body, sign(WEBHOOK_SECRET, body, now - 301)))).toEqual([]);
    expect(await appTester(accepted.perform, hookBundle(body, sign(WEBHOOK_SECRET, body, now + 301)))).toEqual([]);
  });

  it('accepts a signature within the 300 s window', async () => {
    const body = JSON.stringify(delivery('invoice.accepted', acceptedData));
    const now = Math.floor(Date.now() / 1000);
    api().get(`/v1/issues/${samples.issue.id}`).reply(200, samples.issue);

    expect(await appTester(accepted.perform, hookBundle(body, sign(WEBHOOK_SECRET, body, now - 250)))).toHaveLength(1);
  });

  it('rejects a delivery without a signature, without a raw body or without a stored secret', async () => {
    const body = JSON.stringify(delivery('invoice.accepted', acceptedData));
    const noRaw = { ...hookBundle(body, sign(WEBHOOK_SECRET, body)), rawRequest: undefined };

    expect(await appTester(accepted.perform, hookBundle(body, undefined))).toEqual([]);
    expect(await appTester(accepted.perform, noRaw)).toEqual([]);
    expect(await appTester(accepted.perform, hookBundle(body, sign(WEBHOOK_SECRET, body), { id: 'wh-1' }))).toEqual([]);
  });

  it('ignores ping and event types the trigger did not subscribe to', async () => {
    const ping = JSON.stringify(delivery('ping', { message: 'KSeF Canvas webhook test' }));
    const other = JSON.stringify(delivery('invoice.rejected', { ...acceptedData, state: 'Rejected' }));

    expect(await appTester(accepted.perform, hookBundle(ping, sign(WEBHOOK_SECRET, ping)))).toEqual([]);
    expect(await appTester(accepted.perform, hookBundle(other, sign(WEBHOOK_SECRET, other)))).toEqual([]);
  });

  it('still delivers a verified event when the issue cannot be read', async () => {
    const body = JSON.stringify(delivery('invoice.accepted', acceptedData));
    api()
      .get(`/v1/issues/${samples.issue.id}`)
      .reply(...problem(403, 'insufficient_scope', 'Ten klucz nie ma zakresu invoices:read.'));

    const items = await appTester(accepted.perform, hookBundle(body, sign(WEBHOOK_SECRET, body)));

    expect(items).toHaveLength(1);
    expect(items[0].issue).toBeNull();
  });

  it('reads the signature header in any spelling Zapier may use', () => {
    expect(headerValue({ 'Http-Ksefcanvas-Signature': 'a' }, 'KsefCanvas-Signature')).toBe('a');
    expect(headerValue({ 'ksefcanvas-signature': 'b' }, 'KsefCanvas-Signature')).toBe('b');
    expect(headerValue({ HTTP_KSEFCANVAS_SIGNATURE: 'c' }, 'KsefCanvas-Signature')).toBe('c');
  });

  it('accepts any matching v1 value and nothing malformed', () => {
    const body = '{"id":"evt_1","type":"ping","data":{}}';
    const at = 1763370000;
    const header = sign('kcwh_x', body, at);

    expect(verifySignature('kcwh_x', header, body, at)).toBe(true);
    expect(verifySignature('kcwh_x', `t=${at},v1=${'0'.repeat(64)},${header.split(',')[1]}`, body, at)).toBe(true);
    expect(verifySignature('kcwh_x', `t=${at},v1=abc`, body, at)).toBe(false);
    expect(verifySignature('kcwh_x', `v1=${header.split('v1=')[1]}`, body, at)).toBe(false);
    expect(verifySignature('kcwh_x', `t=abc,${header.split(',')[1]}`, body, at)).toBe(false);
  });
});

describe('sample data', () => {
  it('lists the newest issues in the trigger state, enriched like a delivery', async () => {
    const pending = { ...samples.issueSummary, id: 'i-2', state: 'Processing' };
    const rejectedSummary = { ...samples.issueSummary, id: 'i-3', state: 'Rejected' };
    api()
      .get('/v1/issues')
      .query({ page: 1, pageSize: 10 })
      .reply(200, { items: [samples.issueSummary, pending, rejectedSummary], page: 1, pageSize: 10, total: 3 });
    api().get(`/v1/issues/${samples.issue.id}`).reply(200, samples.issue);

    const items = await appTester(accepted.performList, { authData: testAuth });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: samples.issue.id,
      issueId: samples.issue.id,
      state: 'Accepted',
      eventType: 'invoice.accepted',
      eventId: null,
      livemode: false,
      issue: samples.issue,
    });
    expect(Object.keys(items[0]).sort()).toEqual(Object.keys(accepted.sample).sort());
  });

  it('gives the rejected trigger the rejection reason', async () => {
    const rejectedSummary = { ...samples.issueSummary, state: 'Rejected', ksefNumber: null };
    api()
      .get('/v1/issues')
      .query({ page: 1, pageSize: 10 })
      .reply(200, { items: [rejectedSummary], page: 1, pageSize: 10, total: 1 });
    api().get(`/v1/issues/${samples.issue.id}`).reply(200, samples.rejectedIssue);

    const [item] = await appTester(rejected.performList, { authData: testAuth });

    expect(item.rejection).toEqual(samples.rejectedIssue.rejection);
    expect(item.eventType).toBe('invoice.rejected');
  });
});
