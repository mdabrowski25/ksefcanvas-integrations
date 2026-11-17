// Every request the app makes is an operation of the KSeF Canvas API v1 contract (../docs/openapi-v1.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DOCS_DIR, loadProject, readJson, requests, walkParams } from '../scripts/lib/project.mjs';

const openapi = readJson(join(DOCS_DIR, 'openapi-v1.json'));
const project = loadProject();
const HOSTS = ['https://api.ksefcanvas.pl', 'https://staging-api.ksefcanvas.pl'];

/** Static options of a module parameter, so a path segment like {{parameters.documentType}} expands to its values. */
function staticOptions(c, name) {
	if (c.componentType !== 'module') return null;
	const params = project.codes.find((x) => x.componentType === 'module' && x.id === c.id && x.codeType === 'mappableParams').data;
	let found = null;
	walkParams(params, (p) => { if (p.name === name && Array.isArray(p.options)) found = p.options.map((o) => String(o.value)); });
	return found;
}

/** Turns a request URL into concrete path alternatives with "{}" for each mapped segment. */
function resolvePaths(c, url) {
	let rest = url;
	let absolute = false;
	if (rest.startsWith('{{')) {
		const end = rest.indexOf('}}') + 2;
		const hostExpression = rest.slice(0, end);
		for (const host of HOSTS) assert.ok(hostExpression.includes(`'${host}'`), `${c.rel}: host expression must name ${host}`);
		rest = rest.slice(end);
		absolute = true;
	}
	assert.ok(rest.startsWith('/v1/'), `${c.rel}: ${url} must be a /v1 path${absolute ? '' : ' relative to Base'}`);
	let paths = [''];
	for (const segment of rest.slice(1).split('/')) {
		const expr = segment.match(/^\{\{\s*(.+?)\s*\}\}$/);
		if (!expr) {
			assert.ok(!segment.includes('{{'), `${c.rel}: segment ${segment} mixes text and IML`);
			paths = paths.map((p) => `${p}/${segment}`);
			continue;
		}
		const param = expr[1].match(/^parameters\.(\w+)$/);
		const options = param ? staticOptions(c, param[1]) : null;
		paths = options ? paths.flatMap((p) => options.map((o) => `${p}/${o}`)) : paths.map((p) => `${p}/{}`);
	}
	return paths;
}

function findOperation(path, method) {
	const segments = path.split('/');
	for (const [template, operations] of Object.entries(openapi.paths)) {
		const t = template.split('/');
		if (t.length !== segments.length) continue;
		const matches = t.every((s, i) => (s.startsWith('{') ? segments[i] === '{}' : s === segments[i]));
		if (matches) return { template, operation: operations[method.toLowerCase()] };
	}
	return null;
}

function resolveRef(schema) {
	return schema?.$ref ? openapi.components.schemas[schema.$ref.split('/').pop()] : schema;
}

const all = requests(project).filter((r) => !(r.componentType === 'module' && r.id === 'makeApiCall'));

test('every request URL and method is an operation in openapi-v1.json', () => {
	assert.ok(all.length > 20, `only ${all.length} requests found`);
	for (const r of all) {
		const method = r.request.method ?? 'GET';
		for (const path of resolvePaths(r, r.request.url)) {
			const found = findOperation(path, method);
			assert.ok(found, `${r.rel}#${r.index}: ${path} is not in openapi-v1.json`);
			assert.ok(found.operation, `${r.rel}#${r.index}: ${method} ${found.template} is not in openapi-v1.json`);
		}
	}
});

test('query parameters, headers and body fields are the ones the contract defines', () => {
	for (const r of all) {
		const method = r.request.method ?? 'GET';
		const [path] = resolvePaths(r, r.request.url);
		const { operation } = findOperation(path, method);
		const params = operation.parameters ?? [];
		const qsNames = [...Object.keys(r.request.qs ?? {}), ...Object.keys(r.request.pagination?.qs ?? {})];
		for (const name of qsNames) {
			assert.ok(params.some((p) => p.in === 'query' && p.name === name), `${r.rel}#${r.index}: unknown query parameter ${name}`);
		}
		for (const [name] of Object.entries(r.request.headers ?? {})) {
			if (name.toLowerCase() === 'authorization') continue;
			assert.ok(params.some((p) => p.in === 'header' && p.name === name), `${r.rel}#${r.index}: unknown header ${name}`);
		}
		for (const p of params.filter((x) => x.in === 'header' && x.required)) {
			assert.ok(r.request.headers?.[p.name], `${r.rel}#${r.index}: required header ${p.name} is missing`);
		}
		const bodySchema = resolveRef(operation.requestBody?.content?.['application/json']?.schema);
		if (!bodySchema) {
			assert.ok(r.request.body === undefined || (typeof r.request.body === 'object' && Object.keys(r.request.body).length === 0),
				`${r.rel}#${r.index}: ${method} ${path} takes no body`);
			continue;
		}
		const keys = Object.keys(r.request.body ?? {});
		for (const key of keys) assert.ok(bodySchema.properties[key], `${r.rel}#${r.index}: unknown body field ${key}`);
		for (const key of bodySchema.required ?? []) assert.ok(keys.includes(key), `${r.rel}#${r.index}: required body field ${key} is missing`);
	}
});

test('list requests stay within pageSize 100 and page through the whole list', () => {
	for (const r of all.filter((x) => x.request.qs?.pageSize !== undefined)) {
		assert.ok(r.request.qs.pageSize <= 100, `${r.rel}: pageSize ${r.request.qs.pageSize}`);
		if (r.request.pagination) {
			assert.equal(r.request.pagination.qs.page, '{{pagination.page}}', `${r.rel}: one-based page from Make`);
			assert.equal(r.request.pagination.condition, '{{body.page * body.pageSize < body.total}}', `${r.rel}: stop after the last page`);
			assert.equal(r.request.response.iterate, '{{body.items}}', `${r.rel}: iterate the items`);
			assert.ok(r.request.response.limit, `${r.rel}: has a limit`);
		}
	}
});

test('binary downloads parse 200 as binary and errors as problem+json', () => {
	for (const r of all) {
		const method = r.request.method ?? 'GET';
		const [path] = resolvePaths(r, r.request.url);
		const { template } = findOperation(path, method);
		if (/\/(pdf|xml|upo|preview)$/.test(template)) {
			assert.deepEqual(r.request.response.type, { '*': 'json', 200: 'binary' }, r.rel);
			assert.equal(r.request.response.output.data, '{{body}}', r.rel);
		}
	}
});

test('the universal module only takes paths relative to the KSeF Canvas API', () => {
	const universal = requests(project).find((r) => r.id === 'makeApiCall');
	assert.equal(universal.request.url, "/{{replace(parameters.url, '/^//', emptystring)}}");
	assert.ok(!('baseUrl' in universal.request));
});
