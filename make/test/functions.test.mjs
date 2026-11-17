// Runs each custom IML function's Make test file (it/assert, as Make's "Run IML test" does) in a V8 context,
// and checks the limits Make documents for custom IML functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { code, loadProject } from '../scripts/lib/project.mjs';

const project = loadProject();
const ids = Object.keys(project.makecomapp.components.function);

function load(id, globals = {}) {
	const context = vm.createContext({ Buffer, ...globals });
	vm.runInContext(code(project, 'function', id, 'code'), context, { filename: `${id}.code.js`, timeout: 1000 });
	return context;
}

for (const id of ids) {
	test(`function ${id}: Make test file passes`, () => {
		const results = [];
		const context = load(id, {
			assert,
			it(name, fn) {
				try { fn(); results.push([name, null]); } catch (error) { results.push([name, error]); }
			},
		});
		vm.runInContext(code(project, 'function', id, 'test'), context, { filename: `${id}.test.js`, timeout: 5000 });
		assert.ok(results.length > 0, 'no tests ran');
		for (const [name, error] of results) assert.equal(error, null, `${name}: ${error?.message}`);
	});

	test(`function ${id}: defines one function named like the component, within 5000 characters`, () => {
		const source = code(project, 'function', id, 'code');
		assert.ok(source.length <= 5000, `${source.length} characters`);
		assert.match(source, new RegExp(`^function ${id}\\(`));
		assert.equal([...source.matchAll(/^function /gm)].length, 1);
		assert.doesNotMatch(source, /\brequire\(|\bimport\b|\bfetch\(|process\./, 'no Node or network APIs');
		assert.equal(typeof load(id)[id], 'function');
	});
}

test('ksefDraftData formats dates the same without time zone data (EU summer time fallback)', () => {
	const withIntl = load('ksefDraftData').ksefDraftData;
	const noIntl = vm.createContext({});
	vm.runInContext('delete globalThis.Intl;', noIntl);
	vm.runInContext(code(project, 'function', 'ksefDraftData', 'code'), noIntl);
	const start = Date.UTC(2025, 0, 1);
	for (let t = start; t < Date.UTC(2028, 0, 1); t += 3 * 3600 * 1000 + 17 * 60 * 1000) {
		const iso = new Date(t).toISOString();
		const a = withIntl({ issueDate: iso, lines: [] }).issueDate;
		const b = noIntl.ksefDraftData({ issueDate: iso, lines: [] }).issueDate;
		assert.equal(b, a, iso);
	}
});

test('ksefDraftData converts prices to whole grosz for every cent value', () => {
	const fn = load('ksefDraftData').ksefDraftData;
	for (let cents = 0; cents <= 100000; cents += 7) {
		const price = cents / 100;
		const data = fn({ lines: [{ name: 'x', netUnitPrice: price }] });
		assert.equal(data.lines[0].netUnitPriceGrosz, cents, `${price}`);
	}
});
