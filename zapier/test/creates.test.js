'use strict';

const App = require('../index');
const samples = require('../lib/samples');
const { api, appTester, nock, parseError, problem, testAuth } = require('./helpers');

const perform = (key, inputData) => appTester(App.creates[key].operation.perform, { authData: testAuth, inputData });

describe('create_draft', () => {
  it('maps the form to the API: PLN to grosz, NIP cleanup, line defaults, only filled-in fields', async () => {
    let sent;
    api()
      .post('/v1/drafts', (body) => {
        sent = body;
        return true;
      })
      .reply(201, samples.draft);

    const result = await perform('create_draft', {
      buyerName: '  Odbiorca sp. z o.o. ',
      buyerNip: '774-000 14-54',
      buyerAddress: 'ul. Przykładowa 1, 00-001 Warszawa',
      issueDate: '2026-11-17',
      supplyDate: '',
      paymentMethod: 'Transfer',
      paymentDate: '2026-12-01',
      currency: 'eur',
      bankAccount: '',
      notes: '   ',
      lines: [
        { name: 'Usługa', netUnitPrice: '123.45' },
        {
          name: 'Licencja',
          quantity: '2,5',
          unit: 'godz.',
          netUnitPrice: '1 234,56',
          vatRate: '8',
          discountPercent: '10',
          pkwiu: '62.01.11.0',
        },
        { name: 'Zaokrąglenie', netUnitPrice: '1.005', vatRate: 'zw' },
        { name: '', netUnitPrice: '' },
      ],
    });

    expect(result.id).toBe(samples.draft.id);
    expect(sent).toEqual({
      data: {
        buyerName: 'Odbiorca sp. z o.o.',
        buyerNip: '7740001454',
        buyerAddress: 'ul. Przykładowa 1, 00-001 Warszawa',
        issueDate: '2026-11-17',
        paymentMethod: 'Transfer',
        paymentDate: '2026-12-01',
        currency: 'EUR',
        lines: [
          { name: 'Usługa', quantity: 1, unit: 'szt.', netUnitPriceGrosz: 12345, discountPercent: 0, vatRate: 23 },
          {
            name: 'Licencja',
            quantity: 2.5,
            unit: 'godz.',
            netUnitPriceGrosz: 123456,
            discountPercent: 10,
            vatRate: 8,
            pkwiu: '62.01.11.0',
          },
          { name: 'Zaokrąglenie', quantity: 1, unit: 'szt.', netUnitPriceGrosz: 101, discountPercent: 0, vatRate: -1 },
        ],
      },
    });
  });

  it('sends nothing but the payment method when nothing else is filled in', async () => {
    api().post('/v1/drafts', { data: { paymentMethod: 'Cash' } }).reply(201, samples.draft);

    await perform('create_draft', { paymentMethod: 'Cash', buyerName: '', lines: [] });
  });

  it('converts a timestamp with a zone to the date in Poland', async () => {
    api()
      .post('/v1/drafts', { data: { paymentMethod: 'Transfer', issueDate: '2026-11-18', supplyDate: '2026-11-17' } })
      .reply(201, samples.draft);

    await perform('create_draft', {
      paymentMethod: 'Transfer',
      issueDate: '2026-11-17T23:30:00Z',
      supplyDate: '2026-11-17T10:00:00',
    });
  });

  it('fills the buyer from a saved client, letting typed buyer fields win', async () => {
    api().get(`/v1/clients/${samples.client.id}`).reply(200, samples.client);
    api()
      .post('/v1/drafts', {
        data: {
          buyerName: 'Inna nazwa',
          buyerNip: '7740001454',
          buyerAddress: 'ul. Przykładowa 1, 00-001 Warszawa',
          paymentMethod: 'Transfer',
        },
      })
      .reply(201, samples.draft);

    await perform('create_draft', { clientId: samples.client.id, buyerName: 'Inna nazwa', paymentMethod: 'Transfer' });
  });

  it('sends Draft Data (JSON) unchanged and ignores the other fields', async () => {
    const data = {
      invoiceNumber: 'FV/2026/11/0042',
      paymentMethod: 'Card',
      ksefOptionsJson: '{"p16":true}',
      lines: [{ name: 'X', quantity: 1, unit: 'szt.', netUnitPriceGrosz: 100, discountPercent: 0, vatRate: 23, pkwiu: null }],
    };
    api().post('/v1/drafts', { data }).reply(201, samples.draft);

    await perform('create_draft', { draftData: JSON.stringify(data), buyerName: 'ignored', paymentMethod: 'Transfer' });
  });

  it('explains a price that is not a number before calling the API', async () => {
    const error = parseError(
      await perform('create_draft', { paymentMethod: 'Transfer', lines: [{ name: 'X', netUnitPrice: 'sto' }] }).catch((e) => e),
    );

    expect(error.message).toBe('Line 1: Net Unit Price "sto" is not a number.');
  });

  it('refuses Draft Data that is not a JSON object', async () => {
    const error = parseError(await perform('create_draft', { paymentMethod: 'Transfer', draftData: '[1]' }).catch((e) => e));

    expect(error.message).toBe('Draft Data (JSON) must be a JSON object.');
  });
});

describe('issue_draft', () => {
  it('reads the current version and sends Idempotency-Key <draftId>:<version>', async () => {
    api().get(`/v1/drafts/${samples.draft.id}`).reply(200, { ...samples.draft, version: 7 });
    api()
      .post(`/v1/drafts/${samples.draft.id}/issue`, { version: 7 })
      .matchHeader('idempotency-key', `${samples.draft.id}:7`)
      .reply(202, samples.issueAccepted);

    const result = await perform('issue_draft', { draftId: samples.draft.id });

    expect(result).toEqual({
      id: samples.issueAccepted.issueId,
      ...samples.issueAccepted,
      alreadyIssued: false,
      version: 7,
      idempotencyKey: `${samples.draft.id}:7`,
    });
  });

  it('uses the given version and idempotency key without reading the draft', async () => {
    api()
      .post(`/v1/drafts/${samples.draft.id}/issue`, { version: 3 })
      .matchHeader('idempotency-key', 'order-2026-0042')
      .reply(202, { ...samples.issueAccepted, replay: true });

    const result = await perform('issue_draft', { draftId: samples.draft.id, version: '3', idempotencyKey: 'order-2026-0042' });

    expect(result.replay).toBe(true);
  });

  it('returns the existing issue when a retry finds the draft already issued, without issuing again', async () => {
    api().get(`/v1/drafts/${samples.draft.id}`).reply(200, { ...samples.draft, state: 'Processing', version: 3 });
    const others = Array.from({ length: 100 }, (_, i) => ({ ...samples.issueSummary, id: `other-${i}`, draftId: `d-${i}` }));
    api()
      .get('/v1/issues')
      .query({ page: 1, pageSize: 100 })
      .reply(200, { items: others, page: 1, pageSize: 100, total: 150 });
    api()
      .get('/v1/issues')
      .query({ page: 2, pageSize: 100 })
      .reply(200, {
        items: [{ ...samples.issueSummary, state: 'Processing' }, { ...samples.issueSummary, id: 'older', state: 'Rejected' }],
        page: 2,
        pageSize: 100,
        total: 150,
      });

    const result = await perform('issue_draft', { draftId: samples.draft.id });

    expect(result).toEqual({
      id: samples.issue.id,
      issueId: samples.issue.id,
      draftId: samples.draft.id,
      state: 'Processing',
      replay: true,
      alreadyIssued: true,
      version: 3,
      idempotencyKey: null,
    });
  });

  it('issues a Rejected draft again normally', async () => {
    api().get(`/v1/drafts/${samples.draft.id}`).reply(200, { ...samples.draft, state: 'Rejected', version: 5 });
    api()
      .post(`/v1/drafts/${samples.draft.id}/issue`, { version: 5 })
      .matchHeader('idempotency-key', `${samples.draft.id}:5`)
      .reply(202, samples.issueAccepted);

    const result = await perform('issue_draft', { draftId: samples.draft.id });

    expect(result).toMatchObject({ alreadyIssued: false, replay: false, version: 5 });
  });

  it('stops after 5 pages when the issued draft has no issue among the newest', async () => {
    api().get(`/v1/drafts/${samples.draft.id}`).reply(200, { ...samples.draft, state: 'Accepted' });
    const page = Array.from({ length: 100 }, (_, i) => ({ ...samples.issueSummary, id: `other-${i}`, draftId: `d-${i}` }));
    for (let p = 1; p <= 5; p += 1) {
      api().get('/v1/issues').query({ page: p, pageSize: 100 }).reply(200, { items: page, page: p, pageSize: 100, total: 900 });
    }

    const error = parseError(await perform('issue_draft', { draftId: samples.draft.id }).catch((e) => e));

    expect(error).toMatchObject({ code: 'issue_not_found', status: 409 });
  });

  it('shows a version conflict', async () => {
    api()
      .post(`/v1/drafts/${samples.draft.id}/issue`)
      .reply(...problem(409, 'resource_conflict', 'Szkic zmienił się od odczytu.'));

    const error = parseError(await perform('issue_draft', { draftId: samples.draft.id, version: 2 }).catch((e) => e));

    expect(error).toMatchObject({ code: 'resource_conflict', status: 409 });
  });
});

describe('other draft actions', () => {
  it('gets a draft', async () => {
    api().get(`/v1/drafts/${samples.draft.id}`).reply(200, samples.draft);

    expect(await perform('get_draft', { draftId: samples.draft.id })).toEqual(samples.draft);
  });

  it('validates a draft and lists its problems', async () => {
    api()
      .post(`/v1/drafts/${samples.draft.id}/validate`)
      .reply(200, {
        valid: false,
        issues: [{ code: 'required', field: 'buyerNip', message: 'Podaj NIP nabywcy.' }],
        totals: samples.validation.totals,
      });

    const result = await perform('validate_draft', { draftId: samples.draft.id });

    expect(result).toMatchObject({ id: samples.draft.id, valid: false, problems: 'buyerNip: Podaj NIP nabywcy.' });
  });

  it('gets an issue', async () => {
    api().get(`/v1/issues/${samples.issue.id}`).reply(200, samples.issue);

    expect(await perform('get_issue', { issueId: samples.issue.id })).toEqual(samples.issue);
  });
});

describe('documents', () => {
  const S3 = 'https://zapier-stash.test.invalid';
  let uploaded;

  // z.stashFile asks Zapier's RPC for a presigned S3 form and uploads to it; both are mocked here.
  const mockStash = () => {
    uploaded = null;
    nock('https://rpc.zapier.com')
      .post('/cli')
      .reply(200, (uri, body) => {
        const { id } = typeof body === 'string' ? JSON.parse(body) : body;
        return { id, result: { url: `${S3}/`, fields: { key: 'stash/abc/${filename}' } } };
      });
    nock(S3)
      .post('/', (body) => {
        uploaded = body;
        return true;
      })
      .reply(204);
  };

  beforeEach(() => {
    process.env.ZAPIER_DEPLOY_KEY = 'fake-deploy-key-for-tests';
  });
  afterEach(() => {
    delete process.env.ZAPIER_DEPLOY_KEY;
  });

  it('stashes the invoice PDF under the invoice number', async () => {
    const pdf = Buffer.from('%PDF-1.7 fake invoice');
    api().get(`/v1/issues/${samples.issue.id}`).reply(200, samples.issue);
    api().get(`/v1/issues/${samples.issue.id}/pdf`).reply(200, pdf, { 'Content-Type': 'application/pdf' });
    mockStash();

    const result = await perform('download_document', { issueId: samples.issue.id, documentType: 'pdf' });

    expect(result).toMatchObject({
      id: samples.issue.id,
      invoiceNumber: 'FV/2026/11/0042',
      documentType: 'pdf',
      fileName: 'FV_2026_11_0042.pdf',
      contentType: 'application/pdf',
      size: pdf.length,
    });
    expect(result.file).toMatch(/^https:\/\/zapier-stash\.test\.invalid\/stash\/abc\//);
    expect(uploaded).toContain('filename="FV_2026_11_0042.pdf"');
    expect(uploaded).toContain('%PDF-1.7 fake invoice');
  });

  it('names the UPO UPO-<invoice number>.xml', async () => {
    api().get(`/v1/issues/${samples.issue.id}`).reply(200, samples.issue);
    api()
      .get(`/v1/issues/${samples.issue.id}/upo`)
      .reply(200, '<Potwierdzenie/>', { 'Content-Type': 'application/xml; charset=utf-8' });
    mockStash();

    const result = await perform('download_document', { issueId: samples.issue.id, documentType: 'upo' });

    expect(result).toMatchObject({ fileName: 'UPO-FV_2026_11_0042.xml', contentType: 'application/xml' });
  });

  it('explains a document that is not ready yet', async () => {
    api().get(`/v1/issues/${samples.issue.id}`).reply(200, { ...samples.issue, state: 'Processing', documents: [] });
    api()
      .get(`/v1/issues/${samples.issue.id}/xml`)
      .reply(...problem(404, 'document_not_ready', 'Dokument będzie dostępny po przyjęciu faktury przez KSeF.'));

    const error = parseError(await perform('download_document', { issueId: samples.issue.id, documentType: 'xml' }).catch((e) => e));

    expect(error).toMatchObject({ code: 'document_not_ready', status: 404 });
    expect(error.message).toMatch(/^The document is not ready yet/);
  });

  it('stashes the draft preview PDF', async () => {
    api()
      .post(`/v1/drafts/${samples.draft.id}/preview`)
      .reply(200, Buffer.from('%PDF-1.7 preview'), { 'Content-Type': 'application/pdf' });
    mockStash();

    const result = await perform('preview_draft', { draftId: samples.draft.id });

    expect(result).toMatchObject({ draftId: samples.draft.id, fileName: `draft-preview-${samples.draft.id}.pdf` });
  });
});
