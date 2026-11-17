function ksefDraftData(parameters) {
	const p = parameters || {};
	if (p.inputMode === 'json') {
		let json = p.dataJson;
		if (typeof json === 'string') {
			try { json = JSON.parse(json); } catch (e) { throw new Error('Draft Data (JSON) is not valid JSON: ' + e.message); }
		}
		if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('Draft Data (JSON) must be a JSON object.');
		return json;
	}
	const empty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
	const num = (v, fallback, label) => {
		if (empty(v)) return fallback;
		const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
		if (!isFinite(n)) throw new Error(label + ' is not a number: ' + v);
		return n;
	};
	const grosz = (value) => {
		const g = Math.round(Math.round(Math.abs(value) * 1e8) / 1e6);
		return g === 0 ? 0 : (value < 0 ? -g : g);
	};
	const day = (v, label) => {
		if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
		const d = v instanceof Date ? v : new Date(v);
		if (isNaN(d.getTime())) throw new Error(label + ' is not a date: ' + v);
		try {
			const parts = {};
			new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' })
				.formatToParts(d).forEach((x) => { parts[x.type] = x.value; });
			if (parts.year && parts.month && parts.day) return parts.year + '-' + parts.month + '-' + parts.day;
		} catch (e) { /* no time zone data: use the EU summer time rule below */ }
		const y = d.getUTCFullYear();
		const lastSunday = (month) => { const t = new Date(Date.UTC(y, month + 1, 0, 1)); return t.getTime() - t.getUTCDay() * 864e5; };
		const offset = d.getTime() >= lastSunday(2) && d.getTime() < lastSunday(9) ? 2 : 1;
		return new Date(d.getTime() + offset * 36e5).toISOString().slice(0, 10);
	};
	const data = {};
	['buyerName', 'buyerAddress', 'paymentMethod', 'bankAccount', 'currency', 'notes'].forEach((k) => {
		if (!empty(p[k])) data[k] = String(p[k]);
	});
	if (!empty(p.buyerNip)) data.buyerNip = String(p.buyerNip).replace(/[\s-]/g, '');
	[['issueDate', 'Issue Date'], ['supplyDate', 'Supply Date'], ['paymentDate', 'Payment Due Date']].forEach(([k, label]) => {
		if (!empty(p[k])) data[k] = day(p[k], label);
	});
	data.lines = (Array.isArray(p.lines) ? p.lines : []).map((item, i) => {
		const l = item || {};
		const at = 'Line item ' + (i + 1) + ': ';
		const line = {};
		if (!empty(l.name)) line.name = String(l.name);
		line.quantity = num(l.quantity, 1, at + 'Quantity');
		line.unit = empty(l.unit) ? 'szt.' : String(l.unit);
		if (!empty(l.netUnitPrice)) line.netUnitPriceGrosz = grosz(num(l.netUnitPrice, 0, at + 'Net Unit Price'));
		line.vatRate = num(l.vatRate, 23, at + 'VAT Rate');
		line.discountPercent = num(l.discountPercent, 0, at + 'Discount (%)');
		if (!empty(l.pkwiu)) line.pkwiu = String(l.pkwiu);
		return line;
	});
	return data;
}
