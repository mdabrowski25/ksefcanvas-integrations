function ksefExistingIssueId(found, draftId) {
	if (found && found.id) return found.id;
	throw new Error('Draft ' + draftId + ' is already issued, but its issue is not among the 500 newest issues. Find it with List Issued Invoices or in KSeF Canvas.');
}
