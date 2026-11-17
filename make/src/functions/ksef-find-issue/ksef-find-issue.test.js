it('returns the newest issue of the draft', () => {
	const items = [
		{ id: 'i3', draftId: 'd2', state: 'Queued' },
		{ id: 'i2', draftId: 'D1', state: 'Accepted' },
		{ id: 'i1', draftId: 'd1', state: 'Rejected' }
	];
	assert.deepStrictEqual(ksefFindIssue(items, 'd1'), { id: 'i2', draftId: 'D1', state: 'Accepted' });
});

it('returns null when the draft has no issue on the page', () => {
	assert.strictEqual(ksefFindIssue([{ id: 'i1', draftId: 'd2' }], 'd1'), null);
	assert.strictEqual(ksefFindIssue(undefined, 'd1'), null);
	assert.strictEqual(ksefFindIssue([], ''), null);
});
