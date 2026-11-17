it('returns the ID of the issue found for an already issued draft', () => {
	assert.strictEqual(ksefExistingIssueId({ id: 'i2', draftId: 'd1', state: 'Accepted' }, 'd1'), 'i2');
});

it('fails clearly when the issue was not found', () => {
	assert.throws(() => ksefExistingIssueId(null, 'd1'), /Draft d1 is already issued, but its issue is not among the 500 newest issues/);
});
