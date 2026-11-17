function ksefFileName(invoiceNumber, documentType, fallbackId) {
	const base = String(invoiceNumber || fallbackId || 'invoice').split('/').join('_');
	if (documentType === 'upo') return 'UPO-' + base + '.xml';
	return base + '.' + (documentType === 'xml' ? 'xml' : 'pdf');
}
