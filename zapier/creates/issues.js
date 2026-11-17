'use strict';

// Issue status and the issued invoice's documents.

const { DOCUMENT_TYPES, issueIdField } = require('../lib/fields');
const { fileName, stashBinary } = require('../lib/files');
const samples = require('../lib/samples');

const issuePath = (issueId, suffix = '') => `/v1/issues/${encodeURIComponent(String(issueId).trim())}${suffix}`;

const DOCUMENTS = {
  pdf: { extension: 'pdf', prefix: '', contentType: 'application/pdf' },
  xml: { extension: 'xml', prefix: '', contentType: 'application/xml' },
  upo: { extension: 'xml', prefix: 'UPO-', contentType: 'application/xml' },
};

const issueOutputFields = [
  { key: 'id', label: 'Issue ID' },
  { key: 'draftId', label: 'Draft ID' },
  { key: 'state', label: 'State' },
  { key: 'invoiceNumber', label: 'Invoice Number' },
  { key: 'ksefNumber', label: 'KSeF Number' },
  { key: 'ksefReference', label: 'KSeF Reference' },
  { key: 'rejection__code', label: 'Rejection Code' },
  { key: 'rejection__message', label: 'Rejection Message' },
  { key: 'createdAt', label: 'Created At', type: 'datetime' },
  { key: 'updatedAt', label: 'Updated At', type: 'datetime' },
];

const getIssue = {
  key: 'get_issue',
  noun: 'Issue',
  display: {
    label: 'Get Issue Status',
    description:
      'Gets the state of an issued invoice: Queued, Submitting, Processing, Accepted (with the KSeF number), Rejected (with the reason) or ManualReview.',
  },
  operation: {
    inputFields: [issueIdField()],
    perform: async (z, bundle) => (await z.request({ url: issuePath(bundle.inputData.issueId) })).data,
    sample: samples.issue,
    outputFields: issueOutputFields,
  },
};

const downloadDocument = {
  key: 'download_document',
  noun: 'Document',
  display: {
    label: 'Download Invoice Document',
    description:
      'Downloads the invoice PDF, the invoice XML or the UPO of an invoice KSeF has accepted, as a file for later steps.',
  },
  operation: {
    inputFields: [
      issueIdField(),
      {
        key: 'documentType',
        label: 'Document Type',
        type: 'string',
        required: true,
        default: 'pdf',
        choices: DOCUMENT_TYPES,
        helpText:
          'Invoice PDF (with the KSeF number and QR code), Invoice XML (FA(3) sent to KSeF) or UPO ' +
          '(KSeF’s official receipt, urzędowe poświadczenie odbioru). Ready once KSeF has accepted the invoice.',
      },
    ],
    perform: async (z, bundle) => {
      const issueId = String(bundle.inputData.issueId).trim();
      const documentType = String(bundle.inputData.documentType || 'pdf').trim().toLowerCase();
      const document = DOCUMENTS[documentType];
      if (!document) {
        throw new z.errors.Error(
          `Document Type must be pdf, xml or upo, got "${bundle.inputData.documentType}".`,
          'invalid_input',
          400,
        );
      }
      // The issue gives the invoice number for the file name.
      const issue = (await z.request({ url: issuePath(issueId) })).data || {};
      const stored = await stashBinary(
        z,
        { url: issuePath(issueId, `/${documentType}`) },
        fileName(issue.invoiceNumber, issueId, document.extension, document.prefix),
        document.contentType,
      );
      return {
        id: issueId,
        issueId,
        invoiceNumber: issue.invoiceNumber,
        ksefNumber: issue.ksefNumber,
        documentType,
        ...stored,
      };
    },
    sample: {
      id: samples.issue.id,
      issueId: samples.issue.id,
      invoiceNumber: samples.issue.invoiceNumber,
      ksefNumber: samples.issue.ksefNumber,
      documentType: 'pdf',
      file: 'https://zapier-dev-files.s3.amazonaws.com/cli-platform/FV_2026_11_0042.pdf',
      fileName: 'FV_2026_11_0042.pdf',
      contentType: 'application/pdf',
      size: 52817,
    },
    outputFields: [
      { key: 'file', label: 'File', type: 'file' },
      { key: 'fileName', label: 'File Name' },
      { key: 'invoiceNumber', label: 'Invoice Number' },
      { key: 'ksefNumber', label: 'KSeF Number' },
      { key: 'documentType', label: 'Document Type' },
    ],
  },
};

module.exports = { downloadDocument, getIssue, issueOutputFields, issuePath };
