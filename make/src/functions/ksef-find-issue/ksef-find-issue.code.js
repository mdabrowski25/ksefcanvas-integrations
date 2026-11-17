function ksefFindIssue(items, draftId) {
	if (!Array.isArray(items) || !draftId) return null;
	const wanted = String(draftId).toLowerCase();
	for (const item of items) {
		if (item && String(item.draftId).toLowerCase() === wanted) return item;
	}
	return null;
}
