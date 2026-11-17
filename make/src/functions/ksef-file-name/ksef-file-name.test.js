it('names the invoice PDF and XML after the invoice number', () => {
	assert.strictEqual(ksefFileName('FV/2026/11/0042', 'pdf'), 'FV_2026_11_0042.pdf');
	assert.strictEqual(ksefFileName('FV/2026/11/0042', 'xml'), 'FV_2026_11_0042.xml');
});

it('prefixes the UPO', () => {
	assert.strictEqual(ksefFileName('FV/2026/11/0042', 'upo'), 'UPO-FV_2026_11_0042.xml');
});

it('falls back to the issue ID without an invoice number', () => {
	assert.strictEqual(ksefFileName('', 'pdf', 'e4d3c2b1-a098-4f7e-8d6c-5b4a39281706'), 'e4d3c2b1-a098-4f7e-8d6c-5b4a39281706.pdf');
});
