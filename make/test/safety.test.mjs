// Keys and webhook secrets stay out of logs and out of the repository; requests go only to KSeF Canvas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { MAKE_DIR, code, imlExpressions, listFiles, loadProject, requests } from '../scripts/lib/project.mjs';

const project = loadProject();

test('no API keys, webhook secrets or Make tokens are committed', () => {
	const files = listFiles(MAKE_DIR).filter((f) => !/[\\/](node_modules|\.git|\.secrets)[\\/]/.test(f));
	for (const file of files) {
		const text = readFileSync(file, 'utf8');
		const rel = relative(MAKE_DIR, file);
		assert.doesNotMatch(text, /kc_(live|test)_[A-Za-z0-9]{12,}/, `${rel}: API key`);
		assert.doesNotMatch(text, /kcwh_[A-Za-z0-9]{12,}/, `${rel}: webhook secret`);
		assert.doesNotMatch(text, /\b[sr]k_(live|test)_[A-Za-z0-9]{12,}/, `${rel}: Stripe key`);
		assert.doesNotMatch(text, /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b.*apikey/i, `${rel}: Make token`);
	}
});

test('the API key is a password field and only sent in the Authorization header', () => {
	const params = code(project, 'connection', 'ksefcanvas', 'params');
	assert.equal(params.find((p) => p.name === 'apiKey').type, 'password');
	for (const c of project.codes.filter((x) => x.rel.endsWith('.json'))) {
		for (const expression of imlExpressions(c.data)) {
			if (!/\b(connection|parameters)\.apiKey\b/.test(expression)) continue;
			const text = JSON.stringify(c.data);
			assert.ok(text.includes(`"Authorization":"Bearer {{${expression}}}"`), `${c.rel}: apiKey used outside the Authorization header`);
		}
	}
});

test('every request that carries the key masks the Authorization header in logs', () => {
	const base = code(project, 'general', 'app', 'base');
	assert.deepEqual(base.log.sanitize, ['request.headers.authorization']);
	assert.equal(base.headers.Authorization, 'Bearer {{connection.apiKey}}');
	for (const r of requests(project)) {
		if (!r.request.headers?.Authorization) continue;
		assert.ok(r.request.log?.sanitize?.includes('request.headers.authorization'), `${r.rel}#${r.index}`);
	}
});

test('attach keeps the webhook secret out of logs and out of the trigger output', () => {
	for (const id of Object.keys(project.makecomapp.components.webhook)) {
		const attach = code(project, 'webhook', id, 'attach');
		assert.ok(attach.log.sanitize.includes('response.body.secret'), id);
		const receiver = JSON.stringify(code(project, 'webhook', id, 'communication'));
		assert.doesNotMatch(receiver, /secret/i, `${id}: receiver output`);
	}
	for (const [id, m] of Object.entries(project.makecomapp.components.module)) {
		assert.doesNotMatch(JSON.stringify(code(project, 'module', id, 'communication')), /webhook\.secret/, `module ${m.label}`);
	}
});

test('absolute URLs only point to the KSeF Canvas production and test APIs', () => {
	const hosts = new Set();
	for (const c of project.codes.filter((x) => x.rel.endsWith('.json'))) {
		for (const m of JSON.stringify(c.data).matchAll(/https?:\/\/[^'"\s/)}]+/g)) hosts.add(m[0]);
	}
	assert.deepEqual([...hosts].sort(), ['https://api.ksefcanvas.pl', 'https://staging-api.ksefcanvas.pl']);
});

test('the Base takes its host from the connection environment', () => {
	const base = code(project, 'general', 'app', 'base');
	assert.equal(base.baseUrl, "{{if(connection.environment === 'test', 'https://staging-api.ksefcanvas.pl', 'https://api.ksefcanvas.pl')}}");
	assert.ok(!('type' in (base.response ?? {})), 'no generic error type, so 429 stays a RateLimitError and 5xx a ConnectionError');
	assert.ok(!('type' in base.response.error));
});
