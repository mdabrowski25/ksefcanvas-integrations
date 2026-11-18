'use strict';

// Base URL and Bearer header before every request; problem+json into Zapier errors after every response.

const BASE_URLS = {
  live: 'https://api.ksefcanvas.pl',
  test: 'https://staging-api.ksefcanvas.pl',
};

const KEYS_PAGE = 'Ustawienia → Integracje → API';

// Zapier publishes only integrations that use production endpoints, so users never choose an environment. A private
// development version can use the KSeF Canvas test environment: `zapier env:set <version> KSEFCANVAS_ENVIRONMENT=test`.
const environment = () => process.env.KSEFCANVAS_ENVIRONMENT || 'live';

const baseUrl = (z) => {
  const name = environment();
  const url = BASE_URLS[name];
  if (!url) throw new z.errors.Error(`Unknown KSEFCANVAS_ENVIRONMENT "${name}": use live or test.`, 'invalid_environment', 400);
  return url;
};

const addBaseUrlAndAuth = (request, z, bundle) => {
  const base = baseUrl(z);
  if (request.url.startsWith('/')) request.url = base + request.url;
  // The key goes only to the KSeF Canvas API, never to another host.
  const apiKey = bundle.authData && bundle.authData.apiKey;
  if (apiKey && request.url.startsWith(`${base}/`)) {
    request.headers = request.headers || {};
    request.headers.Authorization = `Bearer ${String(apiKey).trim()}`;
  }
  // 429 is handled below with the API's own message and Retry-After.
  request.throwForThrottlingEarly = false;
  return request;
};

// The scope each route needs, from the contract, so a 403 insufficient_scope can name it.
const requiredScope = (method, url) => {
  let path;
  try {
    path = new URL(url).pathname;
  } catch (e) {
    return null;
  }
  if (path === '/v1/key') return null;
  if (path.startsWith('/v1/webhooks')) return 'webhooks:write';
  if (/^\/v1\/drafts\/[^/]+\/issue$/.test(path)) return 'invoices:issue';
  if (path.startsWith('/v1/drafts') && (method || 'GET').toUpperCase() !== 'GET') return 'drafts:write';
  return 'invoices:read';
};

const SUMMARIES = {
  api_key_missing: () => 'KSeF Canvas did not receive an API key. Reconnect your KSeF Canvas account.',
  api_key_invalid: () =>
    'KSeF Canvas did not recognise this API key. Check the key and reconnect.',
  api_key_revoked: () => `This API key was revoked in KSeF Canvas. Create a new key under ${KEYS_PAGE} and reconnect.`,
  api_key_environment_mismatch: () =>
    `This API key belongs to the KSeF Canvas test environment. Create a production key (kc_live_) under ${KEYS_PAGE} and reconnect.`,
  insufficient_scope: ({ scope }) =>
    `This API key does not have the ${scope || 'required'} scope. Create a key with it in KSeF Canvas under ${KEYS_PAGE} and reconnect.`,
  api_unavailable: () => 'The KSeF Canvas API is not switched on for this firm.',
  api_plan_required: () => 'The KSeF Canvas API needs the Studio or Firma plan.',
  api_access_disabled: () => 'API access is switched off for this firm in KSeF Canvas.',
  webhook_limit_reached: () =>
    'A firm can have at most 3 webhook addresses in KSeF Canvas, including the ones added in the app. ' +
    `Remove unused webhooks in KSeF Canvas under ${KEYS_PAGE}, then turn this Zap on again.`,
  invalid_webhook_url: () => 'KSeF Canvas accepts only https:// webhook addresses on port 443 with a public host name.',
  invalid_events: () => 'KSeF Canvas did not accept the webhook event types.',
  legal_acceptance_required: () =>
    `The firm owner must first accept the current API terms in KSeF Canvas under ${KEYS_PAGE}.`,
  agreements_required: () => 'The firm owner must first accept the current agreements in KSeF Canvas.',
  validation_failed: () => 'KSeF Canvas rejected the data.',
  invalid_request: () => 'KSeF Canvas could not read the request.',
  idempotency_key_required: () => 'Issuing needs an idempotency key.',
  idempotency_key_invalid: () =>
    'The idempotency key may contain only letters, digits and the characters . _ : - (1 to 64 characters).',
  resource_not_found: () => 'Not found in KSeF Canvas.',
  document_not_ready: () => 'The document is not ready yet: it is available once KSeF has accepted the invoice.',
  resource_conflict: () =>
    'The draft changed after its version was read, or this idempotency key was already used for a different request.',
  stripe_sale_draft: () => 'Drafts created from Stripe sales are issued in the Stripe inbox of KSeF Canvas, not through the API.',
  operation_paused: () => 'KSeF Canvas has paused this operation for a while. Try again later.',
  workspace_deleted: () => 'This firm was deleted in KSeF Canvas.',
  rate_limited: () => 'Too many requests to KSeF Canvas. Zapier will try again later.',
};

const summaryForStatus = (status) => {
  if (status === 400) return 'KSeF Canvas could not process the request.';
  if (status === 401) return 'KSeF Canvas did not accept the API key. Check the key, then reconnect.';
  if (status === 403) return 'KSeF Canvas refused this operation.';
  if (status === 404) return 'Not found in KSeF Canvas.';
  if (status === 409) return 'KSeF Canvas cannot do this right now.';
  if (status === 410) return 'This resource no longer exists in KSeF Canvas.';
  if (status === 422) return 'KSeF Canvas rejected the data.';
  if (status === 429) return SUMMARIES.rate_limited();
  if (status >= 500) return 'KSeF Canvas or KSeF had a temporary problem. Try again in a moment.';
  return `KSeF Canvas answered with HTTP ${status}.`;
};

const readProblem = async (response) => {
  let text;
  try {
    text = response.request && response.request.raw ? await response.text() : response.content;
  } catch (e) {
    text = null;
  }
  if (response.data && typeof response.data === 'object') return response.data;
  if (typeof text !== 'string' || !text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
};

// 422 problems carry errors[] of {code, field, message}; ASP.NET's own validation uses {field: [messages]}. Zapier needs
// every error message in English and the API's messages are Polish, so only the fields and their stable codes are shown.
const errorFields = (errors) => {
  if (Array.isArray(errors)) {
    return errors
      .filter((e) => e && (e.field || e.code))
      .map((e) => (e.field && e.code ? `${e.field} (${e.code})` : e.field || e.code));
  }
  if (errors && typeof errors === 'object') return Object.keys(errors);
  return [];
};

const describeProblem = (status, problem, request = {}) => {
  const code = typeof problem.code === 'string' && problem.code ? problem.code : `http_${status}`;
  const summarize = SUMMARIES[code];
  const summary = summarize ? summarize({ scope: requiredScope(request.method, request.url) }) : summaryForStatus(status);
  const parts = [`${summary} [${code}]`];
  const fields = errorFields(problem.errors);
  if (fields.length) parts.push(`Fields: ${fields.join(', ')}.`);
  if (problem.traceId) parts.push(`Trace ID: ${problem.traceId}.`);
  return { code, message: parts.join(' ') };
};

const retryAfterSeconds = (response) => {
  const value = response.headers && response.headers.get ? response.headers.get('retry-after') : null;
  const seconds = parseInt(value, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
};

// Throws the Zapier error for a failed response; returns the response otherwise.
const throwForProblem = async (z, response) => {
  const status = response.status;
  if (status < 400) return response;
  const problem = await readProblem(response);
  const { code, message } = describeProblem(status, problem, response.request);
  if (status === 401) throw new z.errors.ExpiredAuthError(message);
  if (status === 429) throw new z.errors.ThrottledError(message, retryAfterSeconds(response));
  throw new z.errors.Error(message, code, status);
};

const handleProblems = async (response, z) => {
  if (response.skipThrowForStatus) return response;
  return throwForProblem(z, response);
};

module.exports = {
  BASE_URLS,
  KEYS_PAGE,
  addBaseUrlAndAuth,
  baseUrl,
  describeProblem,
  environment,
  handleProblems,
  requiredScope,
  throwForProblem,
};
