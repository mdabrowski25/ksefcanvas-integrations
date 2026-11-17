'use strict';

// Get, validate, preview and issue a draft.

const { draftIdField, isBlank, text, toVersion } = require('../lib/fields');
const { fileName, stashBinary } = require('../lib/files');
const samples = require('../lib/samples');

const IRREVERSIBLE =
  'Irreversible: an invoice accepted by KSeF cannot be withdrawn, only corrected with a correction invoice ' +
  '(faktura korygująca). The key needs the invoices:issue scope.';

// A draft in one of these states already has an issue in progress or done; Rejected may be fixed and issued again.
const ISSUED_STATES = new Set(['Queued', 'Submitting', 'Processing', 'Accepted', 'ManualReview']);
const ISSUE_PAGE_SIZE = 100;
const ISSUE_PAGES = 5;

// Newest first, so the first match is the draft's latest issue.
const findIssueOfDraft = async (z, draftId) => {
  for (let page = 1; page <= ISSUE_PAGES; page += 1) {
    const response = await z.request({ url: '/v1/issues', params: { page, pageSize: ISSUE_PAGE_SIZE } });
    const { items = [], total } = response.data || {};
    const match = items.find((item) => item.draftId === draftId);
    if (match) return match;
    const totalCount = total === null || total === undefined ? NaN : Number(total);
    if (items.length < ISSUE_PAGE_SIZE || page * ISSUE_PAGE_SIZE >= totalCount) break;
  }
  throw new z.errors.Error(
    `This draft was already issued, but its issue is not among the ${ISSUE_PAGE_SIZE * ISSUE_PAGES} newest issues. ` +
      'Find it in KSeF Canvas.',
    'issue_not_found',
    409,
  );
};

const draftPath = (bundle, suffix = '') =>
  `/v1/drafts/${encodeURIComponent(String(bundle.inputData.draftId).trim())}${suffix}`;

const getDraft = {
  key: 'get_draft',
  noun: 'Draft',
  display: {
    label: 'Get Draft',
    description: 'Gets an invoice draft (szkic) with its lines, version and totals.',
  },
  operation: {
    inputFields: [draftIdField()],
    perform: async (z, bundle) => (await z.request({ url: draftPath(bundle) })).data,
    sample: samples.draft,
  },
};

const validateDraft = {
  key: 'validate_draft',
  noun: 'Draft',
  display: {
    label: 'Validate Draft',
    description: 'Checks a draft as KSeF Canvas would before issuing, without issuing it, and returns the problems found.',
  },
  operation: {
    inputFields: [draftIdField()],
    perform: async (z, bundle) => {
      const response = await z.request({ method: 'POST', url: draftPath(bundle, '/validate') });
      const result = response.data || {};
      const issues = Array.isArray(result.issues) ? result.issues : [];
      return {
        id: String(bundle.inputData.draftId).trim(),
        draftId: String(bundle.inputData.draftId).trim(),
        ...result,
        // One line per problem, for mapping into a message.
        problems: issues.map((issue) => (issue.field ? `${issue.field}: ${issue.message}` : issue.message)).join('\n'),
      };
    },
    sample: { id: samples.draft.id, draftId: samples.draft.id, ...samples.validation, problems: '' },
    outputFields: [
      { key: 'valid', label: 'Valid', type: 'boolean' },
      { key: 'problems', label: 'Problems' },
      { key: 'totals__grossGrosz', label: 'Gross Total (grosz)', type: 'integer' },
    ],
  },
};

const previewDraft = {
  key: 'preview_draft',
  noun: 'Draft',
  display: {
    label: 'Preview Draft PDF',
    description: 'Renders a draft as the PDF it would be issued as, without issuing it.',
  },
  operation: {
    inputFields: [draftIdField()],
    perform: async (z, bundle) => {
      const draftId = String(bundle.inputData.draftId).trim();
      const stored = await stashBinary(
        z,
        { method: 'POST', url: draftPath(bundle, '/preview') },
        fileName(null, `draft-preview-${draftId}`, 'pdf'),
        'application/pdf',
      );
      return { id: draftId, draftId, ...stored };
    },
    sample: {
      id: samples.draft.id,
      draftId: samples.draft.id,
      file: 'https://zapier-dev-files.s3.amazonaws.com/cli-platform/draft-preview.pdf',
      fileName: `draft-preview-${samples.draft.id}.pdf`,
      contentType: 'application/pdf',
      size: 48213,
    },
    outputFields: [
      { key: 'file', label: 'File', type: 'file' },
      { key: 'fileName', label: 'File Name' },
    ],
  },
};

const issueDraft = {
  key: 'issue_draft',
  noun: 'Invoice',
  display: {
    label: 'Issue Invoice in KSeF',
    description: `Sends a draft to KSeF as an invoice. The result arrives through the triggers or "Get Issue Status". ${IRREVERSIBLE}`,
  },
  operation: {
    inputFields: [
      draftIdField(`The draft (szkic) to issue. ${IRREVERSIBLE}`),
      {
        key: 'version',
        label: 'Draft Version',
        type: 'integer',
        required: false,
        helpText:
          'Optional. The draft version you checked, e.g. from "Create Draft" or "Validate Draft". ' +
          'Leave empty to issue the current version; if the draft was already issued (e.g. when this step is retried), its existing issue is returned instead. ' +
          'If the draft changes after the given version, issuing is refused.',
      },
      {
        key: 'idempotencyKey',
        label: 'Idempotency Key',
        type: 'string',
        required: false,
        helpText:
          'Advanced. Leave empty to use "<draft ID>:<version>", so a retry of this step returns the first result ' +
          'instead of a second invoice. Letters, digits and . _ : - only, up to 64 characters.',
      },
    ],
    perform: async (z, bundle) => {
      const draftId = String(bundle.inputData.draftId).trim();
      let version = bundle.inputData.version;
      if (isBlank(version)) {
        const draft = (await z.request({ url: draftPath(bundle) })).data || {};
        // Issuing moves the version on, so a retry of this step would build another key and get 409: return the first issue.
        if (ISSUED_STATES.has(draft.state)) {
          const issue = await findIssueOfDraft(z, draftId);
          return {
            id: issue.id,
            issueId: issue.id,
            draftId,
            state: issue.state,
            replay: true,
            alreadyIssued: true,
            version: draft.version,
            idempotencyKey: null,
          };
        }
        version = draft.version;
      }
      version = toVersion(z, version);
      const idempotencyKey = text(bundle.inputData.idempotencyKey) || `${draftId}:${version}`;
      const response = await z.request({
        method: 'POST',
        url: draftPath(bundle, '/issue'),
        headers: { 'Idempotency-Key': idempotencyKey },
        body: { version },
      });
      const accepted = response.data || {};
      return { id: accepted.issueId, ...accepted, alreadyIssued: false, version, idempotencyKey };
    },
    sample: {
      id: samples.issueAccepted.issueId,
      ...samples.issueAccepted,
      alreadyIssued: false,
      version: samples.draft.version,
      idempotencyKey: `${samples.draft.id}:${samples.draft.version}`,
    },
    outputFields: [
      { key: 'issueId', label: 'Issue ID' },
      { key: 'draftId', label: 'Draft ID' },
      { key: 'state', label: 'State' },
      { key: 'replay', label: 'Replay (same request seen before)', type: 'boolean' },
      { key: 'alreadyIssued', label: 'Already Issued Before This Step', type: 'boolean' },
      { key: 'version', label: 'Draft Version', type: 'integer' },
      { key: 'idempotencyKey', label: 'Idempotency Key' },
    ],
  },
};

module.exports = { getDraft, issueDraft, previewDraft, validateDraft };
