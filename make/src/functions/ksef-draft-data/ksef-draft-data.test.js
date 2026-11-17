it('sends only the fields the user filled in and applies the line defaults', () => {
	const data = ksefDraftData({
		inputMode: 'fields',
		buyerName: 'Odbiorca sp. z o.o.',
		buyerNip: '525-224-84 81',
		buyerAddress: '',
		paymentMethod: 'Transfer',
		lines: [{ name: 'Usługa', netUnitPrice: 100 }]
	});
	assert.deepStrictEqual(data, {
		buyerName: 'Odbiorca sp. z o.o.',
		paymentMethod: 'Transfer',
		buyerNip: '5252248481',
		lines: [{ name: 'Usługa', quantity: 1, unit: 'szt.', netUnitPriceGrosz: 10000, vatRate: 23, discountPercent: 0 }]
	});
});

it('converts net prices to grosz with half-up rounding', () => {
	const prices = [0.285, 1.005, 123.45, 19.99, 0.1 + 0.2, -0.285, '12,5', 0];
	const data = ksefDraftData({ paymentMethod: 'Cash', lines: prices.map((netUnitPrice) => ({ name: 'x', netUnitPrice })) });
	assert.deepStrictEqual(data.lines.map((l) => l.netUnitPriceGrosz), [29, 101, 12345, 1999, 30, -29, 1250, 0]);
});

it('keeps the selected VAT rate, quantity, unit, discount and PKWiU', () => {
	const data = ksefDraftData({
		paymentMethod: 'Transfer',
		lines: [{ name: 'Eksport', quantity: 2.5, unit: 'kg', netUnitPrice: 10, vatRate: -6, discountPercent: 5, pkwiu: '62.01' }]
	});
	assert.deepStrictEqual(data.lines[0], { name: 'Eksport', quantity: 2.5, unit: 'kg', netUnitPriceGrosz: 1000, vatRate: -6, discountPercent: 5, pkwiu: '62.01' });
});

it('formats dates as YYYY-MM-DD in Polish time', () => {
	const data = ksefDraftData({
		paymentMethod: 'Transfer',
		issueDate: '2026-11-16T23:30:00.000Z',
		supplyDate: '2026-07-01T22:00:00.000Z',
		paymentDate: '2026-12-01',
		lines: []
	});
	assert.strictEqual(data.issueDate, '2026-11-17');
	assert.strictEqual(data.supplyDate, '2026-07-02');
	assert.strictEqual(data.paymentDate, '2026-12-01');
});

it('sends Draft Data (JSON) unchanged', () => {
	const json = '{"buyerName":"Odbiorca","invoiceNumber":"FV/1","lines":[{"name":"A","netUnitPriceGrosz":100}]}';
	assert.deepStrictEqual(ksefDraftData({ inputMode: 'json', dataJson: json, buyerName: 'ignored' }), JSON.parse(json));
});

it('rejects Draft Data (JSON) that is not an object', () => {
	assert.throws(() => ksefDraftData({ inputMode: 'json', dataJson: '[1]' }), /must be a JSON object/);
	assert.throws(() => ksefDraftData({ inputMode: 'json', dataJson: '{oops' }), /not valid JSON/);
});

it('names the line of a value that is not a number', () => {
	assert.throws(() => ksefDraftData({ lines: [{ name: 'A', netUnitPrice: 'abc' }] }), /Line item 1: Net Unit Price is not a number/);
});
