// Offline tests for the built package (npm test builds first). HTTP is mocked through the n8n helpers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');

const {
	buildDraftData,
	documentFileName,
	parseProblem,
	verifySignature,
} = require('../dist/nodes/KsefCanvas/GenericFunctions.js');
const { KsefCanvas } = require('../dist/nodes/KsefCanvas/KsefCanvas.node.js');
const { KsefCanvasTrigger } = require('../dist/nodes/KsefCanvas/KsefCanvasTrigger.node.js');

const DRAFT = '0b8f7c1e-5d3a-4f6b-9a2e-7c1d4e5f6a7b';
const ISSUE = '9a1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e';

function sign(secret, body, timestamp = Math.floor(Date.now() / 1000)) {
	const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
	return `t=${timestamp},v1=${mac}`;
}

/** A fake n8n context. `routes` maps "METHOD /path" to { statusCode, body, headers } or a function of the request. */
function context({ parameters = {}, routes = {}, environment = 'live', staticData = {}, request, headers, body } = {}) {
	const calls = [];
	const response = { statusCode: 200, sent: undefined };
	const ctx = {
		calls,
		response,
		staticData,
		getInputData: () => [{ json: {} }],
		getNode: () => ({ name: 'KSeF Canvas', type: 'n8n-nodes-ksefcanvas.ksefCanvas', typeVersion: 1, position: [0, 0], parameters: {} }),
		continueOnFail: () => false,
		getNodeParameter: (name, _index, fallback, options) => {
			const value = name in parameters ? parameters[name] : fallback;
			if (options && options.extractValue && value && typeof value === 'object') return value.value;
			if (value === undefined) throw new Error(`Missing parameter ${name}`);
			return value;
		},
		getCredentials: async () => ({ environment, apiKey: 'kc_live_test_secret' }),
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => 'https://n8n.example.com/webhook/abc/webhook',
		getRequestObject: () => request,
		getResponseObject: () => ({
			status(code) {
				response.statusCode = code;
				return this;
			},
			json(value) {
				response.sent = value;
				return this;
			},
		}),
		getHeaderData: () => headers ?? {},
		getBodyData: () => body ?? {},
		helpers: {
			async httpRequestWithAuthentication(credential, options) {
				assert.equal(credential, 'ksefCanvasApi');
				calls.push(options);
				const route = routes[`${options.method} ${options.url}`];
				if (!route) throw new Error(`Unexpected request ${options.method} ${options.url}`);
				const result = typeof route === 'function' ? route(options) : route;
				return { statusCode: 200, headers: {}, ...result };
			},
			async prepareBinaryData(buffer, fileName, mimeType) {
				return { data: buffer.toString('base64'), fileName, mimeType };
			},
			returnJsonArray: (items) => items.map((json) => ({ json })),
		},
	};
	return ctx;
}

test('signatures cover the timestamp and the raw body, and expire after five minutes', () => {
	const secret = 'kcwh_secret';
	const raw = '{"id":"evt_1","type":"invoice.accepted"}';
	const now = 1_800_000_000;
	const header = sign(secret, raw, now);
	assert.equal(verifySignature(secret, header, Buffer.from(raw), now), true);
	assert.equal(verifySignature(secret, header, Buffer.from(raw), now + 300), true);
	assert.equal(verifySignature(secret, header, Buffer.from(raw), now + 301), false);
	assert.equal(verifySignature(secret, header, Buffer.from(raw.replace('accepted', 'rejected')), now), false);
	assert.equal(verifySignature('kcwh_other', header, Buffer.from(raw), now), false);
	assert.equal(verifySignature(secret, undefined, Buffer.from(raw), now), false);
	assert.equal(verifySignature(secret, 't=abc,v1=zz', Buffer.from(raw), now), false);
	assert.equal(verifySignature('', header, Buffer.from(raw), now), false);
});

test('draft fields become API data: grosz, a clean NIP, defaults, and nothing the user left empty', () => {
	const data = buildDraftData({
		buyerName: ' Odbiorca sp. z o.o. ',
		buyerNip: '525-224-84 81',
		buyerAddress: '',
		paymentMethod: 'Transfer',
		issueDate: '2026-11-17T00:00:00.000+01:00',
		currency: 'eur',
		lineItems: [
			{ name: 'Usługa', quantity: 2, unit: '', netUnitPrice: 123.45, vatRate: 23, discountPercent: 0, pkwiu: '' },
			{ name: 'Zwolniona', netUnitPrice: '10,5', vatRate: -1 },
		],
	});
	assert.deepEqual(data, {
		buyerName: 'Odbiorca sp. z o.o.',
		buyerNip: '5252248481',
		paymentMethod: 'Transfer',
		issueDate: '2026-11-17',
		currency: 'EUR',
		lines: [
			{ name: 'Usługa', quantity: 2, unit: 'szt.', netUnitPriceGrosz: 12345, discountPercent: 0, vatRate: 23, pkwiu: null },
			{ name: 'Zwolniona', quantity: 1, unit: 'szt.', netUnitPriceGrosz: 1050, discountPercent: 0, vatRate: -1, pkwiu: null },
		],
	});
	assert.throws(() => buildDraftData({ paymentDate: '17.11.2026', lineItems: [] }), /Payment Due Date must be a date/);
	assert.throws(() => buildDraftData({ lineItems: [{ name: '' }] }), /Line 1: Name is required/);
	assert.throws(() => buildDraftData({ lineItems: [{ name: 'X', netUnitPrice: 'abc' }] }), /Net Unit Price must be a number/);
});

test('file names come from Content-Disposition, problems parse from any body', () => {
	assert.equal(documentFileName('FV/2026/11/0042', {}, ISSUE, 'pdf'), 'FV_2026_11_0042.pdf');
	assert.equal(documentFileName('FV/2026/11/0042', {}, ISSUE, 'upo'), 'UPO-FV_2026_11_0042.xml');
	assert.equal(
		documentFileName('', { 'content-disposition': "attachment; filename=FV_2026_11_1.pdf; filename*=UTF-8''FV_2026_11_%C5%BC.pdf" }, ISSUE, 'pdf'),
		'FV_2026_11_ż.pdf',
	);
	assert.equal(documentFileName(undefined, { 'content-disposition': 'attachment; filename="UPO-FV.xml"' }, ISSUE, 'upo'), 'UPO-FV.xml');
	assert.equal(documentFileName(undefined, {}, ISSUE, 'upo'), `UPO-${ISSUE}.xml`);
	assert.deepEqual(parseProblem(Buffer.from('{"code":"document_not_ready"}')), { code: 'document_not_ready' });
	assert.deepEqual(parseProblem('not json'), { detail: 'not json' });
});

test('create sends only the filled fields to the environment of the credentials', async () => {
	const ctx = context({
		environment: 'test',
		parameters: {
			resource: 'draft',
			operation: 'create',
			inputMode: 'fields',
			buyerName: 'Odbiorca',
			buyerNip: '5252248481',
			buyerAddress: '',
			paymentMethod: 'Cash',
			lineItems: { item: [{ name: 'Usługa', quantity: 1, unit: 'godz.', netUnitPrice: 100, vatRate: 8, discountPercent: 0, pkwiu: '' }] },
			additionalFields: {},
		},
		routes: { 'POST /v1/drafts': { statusCode: 201, body: { id: DRAFT, version: 2 } } },
	});
	const [[item]] = await new KsefCanvas().execute.call(ctx);
	assert.deepEqual(item.json, { id: DRAFT, version: 2 });
	assert.equal(ctx.calls[0].baseURL, 'https://staging-api.ksefcanvas.pl');
	assert.deepEqual(ctx.calls[0].body, {
		data: {
			buyerName: 'Odbiorca',
			buyerNip: '5252248481',
			paymentMethod: 'Cash',
			lines: [{ name: 'Usługa', quantity: 1, unit: 'godz.', netUnitPriceGrosz: 10000, discountPercent: 0, vatRate: 8, pkwiu: null }],
		},
	});
});

test('issue reads the current version and sends a stable idempotency key', async () => {
	const ctx = context({
		parameters: { resource: 'draft', operation: 'issue', draftId: { mode: 'list', value: DRAFT }, version: 0, issueOptions: {} },
		routes: {
			[`GET /v1/drafts/${DRAFT}`]: { body: { id: DRAFT, version: 7 } },
			[`POST /v1/drafts/${DRAFT}/issue`]: { statusCode: 202, body: { issueId: ISSUE, draftId: DRAFT, state: 'Queued', replay: false } },
		},
	});
	const [[item]] = await new KsefCanvas().execute.call(ctx);
	const issue = ctx.calls[1];
	assert.deepEqual(issue.body, { version: 7 });
	assert.equal(issue.headers['Idempotency-Key'], `${DRAFT}:7`);
	assert.deepEqual(item.json, { issueId: ISSUE, draftId: DRAFT, state: 'Queued', replay: false, version: 7, idempotencyKey: `${DRAFT}:7` });
});

test('a retry after the draft was issued returns its issue instead of issuing again', async () => {
	const ctx = context({
		parameters: { resource: 'draft', operation: 'issue', draftId: { mode: 'id', value: DRAFT }, version: 0, issueOptions: {} },
		routes: {
			[`GET /v1/drafts/${DRAFT}`]: { body: { id: DRAFT, version: 8, state: 'Accepted' } },
			'GET /v1/issues': { body: { items: [{ id: 'other', draftId: 'x' }, { id: ISSUE, draftId: DRAFT, state: 'Accepted' }], total: 2 } },
		},
	});
	const [[item]] = await new KsefCanvas().execute.call(ctx);
	assert.deepEqual(item.json, { issueId: ISSUE, draftId: DRAFT, state: 'Accepted', replay: true, alreadyIssued: true, version: 8, idempotencyKey: undefined });
	assert.ok(ctx.calls.every((call) => call.method === 'GET'));

	// A rejected draft can be fixed and issued again.
	const rejected = context({
		parameters: { resource: 'draft', operation: 'issue', draftId: { mode: 'id', value: DRAFT }, version: 0, issueOptions: {} },
		routes: {
			[`GET /v1/drafts/${DRAFT}`]: { body: { id: DRAFT, version: 9, state: 'Rejected' } },
			[`POST /v1/drafts/${DRAFT}/issue`]: { statusCode: 202, body: { issueId: 'new', draftId: DRAFT, state: 'Queued', replay: false } },
		},
	});
	const [[again]] = await new KsefCanvas().execute.call(rejected);
	assert.equal(again.json.issueId, 'new');
	assert.equal(rejected.calls[1].headers['Idempotency-Key'], `${DRAFT}:9`);
});

test('issue can wait for the KSeF result', async () => {
	let reads = 0;
	const ctx = context({
		parameters: {
			resource: 'draft',
			operation: 'issue',
			draftId: { mode: 'id', value: DRAFT },
			version: 3,
			issueOptions: { waitForResult: true, waitTimeout: 30, idempotencyKey: 'order-42' },
		},
		routes: {
			[`POST /v1/drafts/${DRAFT}/issue`]: { statusCode: 202, body: { issueId: ISSUE, draftId: DRAFT, state: 'Queued', replay: true } },
			[`GET /v1/issues/${ISSUE}`]: () => ({ body: { id: ISSUE, state: ++reads < 2 ? 'Processing' : 'Accepted', ksefNumber: 'KSEF-1' } }),
		},
	});
	const [[item]] = await new KsefCanvas().execute.call(ctx);
	assert.equal(ctx.calls[0].headers['Idempotency-Key'], 'order-42');
	assert.equal(item.json.state, 'Accepted');
	assert.equal(item.json.final, true);
	assert.equal(item.json.replay, true);
});

test('API errors keep their code, an English summary and the API detail', async () => {
	const ctx = context({
		parameters: { resource: 'invoice', operation: 'get', issueId: ISSUE },
		routes: {
			[`GET /v1/issues/${ISSUE}`]: {
				statusCode: 403,
				body: { status: 403, code: 'insufficient_scope', detail: 'Ten klucz nie ma zakresu invoices:read.', traceId: 't-1' },
			},
		},
	});
	await assert.rejects(new KsefCanvas().execute.call(ctx), (error) => {
		assert.equal(error.message, 'The API key lacks the scope this operation needs (insufficient_scope)');
		assert.match(error.description, /Ten klucz nie ma zakresu invoices:read\./);
		assert.match(error.description, /Trace ID: t-1/);
		assert.equal(error.httpCode, '403');
		return true;
	});
});

test('validation errors list each field', async () => {
	const ctx = context({
		parameters: { resource: 'draft', operation: 'create', inputMode: 'json', draftJson: '{"lines":[]}' },
		routes: {
			'POST /v1/drafts': {
				statusCode: 422,
				body: { code: 'validation_failed', detail: 'Popraw dane.', errors: [{ code: 'required', field: 'paymentMethod', message: 'Podaj formę płatności.' }] },
			},
		},
	});
	await assert.rejects(new KsefCanvas().execute.call(ctx), (error) => {
		assert.match(error.message, /\(validation_failed\)$/);
		assert.match(error.description, /paymentMethod: Podaj formę płatności\. \(required\)/);
		return true;
	});
});

test('documents download as binary with the API file name', async () => {
	const ctx = context({
		parameters: { resource: 'invoice', operation: 'downloadDocument', issueId: ISSUE, documentType: 'pdf', binaryPropertyName: 'data' },
		routes: {
			[`GET /v1/issues/${ISSUE}/pdf`]: {
				body: new TextEncoder().encode('%PDF-1.7').buffer,
				headers: { 'content-disposition': 'attachment; filename=91ba6f3d-invoice.pdf' },
			},
			[`GET /v1/issues/${ISSUE}`]: { body: { id: ISSUE, invoiceNumber: 'FV/2026/11/0042' } },
		},
	});
	const [[item]] = await new KsefCanvas().execute.call(ctx);
	assert.equal(ctx.calls[0].encoding, 'arraybuffer');
	assert.equal(item.json.invoiceNumber, 'FV/2026/11/0042');
	assert.equal(item.binary.data.fileName, 'FV_2026_11_0042.pdf');
	assert.equal(item.binary.data.mimeType, 'application/pdf');
	assert.equal(Buffer.from(item.binary.data.data, 'base64').toString(), '%PDF-1.7');
});

test('get many pages through results up to the limit', async () => {
	const ctx = context({
		parameters: { resource: 'client', operation: 'getAll', query: 'Odbiorca', returnAll: false, limit: 3 },
		routes: {
			'GET /v1/clients': (options) => ({ body: { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], page: options.qs.page, pageSize: 3, total: 10 } }),
		},
	});
	const [items] = await new KsefCanvas().execute.call(ctx);
	assert.deepEqual(items.map((x) => x.json.id), ['a', 'b', 'c']);
	assert.deepEqual(ctx.calls[0].qs, { q: 'Odbiorca', page: 1, pageSize: 3 });
});

test('the trigger registers its URL for one event and keeps the id and secret', async () => {
	const staticData = {};
	const ctx = context({
		staticData,
		parameters: { event: 'invoice.rejected' },
		routes: { 'POST /v1/webhooks': { statusCode: 201, body: { id: 'w1', secret: 'kcwh_x', url: 'https://n8n.example.com/webhook/abc/webhook', events: ['invoice.rejected'], enabled: true } } },
	});
	const methods = new KsefCanvasTrigger().webhookMethods.default;
	assert.equal(await methods.create.call(ctx), true);
	assert.deepEqual(ctx.calls[0].body, { url: 'https://n8n.example.com/webhook/abc/webhook', events: ['invoice.rejected'] });
	assert.deepEqual(staticData, { webhookId: 'w1', webhookSecret: 'kcwh_x' });
});

test('the trigger explains that KSeF Canvas needs a public https address', async () => {
	const ctx = context({
		parameters: { event: 'invoice.accepted' },
		routes: {
			'POST /v1/webhooks': {
				statusCode: 422,
				body: { code: 'validation_failed', errors: [{ code: 'invalid_webhook_url', field: 'url', message: 'Podaj publiczny adres https://' }] },
			},
		},
	});
	await assert.rejects(new KsefCanvasTrigger().webhookMethods.default.create.call(ctx), /cannot send events to https:\/\/n8n\.example\.com/);
});

test('the trigger finds its webhook again, or forgets one that is gone or differs', async () => {
	const url = 'https://n8n.example.com/webhook/abc/webhook';
	const methods = new KsefCanvasTrigger().webhookMethods.default;
	const same = context({
		staticData: { webhookId: 'w1', webhookSecret: 's' },
		parameters: { event: 'invoice.accepted' },
		routes: { 'GET /v1/webhooks/w1': { body: { id: 'w1', url, events: ['invoice.accepted'], enabled: true } } },
	});
	assert.equal(await methods.checkExists.call(same), true);

	const gone = context({
		staticData: { webhookId: 'w1', webhookSecret: 's' },
		parameters: { event: 'invoice.accepted' },
		routes: { 'GET /v1/webhooks/w1': { statusCode: 404, body: { code: 'resource_not_found' } } },
	});
	assert.equal(await methods.checkExists.call(gone), false);
	assert.deepEqual(gone.staticData, {});

	const changed = context({
		staticData: { webhookId: 'w1', webhookSecret: 's' },
		parameters: { event: 'invoice.rejected' },
		routes: {
			'GET /v1/webhooks/w1': { body: { id: 'w1', url, events: ['invoice.accepted'], enabled: true } },
			'DELETE /v1/webhooks/w1': { statusCode: 204, body: '' },
		},
	});
	assert.equal(await methods.checkExists.call(changed), false);
	assert.equal(changed.calls[1].method, 'DELETE');

	const removed = context({ staticData: { webhookId: 'w1', webhookSecret: 's' }, routes: { 'DELETE /v1/webhooks/w1': { statusCode: 404, body: {} } } });
	assert.equal(await methods.delete.call(removed), true);
	assert.deepEqual(removed.staticData, {});
});

test('the trigger starts the workflow only for signed events of its type', async () => {
	const secret = 'kcwh_secret';
	const event = {
		id: 'evt_1',
		type: 'invoice.accepted',
		createdAt: '2026-11-17T10:00:00Z',
		livemode: true,
		data: { issueId: ISSUE, draftId: DRAFT, invoiceNumber: 'FV/2026/11/0042', state: 'Accepted', ksefNumber: 'KSEF-1', rejection: null },
	};
	const raw = JSON.stringify(event);
	const trigger = new KsefCanvasTrigger();
	const run = (overrides) =>
		context({
			staticData: { webhookId: 'w1', webhookSecret: secret },
			parameters: { event: 'invoice.accepted', includeIssue: true },
			request: { rawBody: Buffer.from(overrides.raw ?? raw), readRawBody: async () => {} },
			headers: { 'ksefcanvas-signature': overrides.signature ?? sign(secret, overrides.raw ?? raw) },
			body: JSON.parse(overrides.raw ?? raw),
			routes: { [`GET /v1/issues/${ISSUE}`]: { body: { id: ISSUE, state: 'Accepted' } } },
		});

	const signed = run({});
	const result = await trigger.webhook.call(signed);
	assert.deepEqual(result.workflowData[0][0].json, {
		...event.data,
		eventId: 'evt_1',
		eventType: 'invoice.accepted',
		livemode: true,
		createdAt: '2026-11-17T10:00:00Z',
		issue: { id: ISSUE, state: 'Accepted' },
	});

	const forged = run({ signature: sign('kcwh_other', raw) });
	assert.deepEqual(await trigger.webhook.call(forged), { noWebhookResponse: true });
	assert.equal(forged.response.statusCode, 401);
	assert.equal(forged.calls.length, 0);

	const stale = run({ signature: sign(secret, raw, Math.floor(Date.now() / 1000) - 600) });
	assert.deepEqual(await trigger.webhook.call(stale), { noWebhookResponse: true });

	const ping = run({ raw: JSON.stringify({ id: 'evt_2', type: 'ping', data: {} }) });
	const pinged = await trigger.webhook.call(ping);
	assert.equal(pinged.workflowData, undefined);
	assert.deepEqual(pinged.webhookResponse, { received: true, ignored: 'ping' });
});
