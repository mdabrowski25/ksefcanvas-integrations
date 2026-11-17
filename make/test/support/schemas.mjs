// Validates code files with the JSON schemas the Make Apps Editor uses (vendored in ../editor-schemas).
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'editor-schemas');

let ajv;
export function editorSchemas() {
	if (ajv) return ajv;
	const Ajv = require('ajv');
	// strict:false: the schemas use editor-only keywords; unicodeRegExp:false: some patterns are not valid with the `u` flag.
	ajv = new (Ajv.default ?? Ajv)({ allErrors: true, strict: false, unicodeRegExp: false, validateFormats: false });
	for (const name of readdirSync(SCHEMA_DIR).filter((n) => n.endsWith('.json'))) {
		ajv.addSchema(JSON.parse(readFileSync(join(SCHEMA_DIR, name), 'utf8')), name);
	}
	return ajv;
}

/** Returns a list of readable schema errors, empty when valid. */
export function schemaErrors(schemaName, data) {
	const validate = editorSchemas().getSchema(schemaName);
	if (!validate) throw new Error(`No editor schema ${schemaName}`);
	if (validate(data)) return [];
	return validate.errors.map((e) => `${e.instancePath || '/'} ${e.message} ${JSON.stringify(e.params)}`);
}
