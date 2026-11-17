'use strict';

const App = require('../index');
const samples = require('../lib/samples');
const { api, appTester, parseError, problem, testAuth } = require('./helpers');

const search = (key, inputData) => appTester(App.searches[key].operation.perform, { authData: testAuth, inputData });

describe('searches', () => {
  it('finds clients by name', async () => {
    api()
      .get('/v1/clients')
      .query({ q: 'Odbiorca', page: 1, pageSize: 10 })
      .reply(200, { items: [samples.client], page: 1, pageSize: 10, total: 1 });

    expect(await search('find_client', { q: ' Odbiorca ' })).toEqual([samples.client]);
  });

  it('searches a formatted NIP as digits', async () => {
    api()
      .get('/v1/clients')
      .query({ q: '7740001454', page: 1, pageSize: 10 })
      .reply(200, { items: [], page: 1, pageSize: 10, total: 0 });

    expect(await search('find_client', { q: '774-000-14-54' })).toEqual([]);
  });

  it('finds products by name', async () => {
    api()
      .get('/v1/products')
      .query({ q: 'Usługa', page: 1, pageSize: 10 })
      .reply(200, { items: [samples.product], page: 1, pageSize: 10, total: 1 });

    expect(await search('find_product', { q: 'Usługa' })).toEqual([samples.product]);
  });

  it('finds an issue by id', async () => {
    api().get(`/v1/issues/${samples.issue.id}`).reply(200, samples.issue);

    expect(await search('find_issue', { issueId: samples.issue.id })).toEqual([samples.issue]);
  });

  it('returns no result for an unknown issue', async () => {
    api().get('/v1/issues/unknown').reply(...problem(404, 'resource_not_found', 'Nie znaleziono zasobu.'));

    expect(await search('find_issue', { issueId: 'unknown' })).toEqual([]);
  });

  it('still reports other errors', async () => {
    api().get('/v1/issues/x').reply(...problem(403, 'api_access_disabled', 'Dostęp do API jest wyłączony.'));

    const error = parseError(await search('find_issue', { issueId: 'x' }).catch((e) => e));

    expect(error).toMatchObject({ code: 'api_access_disabled', status: 403 });
    expect(error.message).toMatch(/^API access is switched off for this firm/);
  });
});

describe('dropdown triggers', () => {
  const list = (key, page = 0) =>
    appTester(App.triggers[key].operation.perform, { authData: testAuth, meta: { page }, inputData: {} });

  it('lists drafts with a readable label, page by page', async () => {
    api()
      .get('/v1/drafts')
      .query({ page: 2, pageSize: 50 })
      .reply(200, { items: [samples.draftSummary], page: 2, pageSize: 50, total: 51 });

    const [draft] = await list('draft_list', 1);

    expect(draft.id).toBe(samples.draftSummary.id);
    expect(draft.label).toBe('Odbiorca sp. z o.o. · 123.00 PLN · 2026-11-17');
  });

  it('lists issues and clients, leaving archived clients out', async () => {
    api()
      .get('/v1/issues')
      .query({ page: 1, pageSize: 50 })
      .reply(200, { items: [samples.issueSummary], page: 1, pageSize: 50, total: 1 });
    api()
      .get('/v1/clients')
      .query({ page: 1, pageSize: 50 })
      .reply(200, {
        items: [samples.client, { ...samples.client, id: 'archived', isArchived: true }],
        page: 1,
        pageSize: 50,
        total: 2,
      });

    const [issue] = await list('issue_list');
    const clients = await list('client_list');

    expect(issue.label).toBe('FV/2026/11/0042 · Odbiorca sp. z o.o. · 123.00 PLN · Accepted');
    expect(clients.map((c) => c.label)).toEqual(['Odbiorca sp. z o.o. (7740001454)']);
  });
});
