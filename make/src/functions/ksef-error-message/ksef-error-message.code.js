function ksefErrorMessage(statusCode, body, retryAfter, requiredScope) {
	let p = body;
	if (typeof Buffer !== 'undefined' && Buffer.isBuffer(p)) p = p.toString('utf8');
	if (typeof p === 'string') {
		try { p = JSON.parse(p); } catch (e) { p = { detail: p.slice(0, 300) }; }
	}
	if (!p || typeof p !== 'object') p = {};
	const status = Number(statusCode) || Number(p.status) || 0;
	const code = typeof p.code === 'string' ? p.code : '';
	const wait = Number(Array.isArray(retryAfter) ? retryAfter[0] : retryAfter);
	const newKey = 'Create a key in KSeF Canvas under Ustawienia → Integracje → API';
	const rate = 'Too many requests: 120 a minute per key, 300 per firm, 30 issue calls a minute per firm.' + (wait > 0 ? ' Retry after ' + wait + ' s.' : '');
	const texts = {
		invalid_request: 'KSeF Canvas rejected the request as invalid.',
		idempotency_key_required: 'The Idempotency-Key header is missing.',
		idempotency_key_invalid: 'The idempotency key is invalid: use 1-64 characters A-Z, a-z, 0-9, ".", "_", ":" or "-".',
		api_key_missing: 'The API key is missing. Check the connection.',
		api_key_invalid: 'The API key is not valid. Check the connection.',
		api_key_revoked: 'The API key was revoked. ' + newKey + ' and update the connection.',
		api_key_environment_mismatch: 'The API key belongs to the other environment: kc_live_ keys work with Production, kc_test_ keys with Test.',
		insufficient_scope: 'The API key lacks the ' + (requiredScope || 'required') + ' scope. ' + newKey + ' with that scope.',
		api_access_disabled: 'API access is not enabled for this firm.',
		api_unavailable: 'API access is not enabled for this firm.',
		api_plan_required: "The firm's plan does not include API access.",
		account_blocked: 'The KSeF Canvas account is blocked.',
		workspace_closing: 'The firm is being closed in KSeF Canvas.',
		issuance_access_expired: "The firm's access to issuing invoices has expired.",
		resource_not_found: "Not found. Check the ID and that it belongs to the key's firm.",
		document_not_ready: 'The document is not ready yet: it is available once KSeF accepts the invoice.',
		resource_conflict: 'The draft changed since its version was read, or the idempotency key was already used for another request.',
		stripe_sale_draft: 'Drafts created from Stripe sales are issued in the KSeF Canvas Stripe inbox, not through the API.',
		agreements_required: 'The firm owner must first accept the current agreements in KSeF Canvas.',
		operation_paused: 'KSeF Canvas has paused this operation. Try again later.',
		webhook_limit_reached: 'The firm already has 3 webhook addresses, the most allowed. Remove unused webhooks in KSeF Canvas.',
		workspace_deleted: 'The firm was deleted in KSeF Canvas.',
		validation_failed: 'KSeF Canvas found problems in the data.',
		invalid_webhook_url: 'The webhook address must use https:// on port 443 with a public host name.',
		legal_acceptance_required: 'The firm owner must first accept the current API terms in KSeF Canvas.',
		rate_limited: rate,
		pdf_render_failed: 'KSeF Canvas could not render the PDF. Try again later.',
		upstream_timeout: 'KSeF did not answer in time. Retrying is safe; retry an issue with the same idempotency key.'
	};
	const readiness = ['verification_failed', 'ksef_permissions_missing', 'credentials_missing', 'dispatch_disabled'];
	const byStatus = {
		400: 'KSeF Canvas rejected the request.',
		401: 'KSeF Canvas did not accept the API key. Check the connection.',
		403: 'KSeF Canvas refused the operation.',
		404: 'Not found.',
		409: 'KSeF Canvas cannot do this in the current state.',
		410: 'The resource no longer exists.',
		422: 'KSeF Canvas found problems in the data.',
		429: rate
	};
	let summary = Object.prototype.hasOwnProperty.call(texts, code) ? texts[code] : '';
	if (!summary && readiness.indexOf(code) >= 0) summary = 'The firm is not ready to issue invoices in KSeF. Check the firm in KSeF Canvas.';
	if (!summary) summary = byStatus[status] || (status >= 500
		? 'KSeF Canvas or KSeF is temporarily unavailable. Reads are safe to retry; retry an issue with the same idempotency key.'
		: 'KSeF Canvas returned an error.');
	const fields = [];
	const errors = p.errors;
	if (Array.isArray(errors)) {
		errors.forEach((x) => { if (x && x.message) fields.push((x.field ? x.field + ': ' : '') + x.message); });
	} else if (errors && typeof errors === 'object') {
		Object.keys(errors).forEach((k) => [].concat(errors[k]).forEach((m) => fields.push(k + ': ' + m)));
	}
	let message = '[' + status + '] ' + summary;
	if (p.detail) message += ' ' + p.detail;
	if (fields.length) message += ' Fields: ' + fields.join('; ');
	if (code) message += ' (code: ' + code + (p.traceId ? ', trace: ' + p.traceId : '') + ')';
	return message.length > 1000 ? message.slice(0, 997) + '...' : message;
}
