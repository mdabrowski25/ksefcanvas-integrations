// Reads the Make local project (src/makecomapp.json and its code files). No network, no writes.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAKE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SRC_DIR = join(MAKE_DIR, 'src');
export const DOCS_DIR = resolve(MAKE_DIR, '..', 'docs');

export const COMPONENT_TYPES = ['connection', 'webhook', 'module', 'rpc', 'function', 'endpoint'];
export const PLACEHOLDER = '-FILL-ME-';

/** Code type -> file name part, as the Make Apps Editor names local files. */
export const CODE_FILE_NAMES = {
	connection: { communication: 'communication', params: 'params', common: 'common' },
	webhook: { communication: 'communication', params: 'params', attach: 'attach', detach: 'detach', update: 'update', requiredScope: 'required-scope' },
	module: { communication: 'communication', epoch: 'epoch', staticParams: 'static-params', mappableParams: 'mappable-params', interface: 'interface', samples: 'samples', scope: 'scope' },
	rpc: { communication: 'communication', params: 'params' },
	function: { code: 'code', test: 'test' },
};

/** Editor JSON schema for each code, as the Make Apps Editor associates them. `null`: Make has no schema for it. */
export const CODE_SCHEMAS = {
	general: { base: 'base.json', groups: 'groups.json' },
	connection: { communication: 'api.json', params: 'parameters.json' },
	webhook: { communication: null, params: 'parameters.json', attach: 'api.json', detach: 'api.json', update: null, requiredScope: 'scope.json' },
	module: { communication: 'api.json', staticParams: 'parameters.json', mappableParams: 'parameters.json', interface: 'parameters.json', samples: 'samples.json', scope: 'scope.json' },
	rpc: { communication: 'api.json', params: 'parameters.json' },
};

export function camelToKebab(id) {
	return id.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export function readJson(path) {
	const text = readFileSync(path, 'utf8');
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(`${relative(MAKE_DIR, path)} is not valid JSON: ${error.message}`);
	}
}

export function listFiles(dir, found = []) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) listFiles(path, found);
		else found.push(path);
	}
	return found;
}

export function toPosix(path) {
	return path.split(sep).join('/');
}

/**
 * Loads makecomapp.json and every referenced code file.
 * Returns { makecomapp, codes } where codes is a list of { componentType, id, codeType, path, rel, data }.
 * `data` is parsed JSON for .json files and the raw text for .js/.md files.
 */
export function loadProject(srcDir = SRC_DIR) {
	const makecomapp = readJson(join(srcDir, 'makecomapp.json'));
	const codes = [];
	const add = (componentType, id, codeType, rel) => {
		if (rel === null || rel === undefined) return;
		const path = join(srcDir, rel);
		if (!existsSync(path)) throw new Error(`makecomapp.json references a missing file: ${rel}`);
		const data = rel.endsWith('.json') ? readJson(path) : readFileSync(path, 'utf8');
		codes.push({ componentType, id, codeType, path, rel, data });
	};
	for (const [codeType, rel] of Object.entries(makecomapp.generalCodeFiles ?? {})) add('general', 'app', codeType, rel);
	for (const type of COMPONENT_TYPES) {
		for (const [id, meta] of Object.entries(makecomapp.components?.[type] ?? {})) {
			if (!meta) continue;
			for (const [codeType, rel] of Object.entries(meta.codeFiles ?? {})) add(type, id, codeType, rel);
		}
	}
	return { makecomapp, codes };
}

export function code(project, componentType, id, codeType) {
	return project.codes.find((c) => c.componentType === componentType && c.id === id && c.codeType === codeType)?.data;
}

/** Every HTTP request definition of the app, with where it lives. Request arrays are flattened. */
export function requests(project) {
	const out = [];
	const push = (c, value) => {
		const list = Array.isArray(value) ? value : [value];
		list.forEach((request, index) => {
			if (request && typeof request === 'object' && Object.keys(request).length) out.push({ ...c, index, request });
		});
	};
	for (const c of project.codes) {
		if (c.componentType === 'connection' && c.codeType === 'communication') push(c, c.data);
		if (c.componentType === 'module' && c.codeType === 'communication') push(c, c.data);
		if (c.componentType === 'rpc' && c.codeType === 'communication') push(c, c.data);
		if (c.componentType === 'webhook' && (c.codeType === 'attach' || c.codeType === 'detach')) push(c, c.data);
	}
	return out;
}

/** Walks a parameter list, including select option nesting and array/collection specs. */
export function walkParams(params, visit, path = []) {
	if (!Array.isArray(params)) return;
	for (const p of params) {
		if (!p || typeof p !== 'object') continue;
		visit(p, path);
		if (Array.isArray(p.options)) {
			for (const option of p.options) if (Array.isArray(option.nested)) walkParams(option.nested, visit, [...path, p.name]);
		}
		if (p.spec) {
			const spec = p.spec;
			if (Array.isArray(spec)) walkParams(spec, visit, [...path, p.name]);
			else if (Array.isArray(spec.spec)) walkParams(spec.spec, visit, [...path, p.name]);
		}
	}
}

/** Every `{{...}}` expression in a JSON value (keys and string values). */
export function imlExpressions(value, out = []) {
	const scan = (text) => {
		for (const m of String(text).matchAll(/\{\{([\s\S]*?)\}\}/g)) out.push(m[1]);
	};
	if (typeof value === 'string') scan(value);
	else if (Array.isArray(value)) value.forEach((v) => imlExpressions(v, out));
	else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) {
			scan(k);
			imlExpressions(v, out);
		}
	}
	return out;
}

/** Function names called in an IML expression (string literals removed first). */
export function calledFunctions(expression) {
	const bare = expression.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");
	return [...bare.matchAll(/(?<![.\w])([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]);
}

/** Origins whose fields still hold the Make Apps Editor's "-FILL-ME-" placeholders. */
export function unfilledOrigins(makecomapp) {
	return (makecomapp.origins ?? []).filter((o) => ['label', 'baseUrl', 'appId', 'apikeyFile'].some((k) => String(o[k] ?? '').includes(PLACEHOLDER)));
}
