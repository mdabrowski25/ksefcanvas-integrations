it('puts an English summary before the Polish detail and the code', () => {
	const body = { status: 404, title: 'Not Found', detail: 'Dokument nie jest jeszcze gotowy.', code: 'document_not_ready' };
	assert.strictEqual(
		ksefErrorMessage(404, body, undefined, 'invoices:read'),
		'[404] The document is not ready yet: it is available once KSeF accepts the invoice. Dokument nie jest jeszcze gotowy. (code: document_not_ready)'
	);
});

it('names the missing scope', () => {
	const body = { status: 403, detail: 'Klucz nie ma wymaganego zakresu.', code: 'insufficient_scope' };
	assert.strictEqual(
		ksefErrorMessage(403, body, undefined, 'invoices:issue'),
		'[403] The API key lacks the invoices:issue scope. Create a key in KSeF Canvas under Ustawienia → Integracje → API with that scope. Klucz nie ma wymaganego zakresu. (code: insufficient_scope)'
	);
});

it('lists field errors of a 422 in both shapes', () => {
	const list = { status: 422, detail: 'Szkic zawiera błędy.', code: 'validation_failed', errors: [{ code: 'required', field: 'lines', message: 'Dodaj co najmniej jedną pozycję.' }] };
	assert.strictEqual(
		ksefErrorMessage(422, list, undefined, 'drafts:write'),
		'[422] KSeF Canvas found problems in the data. Szkic zawiera błędy. Fields: lines: Dodaj co najmniej jedną pozycję. (code: validation_failed)'
	);
	const map = { status: 422, code: 'validation_failed', errors: { buyerNip: ['NIP ma 10 cyfr.'] } };
	assert.strictEqual(ksefErrorMessage(422, map, null, ''), '[422] KSeF Canvas found problems in the data. Fields: buyerNip: NIP ma 10 cyfr. (code: validation_failed)');
});

it('reports Retry-After on 429', () => {
	const body = { status: 429, detail: 'Za dużo zapytań.', code: 'rate_limited' };
	assert.strictEqual(
		ksefErrorMessage(429, body, '12', ''),
		'[429] Too many requests: 120 a minute per key, 300 per firm, 30 issue calls a minute per firm. Retry after 12 s. Za dużo zapytań. (code: rate_limited)'
	);
});

it('parses a problem+json body that arrived as text and keeps the trace id', () => {
	const text = JSON.stringify({ status: 409, detail: 'Wersja szkicu się zmieniła.', code: 'resource_conflict', traceId: '00-abc-01' });
	assert.strictEqual(
		ksefErrorMessage(409, text, undefined, 'invoices:issue'),
		'[409] The draft changed since its version was read, or the idempotency key was already used for another request. Wersja szkicu się zmieniła. (code: resource_conflict, trace: 00-abc-01)'
	);
});

it('falls back to the status for unknown codes and non-JSON bodies', () => {
	assert.strictEqual(ksefErrorMessage(409, { code: 'credentials_missing' }, undefined, ''), '[409] The firm is not ready to issue invoices in KSeF. Check the firm in KSeF Canvas. (code: credentials_missing)');
	assert.strictEqual(ksefErrorMessage(502, '<html>Bad gateway</html>', undefined, ''), '[502] KSeF Canvas or KSeF is temporarily unavailable. Reads are safe to retry; retry an issue with the same idempotency key. <html>Bad gateway</html>');
	assert.strictEqual(ksefErrorMessage(418, undefined, undefined, ''), '[418] KSeF Canvas returned an error.');
});

it('keeps the message under the Make limit', () => {
	const body = { status: 422, code: 'validation_failed', detail: 'x'.repeat(2000) };
	assert.strictEqual(ksefErrorMessage(422, body, undefined, '').length, 1000);
});
