import { createHmac, timingSafeEqual } from 'crypto';
import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export type KsefCanvasContext =
	| IExecuteFunctions
	| ILoadOptionsFunctions
	| IHookFunctions
	| IWebhookFunctions;

export const CREDENTIAL_NAME = 'ksefCanvasApi';

const BASE_URLS: Record<string, string> = {
	live: 'https://api.ksefcanvas.pl',
	test: 'https://staging-api.ksefcanvas.pl',
};

export interface ApiResponse {
	statusCode: number;
	body: unknown;
	headers: IDataObject;
}

export interface RequestOptions {
	body?: IDataObject;
	qs?: IDataObject;
	headers?: IDataObject;
	/** Return the body as a Buffer (PDF and XML documents). */
	binary?: boolean;
	/** Return a 404 to the caller instead of throwing. */
	allowNotFound?: boolean;
	itemIndex?: number;
}

export interface Problem {
	status?: number;
	title?: string;
	detail?: string;
	code?: string;
	traceId?: string;
	errors?: Array<{ code?: string; field?: string; message?: string }>;
}

// English summaries for the stable error codes; the API's own detail (in Polish) follows in the description.
const SUMMARIES: Record<string, string> = {
	api_key_missing: 'No API key was sent',
	api_key_invalid: 'The API key is not valid',
	api_key_revoked: 'The API key was revoked in KSeF Canvas',
	api_key_environment_mismatch:
		'The API key belongs to the other environment: check the Environment in the credentials',
	insufficient_scope: 'The API key lacks the scope this operation needs',
	api_access_disabled: 'The KSeF Canvas API is not enabled for this firm',
	api_unavailable: 'The KSeF Canvas API is not available for this firm',
	api_plan_required: 'The KSeF Canvas API needs the Studio or Firma plan',
	issuance_access_expired: "The firm's access to issuing has expired",
	workspace_closing: 'The firm is being closed',
	workspace_deleted: 'The firm was deleted',
	account_blocked: "The firm owner's account is blocked",
	agreements_required: 'The firm owner must accept the current agreements in KSeF Canvas first',
	legal_acceptance_required: 'The firm owner must accept the current API terms in KSeF Canvas first',
	resource_not_found: 'Not found in this firm',
	document_not_ready: 'The document is not ready yet: KSeF has not accepted the invoice',
	resource_conflict:
		'The draft changed since it was read, or the idempotency key was already used for another draft or version',
	stripe_sale_draft: 'Drafts made from Stripe sales are issued in the KSeF Canvas app, not through the API',
	idempotency_key_required: 'An idempotency key is required to issue an invoice',
	idempotency_key_invalid: 'The idempotency key may have 1–64 letters, digits, dots, underscores, colons or dashes',
	validation_failed: 'KSeF Canvas did not accept the data',
	invalid_request: 'KSeF Canvas could not read the request',
	webhook_limit_reached:
		'The firm already has 3 webhooks, the KSeF Canvas limit. Remove an unused one in KSeF Canvas under Ustawienia → Integracje → API',
	rate_limited: 'Too many requests to KSeF Canvas',
	operation_paused: 'KSeF Canvas paused this operation for the moment',
	dispatch_disabled: 'Sending invoices to KSeF is switched off for this firm',
};

/** Returns the API base URL for the credentials' environment. */
export async function getBaseUrl(this: KsefCanvasContext): Promise<string> {
	const credentials = await this.getCredentials(CREDENTIAL_NAME);
	return BASE_URLS[credentials.environment as string] ?? BASE_URLS.live;
}

export async function ksefCanvasApiRequest(
	this: KsefCanvasContext,
	method: IHttpRequestMethods,
	path: string,
	options: RequestOptions = {},
): Promise<ApiResponse> {
	const request: IHttpRequestOptions = {
		method,
		baseURL: await getBaseUrl.call(this),
		url: path,
		headers: { Accept: options.binary ? '*/*' : 'application/json', ...options.headers },
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		json: !options.binary,
	};
	if (options.qs) request.qs = options.qs;
	if (options.body !== undefined) {
		request.body = options.body;
		request.headers = { ...request.headers, 'Content-Type': 'application/json' };
	}
	if (options.binary) request.encoding = 'arraybuffer';

	const response = (await this.helpers.httpRequestWithAuthentication.call(
		this,
		CREDENTIAL_NAME,
		request,
	)) as ApiResponse;
	if (response.statusCode === 404 && options.allowNotFound) return response;
	if (response.statusCode >= 400) throw toApiError(this, response, options.itemIndex);
	return response;
}

/** Reads the `items` of every page of a list endpoint, or the first `limit` items. */
export async function ksefCanvasApiRequestAllItems(
	this: KsefCanvasContext,
	path: string,
	qs: IDataObject,
	returnAll: boolean,
	limit: number,
	itemIndex?: number,
): Promise<IDataObject[]> {
	const pageSize = returnAll ? 100 : Math.max(1, Math.min(100, limit));
	const items: IDataObject[] = [];
	for (let page = 1; ; page++) {
		const { body } = await ksefCanvasApiRequest.call(this, 'GET', path, {
			qs: { ...qs, page, pageSize },
			itemIndex,
		});
		const result = body as { items?: IDataObject[]; total?: number };
		const pageItems = result.items ?? [];
		items.push(...pageItems);
		if (!returnAll && items.length >= limit) return items.slice(0, limit);
		if (pageItems.length < pageSize || items.length >= (result.total ?? 0)) return items;
	}
}

export function parseProblem(body: unknown): Problem {
	let value = body;
	if (value instanceof ArrayBuffer) value = Buffer.from(value);
	if (Buffer.isBuffer(value)) value = value.toString('utf8');
	if (typeof value === 'string') {
		const text = value;
		try {
			value = JSON.parse(text);
		} catch {
			return { detail: text.slice(0, 500) };
		}
	}
	return value && typeof value === 'object' ? (value as Problem) : {};
}

export function toApiError(
	context: KsefCanvasContext,
	response: ApiResponse,
	itemIndex?: number,
): NodeApiError {
	const problem = parseProblem(response.body);
	const code = problem.code ?? `http_${response.statusCode}`;
	const summary = SUMMARIES[code] ?? 'KSeF Canvas API error';
	const retryAfter = response.headers?.['retry-after'];
	const description = [
		problem.detail,
		...(problem.errors ?? []).map((issue) =>
			[issue.field, issue.message].filter(Boolean).join(': ') + (issue.code ? ` (${issue.code})` : ''),
		),
		retryAfter ? `Retry after ${String(retryAfter)} s.` : undefined,
		problem.traceId ? `Trace ID: ${problem.traceId}` : undefined,
	]
		.filter(Boolean)
		.join('\n');
	return new NodeApiError(context.getNode(), { ...problem, code } as JsonObject, {
		message: `${summary} (${code})`,
		description: description || undefined,
		httpCode: String(response.statusCode),
		itemIndex,
	});
}

/**
 * Checks `KsefCanvas-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>` and a 5-minute
 * replay window.
 */
export function verifySignature(
	secret: string,
	header: string | undefined,
	rawBody: Buffer,
	nowSeconds = Date.now() / 1000,
): boolean {
	if (!secret || !header) return false;
	const parts = new Map<string, string>();
	for (const part of header.split(',')) {
		const separator = part.indexOf('=');
		if (separator > 0) parts.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
	}
	const timestamp = parts.get('t');
	const signature = parts.get('v1');
	if (!timestamp || !/^\d+$/.test(timestamp) || !signature || !/^[0-9a-f]{64}$/.test(signature)) {
		return false;
	}
	if (Math.abs(nowSeconds - Number(timestamp)) > 300) return false;
	const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
	return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

const DATE = /^(\d{4}-\d{2}-\d{2})/;

/** Accepts YYYY-MM-DD or an ISO date-time and keeps the date. */
export function toDate(value: unknown, field: string): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	const match = DATE.exec(String(value).trim());
	if (!match) throw new Error(`${field} must be a date in the format YYYY-MM-DD`);
	return match[1];
}

/** Converts an amount in złoty (or the invoice currency) to grosz. */
export function toGrosz(value: unknown, field: string): number {
	const amount = typeof value === 'number' ? value : Number(String(value).replace(',', '.').trim());
	if (!Number.isFinite(amount)) throw new Error(`${field} must be a number, for example 123.45`);
	return Math.round(amount * 100);
}

export function cleanNip(value: unknown): string {
	return String(value ?? '').replace(/[\s-]/g, '');
}

export interface LineItemInput {
	name?: string;
	quantity?: number;
	unit?: string;
	netUnitPrice?: number | string;
	vatRate?: number | string;
	discountPercent?: number;
	pkwiu?: string;
}

export interface DraftFieldsInput {
	buyerName?: string;
	buyerNip?: string;
	buyerAddress?: string;
	paymentMethod?: string;
	lineItems?: LineItemInput[];
	issueDate?: string;
	supplyDate?: string;
	paymentDate?: string;
	bankAccount?: string;
	currency?: string;
	notes?: string;
}

/** Builds the API's draft `data` from the node's fields, sending only what the user filled in. */
export function buildDraftData(input: DraftFieldsInput): IDataObject {
	const data: IDataObject = {};
	const text = (key: keyof DraftFieldsInput, value: unknown) => {
		if (typeof value === 'string' && value.trim() !== '') data[key] = value.trim();
	};
	text('buyerName', input.buyerName);
	if (input.buyerNip && cleanNip(input.buyerNip) !== '') data.buyerNip = cleanNip(input.buyerNip);
	text('buyerAddress', input.buyerAddress);
	text('paymentMethod', input.paymentMethod);
	const issueDate = toDate(input.issueDate, 'Issue Date');
	const supplyDate = toDate(input.supplyDate, 'Supply Date');
	const paymentDate = toDate(input.paymentDate, 'Payment Due Date');
	if (issueDate) data.issueDate = issueDate;
	if (supplyDate) data.supplyDate = supplyDate;
	if (paymentDate) data.paymentDate = paymentDate;
	text('bankAccount', input.bankAccount);
	if (input.currency && input.currency.trim() !== '') data.currency = input.currency.trim().toUpperCase();
	text('notes', input.notes);
	data.lines = (input.lineItems ?? []).map((line, index) => {
		const position = `Line ${index + 1}`;
		if (!line.name || String(line.name).trim() === '') throw new Error(`${position}: Name is required`);
		const vatRate = Number(line.vatRate ?? 23);
		if (!Number.isFinite(vatRate)) throw new Error(`${position}: VAT Rate must be a number`);
		return {
			name: String(line.name).trim(),
			quantity: Number(line.quantity ?? 1),
			unit: line.unit && String(line.unit).trim() !== '' ? String(line.unit).trim() : 'szt.',
			netUnitPriceGrosz: toGrosz(line.netUnitPrice ?? 0, `${position}: Net Unit Price`),
			discountPercent: Number(line.discountPercent ?? 0),
			vatRate,
			pkwiu: line.pkwiu && String(line.pkwiu).trim() !== '' ? String(line.pkwiu).trim() : null,
		};
	});
	return data;
}

/** The file name a document gets: from the invoice number, else Content-Disposition, else the issue id. */
export function documentFileName(
	invoiceNumber: unknown,
	headers: IDataObject,
	issueId: string,
	documentType: string,
): string {
	const base = String(invoiceNumber ?? '').trim().replace(/[\\/:*?"<>|\s]+/g, '_');
	if (base) return documentType === 'upo' ? `UPO-${base}.xml` : `${base}.${documentType}`;
	const disposition = String(headers?.['content-disposition'] ?? '');
	const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
	if (encoded) {
		try {
			return decodeURIComponent(encoded[1].trim());
		} catch {
			// fall through to the plain name
		}
	}
	const plain = /filename="?([^";]+)"?/i.exec(disposition);
	if (plain) return plain[1].trim();
	return documentType === 'upo' ? `UPO-${issueId}.xml` : `${issueId}.${documentType}`;
}

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,64}$/;

export const FINAL_STATES = ['Accepted', 'Rejected', 'ManualReview'];
