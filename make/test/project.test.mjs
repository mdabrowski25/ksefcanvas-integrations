// The local project is complete and in the Make Apps Editor's format, and every code file passes Make's editor schemas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, relative } from 'node:path';
import {
	CODE_FILE_NAMES, CODE_SCHEMAS, COMPONENT_TYPES, MAKE_DIR, PLACEHOLDER, SRC_DIR,
	calledFunctions, camelToKebab, imlExpressions, listFiles, loadProject, readJson, toPosix, unfilledOrigins, walkParams,
} from '../scripts/lib/project.mjs';
import { schemaErrors } from './support/schemas.mjs';

const project = loadProject();
const { makecomapp } = project;
const components = makecomapp.components;

test('every JSON file in the Make folder parses as strict JSON', () => {
	const files = listFiles(MAKE_DIR).filter((f) => !/[\\/](node_modules|\.git)[\\/]/.test(f) && f.endsWith('.json'));
	assert.ok(files.length > 100, `only ${files.length} JSON files found`);
	for (const file of files) readJson(file);
});

test('makecomapp.json matches the Make Apps Editor schema', () => {
	// Origins keep the editor's "-FILL-ME-" placeholders until the owner creates the app; check the rest with filled values.
	const filled = structuredClone(makecomapp);
	for (const origin of filled.origins) {
		if (origin.label.includes(PLACEHOLDER)) origin.label = 'KSeF Canvas';
		if (origin.baseUrl.includes(PLACEHOLDER)) origin.baseUrl = 'https://eu1.make.com/api';
		if (origin.appId.includes(PLACEHOLDER)) origin.appId = 'ksef-canvas-example';
	}
	assert.deepEqual(schemaErrors('makecomapp.schema.json', filled), []);
	assert.equal(makecomapp.fileVersion, 1);
});

test('origins are either filled or hold the editor placeholders, and keep the token outside the project', () => {
	assert.equal(makecomapp.origins.length, 1);
	const [origin] = makecomapp.origins;
	assert.equal(origin.apikeyFile, '../.secrets/apikey');
	if (unfilledOrigins(makecomapp).length === 0) {
		assert.match(origin.baseUrl, /^https:\/\/[a-z0-9.-]+\.make\.com\/api$/);
		assert.match(origin.appId, /^[a-z][0-9a-z-]+[0-9a-z]$/);
	}
});

test('component IDs follow Make naming rules', () => {
	const rules = {
		connection: /^[a-zA-Z][0-9a-zA-Z-]{1,33}[0-9a-zA-Z]$/,
		webhook: /^[a-zA-Z][0-9a-zA-Z-]{1,33}[0-9a-zA-Z]$/,
		module: /^[a-zA-Z][0-9a-zA-Z]{2,47}$/,
		rpc: /^[a-zA-Z][0-9a-zA-Z]{2,47}$/,
		function: /^[a-zA-Z][0-9a-zA-Z]{1,94}[0-9a-zA-Z]$/,
	};
	for (const [type, rule] of Object.entries(rules)) {
		for (const id of Object.keys(components[type])) assert.match(id, rule, `${type} ${id}`);
	}
});

test('code files use the editor layout <type>s/<id>/<id>.<code>.<ext> and nothing is orphaned', () => {
	const referenced = new Set(project.codes.map((c) => c.rel));
	for (const c of project.codes.filter((x) => x.componentType !== 'general')) {
		const name = CODE_FILE_NAMES[c.componentType][c.codeType];
		assert.ok(name, `${c.componentType} ${c.id}: unknown code ${c.codeType}`);
		const ext = c.componentType === 'function' ? 'js' : 'iml.json';
		const dir = camelToKebab(c.id);
		assert.equal(c.rel, `${c.componentType}s/${dir}/${dir}.${name}.${ext}`);
	}
	const onDisk = listFiles(SRC_DIR).map((f) => toPosix(relative(SRC_DIR, f))).filter((f) => f !== 'makecomapp.json');
	assert.deepEqual(onDisk.filter((f) => !referenced.has(f)), [], 'files not listed in makecomapp.json');
});

test('each component has the codes the editor expects for its type', () => {
	for (const [id, m] of Object.entries(components.module)) {
		const expected = ['communication', 'staticParams', 'mappableParams', 'interface', 'samples'];
		if (['trigger', 'action', 'search', 'universal'].includes(m.moduleType)) expected.push('scope');
		if (m.moduleType === 'trigger') expected.push('epoch');
		assert.deepEqual(Object.keys(m.codeFiles).sort(), expected.sort(), `module ${id}`);
	}
	for (const [id, w] of Object.entries(components.webhook)) {
		assert.deepEqual(Object.keys(w.codeFiles).sort(), ['attach', 'communication', 'detach', 'params', 'requiredScope', 'update'], `webhook ${id}`);
		assert.equal(w.webhookType, 'web', `webhook ${id} is a dedicated webhook`);
	}
	for (const [id, r] of Object.entries(components.rpc)) assert.deepEqual(Object.keys(r.codeFiles).sort(), ['communication', 'params'], `rpc ${id}`);
	for (const [id, f] of Object.entries(components.function)) assert.deepEqual(Object.keys(f.codeFiles).sort(), ['code', 'test'], `function ${id}`);
	assert.deepEqual(Object.keys(components).sort(), [...COMPONENT_TYPES].sort());
});

test('modules, RPCs and webhooks use the connection; instant triggers use their webhook', () => {
	const connections = Object.keys(components.connection);
	assert.deepEqual(connections, ['ksefcanvas']);
	assert.equal(components.connection.ksefcanvas.connectionType, 'basic');
	for (const type of ['module', 'rpc', 'webhook']) {
		for (const [id, meta] of Object.entries(components[type])) {
			assert.equal(meta.connection, 'ksefcanvas', `${type} ${id}`);
		}
	}
	for (const [id, m] of Object.entries(components.module)) {
		if (m.moduleType === 'instant_trigger') assert.ok(components.webhook[m.webhook], `instant trigger ${id} needs a webhook`);
		else assert.equal(m.webhook, undefined, `module ${id} is not an instant trigger`);
		if (m.moduleType === 'action') assert.ok(['create', 'read', 'update', 'delete', null].includes(m.actionCrud), `module ${id} crud`);
		assert.ok(m.label && m.description, `module ${id} has a label and a description`);
	}
	assert.equal(Object.values(components.module).filter((m) => m.moduleType === 'universal').length, 1, 'one universal module');
});

test('every code file passes the Make Apps Editor JSON schema for its code type', () => {
	let validated = 0;
	for (const c of project.codes) {
		if (c.componentType === 'function' || c.codeType === 'readme') continue;
		const schema = CODE_SCHEMAS[c.componentType]?.[c.codeType];
		if (schema === undefined) assert.fail(`no schema mapping for ${c.componentType}.${c.codeType}`);
		if (schema === null) continue;
		assert.deepEqual(schemaErrors(schema, c.data), [], c.rel);
		validated += 1;
	}
	assert.ok(validated > 80, `only ${validated} files validated`);
});

test('webhook receivers use only the directives Make documents for incoming data', () => {
	for (const [id] of Object.entries(components.webhook)) {
		const receiver = project.codes.find((c) => c.componentType === 'webhook' && c.id === id && c.codeType === 'communication').data;
		const allowed = ['verification', 'respond', 'iterate', 'output', 'condition', 'uid'];
		assert.deepEqual(Object.keys(receiver).filter((k) => !allowed.includes(k)), [], `webhook ${id}`);
	}
});

test('groups list every module exactly once', () => {
	const groups = project.codes.find((c) => c.codeType === 'groups').data;
	const listed = groups.flatMap((g) => g.modules);
	assert.deepEqual([...listed].sort(), Object.keys(components.module).sort());
	assert.equal(new Set(listed).size, listed.length);
});

test('every rpc:// reference resolves and every RPC is used', () => {
	const used = new Set();
	for (const c of project.codes.filter((x) => x.componentType === 'module')) {
		walkParams(Array.isArray(c.data) ? c.data : [], (p) => {
			const ref = typeof p.options === 'string' ? p.options : p.options?.store;
			if (typeof ref === 'string' && ref.startsWith('rpc://')) {
				const name = ref.slice('rpc://'.length);
				assert.ok(components.rpc[name], `${c.rel}: unknown RPC ${name}`);
				used.add(name);
			}
		});
	}
	assert.deepEqual(Object.keys(components.rpc).filter((r) => !used.has(r)), []);
});

test('every function called in IML is a built-in or one of the app functions, and every app function is used', () => {
	const builtIns = new Set(('get if ifempty switch omit pick ascii base64 capitalize contains decodeURL encodeURL escapeHTML escapeMarkdown '
		+ 'indexOf length lower md5 mime replace replaceEmojiCharacters sha1 sha256 sha512 split startcase stripHTML substring toBinary '
		+ 'toString trim upper add deduplicate distinct first flatten join keys last map merge remove reverse shuffle slice sort toArray '
		+ 'toCollection formatDate parseDate addDays addHours addMinutes addMonths addSeconds addYears setSecond setMinute setHour setDay '
		+ 'setDate setMonth setYear abs average ceil floor formatNumber max median min parseNumber round stdevP sum trunc createJSON parseJSON').split(' '));
	const used = new Set();
	for (const c of project.codes.filter((x) => x.rel.endsWith('.json'))) {
		for (const expression of imlExpressions(c.data)) {
			for (const fn of calledFunctions(expression)) {
				if (builtIns.has(fn)) continue;
				assert.ok(components.function[fn], `${c.rel}: ${fn}() is neither built in nor an app function`);
				used.add(fn);
			}
		}
	}
	assert.deepEqual(Object.keys(components.function).filter((f) => !used.has(f)), []);
});

test('the app readme deployed to Make exists', () => {
	const readme = project.codes.find((c) => c.codeType === 'readme');
	assert.equal(readme.rel, 'README.md');
	assert.match(readme.data, /KSeF Canvas/);
	assert.ok(join(SRC_DIR, readme.rel));
});
