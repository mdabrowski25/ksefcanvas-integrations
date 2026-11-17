'use strict';

// Hidden polling triggers that fill the dynamic dropdowns (drafts, issues, clients).

const samples = require('../lib/samples');

const PAGE_SIZE = 50;

const money = (grosz, currency) => {
  const value = Number(grosz);
  if (!Number.isFinite(value)) return '';
  return `${(value / 100).toFixed(2)} ${currency || 'PLN'}`;
};

const page = async (z, bundle, url, params = {}) => {
  const response = await z.request({
    url,
    params: { ...params, page: (bundle.meta && bundle.meta.page ? bundle.meta.page : 0) + 1, pageSize: PAGE_SIZE },
  });
  return (response.data && response.data.items) || [];
};

const hidden = (key, noun, label, perform, sample) => ({
  key,
  noun,
  display: { label, description: `Lists ${noun.toLowerCase()} records for dropdowns.`, hidden: true },
  operation: { perform, canPaginate: true, sample },
});

const draftLabel = (d) =>
  [d.invoiceNumber || d.buyerName || 'Draft', d.invoiceNumber ? d.buyerName : null, money(d.grossGrosz, d.currency), d.issueDate]
    .filter(Boolean)
    .join(' · ');

const issueLabel = (i) =>
  [i.invoiceNumber, i.buyerName, money(i.grossGrosz, i.currency), i.state].filter(Boolean).join(' · ');

const clientLabel = (c) => (c.nip ? `${c.name} (${c.nip})` : c.name);

const draftList = hidden(
  'draft_list',
  'Draft',
  'List Drafts',
  async (z, bundle) => (await page(z, bundle, '/v1/drafts')).map((d) => ({ ...d, label: draftLabel(d) })),
  { ...samples.draftSummary, label: draftLabel(samples.draftSummary) },
);

const issueList = hidden(
  'issue_list',
  'Issue',
  'List Issued Invoices',
  async (z, bundle) => (await page(z, bundle, '/v1/issues')).map((i) => ({ ...i, label: issueLabel(i) })),
  { ...samples.issueSummary, label: issueLabel(samples.issueSummary) },
);

const clientList = hidden(
  'client_list',
  'Client',
  'List Clients',
  async (z, bundle) =>
    (await page(z, bundle, '/v1/clients')).filter((c) => !c.isArchived).map((c) => ({ ...c, label: clientLabel(c) })),
  { ...samples.client, label: clientLabel(samples.client) },
);

module.exports = { clientList, draftList, issueList };
