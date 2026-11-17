'use strict';

const authentication = require('./authentication');
const { addBaseUrlAndAuth, handleProblems } = require('./lib/http');
const { invoiceAccepted, invoiceRejected } = require('./triggers/invoice_events');
const { clientList, draftList, issueList } = require('./triggers/lists');
const createDraft = require('./creates/create_draft');
const { getDraft, issueDraft, previewDraft, validateDraft } = require('./creates/drafts');
const { downloadDocument, getIssue } = require('./creates/issues');
const { findClient, findIssue, findProduct } = require('./searches');

const byKey = (...operations) => Object.fromEntries(operations.map((operation) => [operation.key, operation]));

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,

  authentication,
  beforeRequest: [addBaseUrlAndAuth],
  afterResponse: [handleProblems],

  triggers: byKey(invoiceAccepted, invoiceRejected, draftList, issueList, clientList),
  creates: byKey(createDraft, getDraft, validateDraft, previewDraft, issueDraft, getIssue, downloadDocument),
  searches: byKey(findClient, findProduct, findIssue),
};
