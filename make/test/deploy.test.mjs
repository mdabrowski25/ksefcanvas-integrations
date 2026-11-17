// The deploy script is a dry run by default and refuses to deploy without a filled origin and MAKE_API_TOKEN.
// These tests never reach Make: they stop before the script would start make-cli.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { MAKE_DIR, loadProject, unfilledOrigins } from '../scripts/lib/project.mjs';

const script = join(MAKE_DIR, 'scripts', 'deploy.mjs');
const env = { ...process.env };
delete env.MAKE_API_TOKEN;
const run = (args, extraEnv = {}) => spawnSync(process.execPath, [script, ...args], { cwd: MAKE_DIR, env: { ...env, ...extraEnv }, encoding: 'utf8' });

test('dry run lists the components and the make-cli command, and exits 0', () => {
	const result = run([]);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /^Dry run/);
	assert.match(result.stdout, /npx --yes @integromat\/make-cli@2\.4\.7 deploy --local-dir .+ --src-prefix src/);
	assert.match(result.stdout, /module \(14\)/);
	assert.match(result.stdout, /webhook \(2\)/);
});

test('--apply without MAKE_API_TOKEN is refused before anything starts', () => {
	const result = run(['--apply']);
	assert.equal(result.status, 1);
	assert.match(result.stdout, /Blocked: MAKE_API_TOKEN is not set/);
});

test('--apply with unfilled origins is refused even with a token, and the token is never printed', { skip: unfilledOrigins(loadProject().makecomapp).length === 0 && 'origin already filled' }, () => {
	const token = 'test-token-value-not-real-0123456789';
	const result = run(['--apply'], { MAKE_API_TOKEN: token });
	assert.equal(result.status, 1);
	assert.match(result.stdout, /Blocked: src\/makecomapp\.json still has "-FILL-ME-" placeholders/);
	assert.ok(!result.stdout.includes(token) && !result.stderr.includes(token));
});

test('unknown options are rejected', () => {
	assert.equal(run(['--force']).status, 2);
});
