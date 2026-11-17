'use strict';

// Sample records in the shapes of openapi-v1.json, used as Zapier samples and as test fixtures.

const FIRM_ID = '3f0c1d52-7c1e-4a8e-9a43-5d2a3c4b1e01';
const DRAFT_ID = '8b6f3c1a-2d4e-4f5a-9b7c-1e2d3f4a5b6c';
const ISSUE_ID = 'c2a9e7d4-5b3f-4e1a-8d6c-7f8e9a0b1c2d';
const LINE_ID = 'd4e5f6a7-b8c9-4d0e-8f1a-2b3c4d5e6f70';

const key = {
  prefix: 'kc_live_AbCd',
  name: 'Zapier',
  scopes: ['invoices:read', 'drafts:write', 'invoices:issue', 'webhooks:write'],
  environment: 'live',
  firm: { id: FIRM_ID, name: 'Przykładowa Firma sp. z o.o.', nip: '5252248481' },
};

const totals = {
  netGrosz: 10000,
  vatGrosz: 2300,
  grossGrosz: 12300,
  lines: [{ lineId: LINE_ID, netGrosz: 10000, vatGrosz: 2300, grossGrosz: 12300 }],
};

const draft = {
  id: DRAFT_ID,
  workspaceId: FIRM_ID,
  version: 2,
  state: 'Draft',
  invoiceNumber: '',
  sellerName: 'Przykładowa Firma sp. z o.o.',
  sellerNip: '5252248481',
  sellerAddress: 'ul. Prosta 12, 00-850 Warszawa',
  buyerName: 'Odbiorca sp. z o.o.',
  buyerNip: '7740001454',
  buyerAddress: 'ul. Przykładowa 1, 00-001 Warszawa',
  issueDate: '2026-11-17',
  supplyDate: '2026-11-17',
  paymentDate: '2026-12-01',
  paymentMethod: 'Transfer',
  bankAccount: '61109010140000071219812874',
  currency: 'PLN',
  notes: null,
  ksefOptionsJson: '{}',
  lines: [
    {
      id: LINE_ID,
      draftId: DRAFT_ID,
      position: 1,
      name: 'Usługa programistyczna',
      quantity: 1,
      unit: 'szt.',
      netUnitPriceGrosz: 10000,
      discountPercent: 0,
      vatRate: 23,
      pkwiu: null,
      createdAt: '2026-11-17T09:00:00+00:00',
      updatedAt: '2026-11-17T09:00:00+00:00',
    },
  ],
  totals,
};

const draftSummary = {
  id: DRAFT_ID,
  version: 2,
  state: 'Draft',
  invoiceNumber: '',
  buyerName: 'Odbiorca sp. z o.o.',
  buyerNip: '7740001454',
  issueDate: '2026-11-17',
  currency: 'PLN',
  grossGrosz: 12300,
  createdAt: '2026-11-17T09:00:00+00:00',
  updatedAt: '2026-11-17T09:00:00+00:00',
};

const validation = { valid: true, issues: [], totals };

const issueAccepted = { issueId: ISSUE_ID, draftId: DRAFT_ID, state: 'Queued', replay: false };

const issue = {
  id: ISSUE_ID,
  draftId: DRAFT_ID,
  state: 'Accepted',
  invoiceNumber: 'FV/2026/11/0042',
  ksefNumber: '5252248481-20261117-0100A1B2C3D4-E5',
  ksefReference: '20261117-SE-0100A1B2C3-D4E5F6A7B8-C9',
  rejection: null,
  documents: ['pdf', 'xml', 'upo'],
  createdAt: '2026-11-17T09:05:00+00:00',
  updatedAt: '2026-11-17T09:05:30+00:00',
};

const rejectedIssue = {
  ...issue,
  state: 'Rejected',
  ksefNumber: null,
  rejection: { code: '450', message: 'Błąd weryfikacji semantyki dokumentu faktury.' },
  documents: [],
};

const issueSummary = {
  id: ISSUE_ID,
  draftId: DRAFT_ID,
  state: 'Accepted',
  invoiceNumber: 'FV/2026/11/0042',
  buyerName: 'Odbiorca sp. z o.o.',
  buyerNip: '7740001454',
  issueDate: '2026-11-17',
  currency: 'PLN',
  grossGrosz: 12300,
  ksefNumber: '5252248481-20261117-0100A1B2C3D4-E5',
  createdAt: '2026-11-17T09:05:00+00:00',
  updatedAt: '2026-11-17T09:05:30+00:00',
};

const client = {
  id: 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b',
  workspaceId: FIRM_ID,
  name: 'Odbiorca sp. z o.o.',
  nip: '7740001454',
  address: 'ul. Przykładowa 1',
  postalCode: '00-001',
  city: 'Warszawa',
  countryCode: 'PL',
  detailsJson: null,
  isArchived: false,
  createdAt: '2026-10-01T10:00:00+00:00',
  updatedAt: '2026-10-01T10:00:00+00:00',
};

const product = {
  id: 'f1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
  workspaceId: FIRM_ID,
  name: 'Usługa programistyczna',
  unit: 'godz.',
  netUnitPriceGrosz: 15000,
  vatRate: 23,
  pkwiu: '62.01.11.0',
  detailsJson: null,
  isArchived: false,
  createdAt: '2026-10-01T10:00:00+00:00',
  updatedAt: '2026-10-01T10:00:00+00:00',
};

// One trigger item: the event's data, the event's envelope fields and the full issue.
const triggerItem = (event, fullIssue) => ({
  id: fullIssue.id,
  issueId: fullIssue.id,
  draftId: fullIssue.draftId,
  invoiceNumber: fullIssue.invoiceNumber,
  state: fullIssue.state,
  ksefNumber: fullIssue.ksefNumber,
  rejection: fullIssue.rejection,
  eventId: event === 'invoice.accepted' ? 'evt_0f1e2d3c4b5a69788796a5b4c3d2e1f0' : 'evt_1a2b3c4d5e6f70819283a4b5c6d7e8f9',
  eventType: event,
  livemode: true,
  createdAt: fullIssue.updatedAt,
  issue: fullIssue,
});

module.exports = {
  client,
  draft,
  draftSummary,
  issue,
  issueAccepted,
  issueSummary,
  key,
  product,
  rejectedIssue,
  triggerItem,
  validation,
};
