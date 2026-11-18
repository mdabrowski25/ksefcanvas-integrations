'use strict';

// Instant triggers on REST hooks: POST /v1/webhooks when a Zap turns on, DELETE when it turns off.

const { environment, throwForProblem } = require('../lib/http');
const { headerValue, verifySignature } = require('../lib/signature');
const samples = require('../lib/samples');

const SAMPLE_PAGE_SIZE = 10;

const performSubscribe = (event) => async (z, bundle) => {
  const response = await z.request({
    method: 'POST',
    url: '/v1/webhooks',
    body: { url: bundle.targetUrl, events: [event] },
  });
  const { id, secret, events } = response.data || {};
  if (!id || !secret) {
    // Without the secret no delivery could be verified: remove the address again so it does not hold one of the firm's 3.
    if (id) {
      await z.request({ method: 'DELETE', url: `/v1/webhooks/${encodeURIComponent(id)}`, skipThrowForStatus: true });
    }
    throw new z.errors.Error(
      'KSeF Canvas did not return the webhook signing secret, so this trigger cannot verify deliveries. Try turning the Zap on again.',
      'webhook_secret_missing',
      502,
    );
  }
  return { id, secret, events: Array.isArray(events) ? events : [event] };
};

const performUnsubscribe = async (z, bundle) => {
  const id = bundle.subscribeData && bundle.subscribeData.id;
  if (!id) return {};
  const response = await z.request({
    method: 'DELETE',
    url: `/v1/webhooks/${encodeURIComponent(id)}`,
    skipThrowForStatus: true,
  });
  // 404: already removed (by the owner in the app, or by an earlier unsubscribe).
  if (response.status !== 404) await throwForProblem(z, response);
  return {};
};

const fetchIssue = async (z, issueId) => {
  const response = await z.request({ url: `/v1/issues/${encodeURIComponent(issueId)}` });
  return response.data;
};

const toItem = ({ data, eventId, eventType, livemode, createdAt }, issue) => ({
  id: data.issueId,
  issueId: data.issueId,
  draftId: data.draftId,
  invoiceNumber: data.invoiceNumber,
  state: data.state,
  ksefNumber: data.ksefNumber === undefined ? null : data.ksefNumber,
  rejection: data.rejection === undefined ? null : data.rejection,
  eventId,
  eventType,
  livemode,
  createdAt,
  issue,
});

const perform = (event) => async (z, bundle) => {
  const raw = bundle.rawRequest || {};
  const secret = bundle.subscribeData && bundle.subscribeData.secret;
  const signature = headerValue(raw.headers, 'KsefCanvas-Signature');
  // A delivery that cannot be verified must not start the Zap: no secret, no raw body or a bad signature all stop here.
  if (!verifySignature(secret, signature, raw.content)) {
    z.console.log('KSeF Canvas delivery ignored: the signature is missing, invalid or older than 5 minutes.');
    return [];
  }

  let payload;
  try {
    payload = JSON.parse(raw.content);
  } catch (e) {
    return [];
  }
  // "ping" (the owner's "Wyślij test") and any type this Zap did not subscribe to.
  if (!payload || payload.type !== event || !payload.data || !payload.data.issueId) return [];

  let issue = null;
  try {
    issue = await fetchIssue(z, payload.data.issueId);
  } catch (error) {
    // The event itself is verified; deliver it even if the key cannot read the issue (e.g. no invoices:read scope).
    let reason = error.message;
    try {
      reason = JSON.parse(error.message).message || reason;
    } catch (e) {
      // not a JSON-encoded Zapier error
    }
    z.console.log(`KSeF Canvas issue ${payload.data.issueId} could not be read: ${reason}`);
  }
  return [
    toItem(
      {
        data: payload.data,
        eventId: payload.id,
        eventType: payload.type,
        livemode: payload.livemode,
        createdAt: payload.createdAt,
      },
      issue,
    ),
  ];
};

// Sample data for the editor: the newest issues in the trigger's state, shaped like a delivery.
const performList = (event, state) => async (z, bundle) => {
  const response = await z.request({ url: '/v1/issues', params: { page: 1, pageSize: SAMPLE_PAGE_SIZE } });
  const matching = ((response.data && response.data.items) || []).filter((item) => item.state === state);
  const issues = [];
  for (const summary of matching) issues.push(await fetchIssue(z, summary.id));
  const livemode = environment() !== 'test';
  return issues.map((issue) =>
    toItem(
      {
        data: {
          issueId: issue.id,
          draftId: issue.draftId,
          invoiceNumber: issue.invoiceNumber,
          state: issue.state,
          ksefNumber: issue.ksefNumber,
          rejection: issue.rejection,
        },
        eventId: null,
        eventType: event,
        livemode,
        createdAt: issue.updatedAt,
      },
      issue,
    ),
  );
};

const outputFields = [
  { key: 'id', label: 'ID' },
  { key: 'issueId', label: 'Issue ID' },
  { key: 'draftId', label: 'Draft ID' },
  { key: 'invoiceNumber', label: 'Invoice Number' },
  { key: 'state', label: 'State' },
  { key: 'ksefNumber', label: 'KSeF Number' },
  { key: 'rejection__code', label: 'Rejection Code' },
  { key: 'rejection__message', label: 'Rejection Message' },
  { key: 'eventId', label: 'Event ID' },
  { key: 'eventType', label: 'Event Type' },
  { key: 'livemode', label: 'Production KSeF', type: 'boolean' },
  { key: 'createdAt', label: 'Event Created At', type: 'datetime' },
  { key: 'issue__ksefReference', label: 'KSeF Reference' },
  { key: 'issue__updatedAt', label: 'Issue Updated At', type: 'datetime' },
];

const hookTrigger = ({ key, label, description, event, state, sample }) => ({
  key,
  noun: 'Invoice',
  display: { label, description },
  operation: {
    type: 'hook',
    performSubscribe: performSubscribe(event),
    performUnsubscribe,
    perform: perform(event),
    performList: performList(event, state),
    sample,
    outputFields,
  },
});

const invoiceAccepted = hookTrigger({
  key: 'invoice_accepted',
  label: 'Invoice Accepted in KSeF',
  description: 'Triggers when KSeF accepts an invoice issued in KSeF Canvas (in the app, through the API or by a Zap).',
  event: 'invoice.accepted',
  state: 'Accepted',
  sample: samples.triggerItem('invoice.accepted', samples.issue),
});

const invoiceRejected = hookTrigger({
  key: 'invoice_rejected',
  label: 'Invoice Rejected by KSeF',
  description: 'Triggers when KSeF rejects an invoice issued in KSeF Canvas, with the rejection code and message.',
  event: 'invoice.rejected',
  state: 'Rejected',
  sample: samples.triggerItem('invoice.rejected', samples.rejectedIssue),
});

module.exports = { invoiceAccepted, invoiceRejected };
