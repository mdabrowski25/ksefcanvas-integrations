// Parses the parts of ../docs/DESIGN.md that the Make app must follow: tables, option lists and help texts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOCS_DIR } from '../../scripts/lib/project.mjs';

export const DESIGN_PATH = join(DOCS_DIR, 'DESIGN.md');

const strip = (cell) => cell.trim().replace(/^`(.*)`$/, '$1');

/** Markdown tables with the heading they follow. */
export function tables(markdown) {
	const lines = markdown.split(/\r?\n/);
	const out = [];
	let heading = '';
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		const h = line.match(/^#+\s+(.*)$/);
		if (h) heading = h[1].trim();
		if (line.startsWith('|') && lines[i + 1]?.startsWith('| ---')) {
			const header = line.split('|').slice(1, -1).map(strip);
			const rows = [];
			i += 2;
			while (i < lines.length && lines[i].startsWith('|')) {
				rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
				i += 1;
			}
			i -= 1;
			out.push({ heading, header, rows });
		}
	}
	return out;
}

/** The paragraph that starts with `start`, joined into one line. */
export function paragraph(markdown, start) {
	const lines = markdown.split(/\r?\n/);
	const first = lines.findIndex((l) => l.trimStart().startsWith(start));
	if (first < 0) throw new Error(`DESIGN.md has no paragraph starting with ${start}`);
	const out = [];
	for (let i = first; i < lines.length && lines[i].trim() !== ''; i += 1) out.push(lines[i].trim());
	return out.join(' ');
}

function skipParenthetical(text) {
	const t = text.trimStart();
	if (!t.startsWith('(')) return text;
	let depth = 0;
	for (let i = 0; i < t.length; i += 1) {
		if (t[i] === '(') depth += 1;
		if (t[i] === ')') depth -= 1;
		if (depth === 0) return t.slice(i + 1);
	}
	return text;
}

/** "Label `value`, Label `value` (default), ..." after the first "):" or ":" -> [{label, value, default}]. */
export function optionList(text, { max = Infinity } = {}) {
	const colon = text.indexOf('):') >= 0 ? text.indexOf('):') + 2 : text.indexOf(':') + 1;
	const rest = text.slice(colon);
	const options = [];
	let last = 0;
	for (const m of rest.matchAll(/`([^`]+)`/g)) {
		if (options.length >= max) break;
		let between = rest.slice(last, m.index);
		const isDefault = /^\s*\(default\)/.test(between);
		if (isDefault && options.length) options[options.length - 1].default = true;
		between = between.replace(/^\s*\(default\)/, '');
		if (options.length) between = skipParenthetical(between);
		const label = between.replace(/^[\s,]+/, '').trim();
		options.push({ label, value: m[1], default: false });
		last = m.index + m[0].length;
	}
	if (/^\s*\(default\)/.test(rest.slice(last)) && options.length) options[options.length - 1].default = true;
	return options;
}

export function loadDesign() {
	const md = readFileSync(DESIGN_PATH, 'utf8');
	const all = tables(md);
	const byHeading = (h) => all.filter((t) => t.heading === h);
	const [actions, searches] = byHeading('Actions');
	const connection = byHeading('Connection (credentials)')[0];
	const triggers = byHeading('Triggers (instant, REST hooks)')[0];
	const draftFields = byHeading('Create draft fields')[0];
	if (!actions || !searches || !connection || !triggers || !draftFields) throw new Error('DESIGN.md tables not found');

	const helpOf = (notes) => notes.match(/Help: "([^"]+)"/)?.[1];
	const issueSection = md.slice(md.indexOf('#### Issue'), md.indexOf('#### Documents'));
	const issueHelp = issueSection.match(/Help text: "([\s\S]+?)"/)?.[1].replace(/\s*\n\s*/g, ' ');
	const issuedStates = [...(issueSection.match(/`state` is ([\s\S]+?)\)/)?.[1] ?? '').matchAll(/`(\w+)`/g)].map((m) => m[1]);
	const outputBullet = paragraph(md, '- **Output.**');
	const deliveryBullet = paragraph(md, '- **Delivery.**');
	const dataFields = [...(deliveryBullet.match(/"data":\{(.*?)\}\}/)?.[1] ?? '').matchAll(/"(\w+)"/g)].map((m) => m[1]).filter((f) => !['code', 'message'].includes(f));
	const eventFields = [...outputBullet.matchAll(/`([a-z]\w*)`/g)].map((m) => m[1]).filter((f) => f !== 'data');

	return {
		markdown: md,
		connection: connection.rows.map(([field, label, notes]) => ({
			field: strip(field), label, notes, help: helpOf(notes),
			options: [...notes.matchAll(/`(\w+)` "([^"]+)"/g)].map((m) => ({ value: m[1], label: m[2], default: notes.slice(m.index + m[0].length).trimStart().startsWith('(default)') })),
		})),
		triggers: triggers.rows.map(([key, label, event]) => ({ key: strip(key), label, event: strip(event) })),
		actions: actions.rows.map(([key, label, call]) => ({ key: strip(key), label, call })),
		searches: searches.rows.map(([key, label, call]) => ({ key: strip(key), label, call })),
		draftFields: draftFields.rows.map(([field, label, notes]) => ({ field: strip(field), label, notes })),
		paymentMethods: optionList(paragraph(md, 'Payment methods (`paymentMethod`):')),
		vatRates: optionList(paragraph(md, 'VAT rates (`vatRate`):')),
		documentTypes: optionList(paragraph(md, '`documentType`:'), { max: 3 }),
		issueHelp,
		issuedStates,
		triggerOutput: [...dataFields, ...eventFields],
		idempotencyPattern: issueSection.match(/Allowed characters:\s*`([^`]+)`,\s*(\d+)[–-](\d+)/),
		advancedJsonLabel: md.match(/offer "([^"]+)" as an advanced alternative/)?.[1],
	};
}

/** "`POST /v1/drafts/{id}/issue`" -> [{method, path}], expanding "`GET /a/{id}/pdf`, `/xml` or `/upo`". */
export function calls(call) {
	const tokens = [...call.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
	const out = [];
	for (const token of tokens) {
		const full = token.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)$/);
		if (full) {
			out.push({ method: full[1], path: full[2].split('?')[0] });
		} else if (token.startsWith('/') && out.length) {
			const prev = out[0];
			out.push({ method: prev.method, path: prev.path.replace(/\/[^/]+$/, token) });
		}
	}
	return out;
}
