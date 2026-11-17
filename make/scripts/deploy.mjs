#!/usr/bin/env node
// Deploys the local Make project in ../src to Make with Make's official CLI (@integromat/make-cli), which runs the
// same "Deploy to Make" as the Make Apps Editor for VS Code.
//
// Usage:
//   npm run deploy                         Dry run (default): checks the project and prints what would be deployed.
//   npm run deploy -- --apply              Deploys. Needs MAKE_API_TOKEN in the environment and a filled origin.
//   npm run deploy -- --apply --no-prompt  Passes --no-prompt to make-cli (it then picks its defaults without asking).
//
// The Make API token is read from the MAKE_API_TOKEN environment variable only. It is never printed, written to a file
// or passed as a command-line argument. The dry run makes no network request.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { COMPONENT_TYPES, MAKE_DIR, SRC_DIR, loadProject, unfilledOrigins } from './lib/project.mjs';

export const MAKE_CLI = '@integromat/make-cli@2.4.7';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const noPrompt = args.includes('--no-prompt');
const unknown = args.filter((a) => !['--apply', '--no-prompt'].includes(a));
if (unknown.length) {
	console.error(`Unknown option(s): ${unknown.join(' ')}. Use --apply and, optionally, --no-prompt.`);
	process.exit(2);
}

let project;
try {
	project = loadProject();
} catch (error) {
	console.error(`The local project is not valid: ${error.message}`);
	process.exit(1);
}
const { makecomapp, codes } = project;
const origins = makecomapp.origins ?? [];

console.log(apply ? 'Deploy to Make' : 'Dry run (nothing is sent to Make; add --apply to deploy)');
console.log(`Project: ${relative(process.cwd(), join(SRC_DIR, 'makecomapp.json')) || 'makecomapp.json'} (${codes.length} code files)`);

for (const [index, origin] of origins.entries()) {
	console.log(`Origin ${index + 1}: ${origin.label} | ${origin.baseUrl} | app ${origin.appId} v${origin.appVersion}`);
}
if (origins.length > 1) console.log('More than one origin is defined: make-cli asks which one to use (or uses the one chosen last time).');

for (const type of COMPONENT_TYPES) {
	const ids = Object.keys(makecomapp.components?.[type] ?? {});
	if (!ids.length) continue;
	const mapping = origins[0]?.idMapping?.[type] ?? [];
	const plan = ids.map((id) => {
		const mapped = mapping.find((m) => m.local === id);
		if (!mapped) return `${id} (new: make-cli asks how to pair it; choose "Deploy as new remote ${type}")`;
		return mapped.remote === null ? `${id} (ignored: mapped to null)` : `${id} -> ${mapped.remote}`;
	});
	console.log(`${type} (${ids.length}):\n  ${plan.join('\n  ')}`);
}

const command = ['npx', '--yes', MAKE_CLI, 'deploy', '--local-dir', MAKE_DIR, '--src-prefix', 'src', ...(noPrompt ? ['--no-prompt'] : [])];
console.log(`Command: ${command.map((c) => (/\s/.test(c) ? `"${c}"` : c)).join(' ')}`);

const problems = [];
if (unfilledOrigins(makecomapp).length) {
	problems.push('src/makecomapp.json still has "-FILL-ME-" placeholders in "origins": set label, baseUrl (for example https://eu1.make.com/api) and appId of the app you created in Make.');
}
for (const origin of origins) {
	if (!String(origin.baseUrl).includes('-FILL-ME-') && !/^https:\/\/[a-z0-9.-]+\.make\.com\/api$/.test(origin.baseUrl)) {
		problems.push(`Origin "${origin.label}": baseUrl must look like https://eu1.make.com/api (your Make zone).`);
	}
}
const tokenFile = origins[0]?.apikeyFile ? join(SRC_DIR, origins[0].apikeyFile) : null;
if (apply && !process.env.MAKE_API_TOKEN) {
	problems.push('MAKE_API_TOKEN is not set. Create a Make API token with the sdk-apps:read and sdk-apps:write scopes and export it for this command.');
}
if (tokenFile && existsSync(tokenFile)) {
	console.log(`Note: ${relative(MAKE_DIR, tokenFile)} exists; make-cli reads the token from that file before MAKE_API_TOKEN.`);
}

if (problems.length) {
	for (const p of problems) console.log(`${apply ? 'Blocked' : 'To do before --apply'}: ${p}`);
	if (apply) process.exit(1);
}
if (!apply) {
	console.log('Dry run finished. Run "npm test" first, then "npm run deploy -- --apply".');
	process.exit(0);
}

const shell = process.platform === 'win32';
const result = spawnSync(command[0], command.slice(1).map((c) => (shell && /\s/.test(c) ? `"${c}"` : c)), {
	cwd: MAKE_DIR,
	env: process.env,
	stdio: 'inherit',
	shell,
});
if (result.error) {
	console.error(`Could not start make-cli: ${result.error.message}`);
	process.exit(1);
}
if (result.status === 0) {
	console.log('Deployed. Commit src/makecomapp.json: make-cli records the remote component names in origins[].idMapping.');
}
process.exit(result.status ?? 1);
