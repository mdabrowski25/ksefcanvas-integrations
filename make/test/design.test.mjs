// The app follows ../docs/DESIGN.md: keys, labels, calls, fields, options and help texts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { code, loadProject, requests, walkParams } from '../scripts/lib/project.mjs';
import { calls, loadDesign } from './support/design.mjs';

const design = loadDesign();
const project = loadProject();
const { components } = project.makecomapp;
const allRequests = requests(project);

const params = (id) => code(project, 'module', id, 'mappableParams');
function findParam(list, predicate) {
	let found = null;
	walkParams(list, (p, path) => { if (!found && predicate(p, path)) found = { ...p, path }; });
	return found;
}
const toTemplate = (url) => url
	.replace(/^\{\{[^}]*\}\}/, '')
	.replace(/\{\{[^}]+\}\}/g, '{}');
const designTemplate = (path) => path.replace(/\{[^}]+\}/g, '{}');
/** Request paths of a module, with select parameters in the path expanded to their option values. */
function modulePaths(id) {
	return allRequests.filter((r) => r.componentType === 'module' && r.id === id).flatMap((r) => {
		const method = r.request.method ?? 'GET';
		const raw = r.request.url.replace(/^\{\{[^}]*\}\}/, '');
		const m = raw.match(/\{\{parameters\.(\w+)\}\}$/);
		const select = m && findParam(params(id), (p) => p.name === m[1] && Array.isArray(p.options));
		if (select) return select.options.map((o) => ({ method, path: toTemplate(raw.replace(m[0], String(o.value))) }));
		return [{ method, path: toTemplate(raw) }];
	});
}

test('the connection has the DESIGN fields, labels, help text, options and label', () => {
	const list = code(project, 'connection', 'ksefcanvas', 'params');
	assert.deepEqual(list.map((p) => p.name), design.connection.map((f) => f.field), 'fields and order');
	for (const field of design.connection) {
		const p = list.find((x) => x.name === field.field);
		assert.equal(p.label, field.label, field.field);
		if (field.help) assert.equal(p.help, field.help, `${field.field} help`);
		if (field.options.length) {
			assert.deepEqual(p.options.map((o) => ({ value: o.value, label: o.label })), field.options.map((o) => ({ value: o.value, label: o.label })));
			assert.equal(p.default, field.options.find((o) => o.default)?.value, `${field.field} default`);
		}
	}
	assert.equal(list.find((p) => p.name === 'apiKey').type, 'password');
	const check = code(project, 'connection', 'ksefcanvas', 'communication');
	assert.match(check.url, /\/v1\/key$/);
	assert.match(check.response.metadata.value, /^\{\{body\.firm\.name\}\}.*body\.firm\.nip/);
});

test('instant triggers match the DESIGN keys, labels and events', () => {
	for (const t of design.triggers) {
		const m = components.module[t.key];
		assert.ok(m, `module ${t.key}`);
		assert.equal(m.label, t.label);
		assert.equal(m.moduleType, 'instant_trigger');
		const w = components.webhook[m.webhook];
		assert.equal(w.label, t.label);
		const attach = code(project, 'webhook', m.webhook, 'attach');
		assert.deepEqual(attach.body, { url: '{{webhook.url}}', events: [t.event] });
		assert.equal(attach.method, 'POST');
		assert.ok(attach.response.data.externalHookId && attach.response.data.secret, 'attach stores the webhook id and secret');
		const detach = code(project, 'webhook', m.webhook, 'detach');
		const del = detach.find((r) => r.method === 'DELETE');
		assert.match(del.url, /\/v1\/webhooks\/\{\{webhook\.externalHookId\}\}$/);
		const receiver = code(project, 'webhook', m.webhook, 'communication');
		assert.equal(receiver.condition, `{{body.type === '${t.event}'}}`, 'drops ping and other event types');
		const names = code(project, 'module', t.key, 'interface').map((f) => f.name);
		for (const field of design.triggerOutput) assert.ok(names.includes(field), `${t.key} outputs ${field}`);
		assert.equal(code(project, 'module', t.key, 'communication').url, '/v1/issues/{{payload.issueId}}', 'reads the full issue');
	}
});

test('actions and searches match the DESIGN keys, labels and calls', () => {
	const rows = [...design.actions.map((r) => ({ ...r, kind: 'action' })), ...design.searches.map((r) => ({ ...r, kind: 'search' }))];
	assert.ok(rows.length >= 11);
	for (const row of rows) {
		const m = components.module[row.key];
		assert.ok(m, `module ${row.key}`);
		assert.equal(m.label, row.label, `${row.key} label`);
		assert.equal(m.moduleType, row.kind, `${row.key} type`);
		const have = modulePaths(row.key).map((p) => `${p.method} ${p.path}`);
		for (const c of calls(row.call)) {
			assert.ok(have.includes(`${c.method} ${designTemplate(c.path)}`), `${row.key}: ${c.method} ${c.path} (has ${have.join(', ')})`);
		}
	}
	assert.equal(params('findClient').find((p) => p.name === 'q').type, 'text');
	assert.equal(params('findProduct').find((p) => p.name === 'q').type, 'text');
});

test('Create Draft has every DESIGN field with its label, plus Draft Data (JSON)', () => {
	const list = params('createDraft');
	for (const f of design.draftFields) {
		const lineField = f.field.match(/^lines\[\]\.(\w+)$/);
		const name = lineField ? lineField[1] : f.field.replace('[]', '');
		const p = findParam(list, (x, path) => x.name === name && (lineField ? path.at(-1) === 'lines' : path.at(-1) !== 'lines'));
		assert.ok(p, `createDraft has ${f.field}`);
		assert.equal(p.label, f.label, `${f.field} label`);
	}
	const json = findParam(list, (x) => x.name === 'dataJson');
	assert.equal(json.label, design.advancedJsonLabel);
	assert.equal(findParam(list, (x) => x.name === 'paymentMethod').required, true);
	assert.equal(findParam(list, (x) => x.name === 'lines').required, true);
	assert.deepEqual(code(project, 'module', 'createDraft', 'communication').body, { data: '{{ksefDraftData(parameters)}}' });
});

test('payment methods and VAT rates are the DESIGN options in DESIGN order', () => {
	const list = params('createDraft');
	const payment = findParam(list, (x) => x.name === 'paymentMethod');
	assert.deepEqual(payment.options.map((o) => [o.label, o.value]), design.paymentMethods.map((o) => [o.label, o.value]));
	assert.equal(payment.default, design.paymentMethods.find((o) => o.default).value);
	const vat = findParam(list, (x) => x.name === 'vatRate');
	assert.deepEqual(vat.options.map((o) => [o.label, String(o.value)]), design.vatRates.map((o) => [o.label, o.value]));
	assert.equal(String(vat.default), '23');
	assert.equal(design.vatRates.length, 10);
});

test('Issue Invoice in KSeF follows the DESIGN issue rules', () => {
	const list = params('issueDraft');
	assert.deepEqual(list.map((p) => p.name), ['draftId', 'version', 'idempotencyKey']);
	assert.equal(list[0].required, true);
	assert.ok(!list[1].required && !list[2].required);
	assert.equal(list[2].advanced, true);
	const [, chars, min, max] = design.idempotencyPattern;
	assert.equal(list[2].validate.pattern, `^[${chars}]{${min},${max}}$`);
	assert.ok(components.module.issueDraft.description.includes(design.issueHelp), 'module description carries the DESIGN help text');
	assert.ok(list[0].help.includes(design.issueHelp), 'draft parameter help carries the DESIGN help text');

	const chain = code(project, 'module', 'issueDraft', 'communication');
	const [readDraft, ...rest] = chain;
	const issue = rest.at(-1);
	const pages = rest.slice(0, -1);
	assert.equal(readDraft.condition, '{{!parameters.version}}', 'reads the draft only without a version');
	assert.equal(readDraft.url, '/v1/drafts/{{parameters.draftId}}');
	for (const state of design.issuedStates) assert.ok(readDraft.response.temp.alreadyIssued.includes(`'${state}'`), `${state} counts as issued`);
	assert.ok(!readDraft.response.temp.alreadyIssued.includes('Rejected'), 'a rejected draft is issued again');
	assert.equal(pages.length, 5, 'up to 5 pages of issues');
	pages.forEach((p, i) => {
		assert.equal(p.url, '/v1/issues');
		assert.deepEqual(p.qs, { page: i + 1, pageSize: 100 });
		assert.equal(p.response.temp.found, '{{ksefFindIssue(body.items, parameters.draftId)}}');
	});
	assert.equal(issue.url, '/v1/drafts/{{parameters.draftId}}/issue');
	assert.equal(issue.headers['Idempotency-Key'], "{{ifempty(parameters.idempotencyKey, parameters.draftId + ':' + ifempty(parameters.version, temp.version))}}");
	assert.deepEqual(issue.body, { version: '{{ifempty(parameters.version, temp.version)}}' });
	assert.equal(issue.condition.condition, '{{temp.alreadyIssued !== true}}');
	assert.deepEqual(Object.keys(issue.condition.default).sort(), ['alreadyIssued', 'draftId', 'issueId', 'replay', 'state']);
	assert.equal(issue.condition.default.replay, true);
	assert.equal(issue.condition.default.alreadyIssued, true);
});

test('Download Invoice Document offers the DESIGN document types and file names', () => {
	const type = params('downloadDocument').find((p) => p.name === 'documentType');
	assert.deepEqual(type.options.map((o) => [o.label, o.value]), design.documentTypes.map((o) => [o.label, o.value]));
	const download = code(project, 'module', 'downloadDocument', 'communication').at(-1);
	assert.equal(download.response.output.fileName, '{{ksefFileName(temp.invoiceNumber, parameters.documentType, parameters.issueId)}}');
	const fileFields = code(project, 'module', 'downloadDocument', 'interface').filter((f) => f.semantic);
	assert.deepEqual(fileFields.map((f) => [f.type, f.semantic]), [['filename', 'file:name'], ['buffer', 'file:data']]);
});

test('labels and help texts are English, with Polish only for invoicing terms', () => {
	const polishOnly = /[ąćęłńóśźż]/i;
	const allowed = ['Ustawienia → Integracje → API', 'faktura korygująca', 'data dostawy lub wykonania usługi', 'forma płatności',
		'termin płatności', 'urzędowe poświadczenie odbioru'];
	const texts = [];
	for (const c of project.codes.filter((x) => /Params|params|interface/.test(x.codeType))) {
		walkParams(c.data, (p) => { if (p.label) texts.push([c.rel, p.label]); if (p.help) texts.push([c.rel, p.help]); });
	}
	for (const m of Object.values(components.module)) texts.push(['makecomapp.json', m.label], ['makecomapp.json', m.description]);
	for (const [where, text] of texts) {
		const rest = allowed.reduce((t, a) => t.split(a).join(''), text);
		assert.ok(!polishOnly.test(rest), `${where}: "${text}" has Polish text outside the allowed invoicing terms`);
	}
});
