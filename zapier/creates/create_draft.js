'use strict';

const {
  PAYMENT_METHODS,
  VAT_RATES,
  isBlank,
  normalizeDate,
  normalizeNip,
  parseDecimal,
  parseVatRate,
  text,
  toGrosz,
} = require('../lib/fields');
const samples = require('../lib/samples');

const DEFAULT_QUANTITY = 1;
const DEFAULT_UNIT = 'szt.';
const DEFAULT_VAT_RATE = 23;
const DEFAULT_DISCOUNT = 0;

const inputFields = [
  {
    key: 'clientId',
    label: 'Saved Client',
    type: 'string',
    required: false,
    dynamic: 'client_list.id.label',
    helpText:
      'Optional. Fills Buyer Name, Buyer NIP and Buyer Address from a client (kontrahent) saved in KSeF Canvas. ' +
      'The buyer fields below take precedence. Other saved client details are not copied.',
  },
  { key: 'buyerName', label: 'Buyer Name', type: 'string', required: false, helpText: 'The buyer (nabywca).' },
  {
    key: 'buyerNip',
    label: 'Buyer NIP',
    type: 'string',
    required: false,
    helpText: 'The buyer’s 10-digit NIP. Spaces and dashes are removed.',
  },
  {
    key: 'buyerAddress',
    label: 'Buyer Address',
    type: 'string',
    required: false,
    helpText: 'Street, postal code and city, e.g. "ul. Przykładowa 1, 00-001 Warszawa".',
  },
  {
    key: 'issueDate',
    label: 'Issue Date',
    type: 'string',
    required: false,
    helpText: 'Issue date (data wystawienia), YYYY-MM-DD. Default: today. A date and time is converted to the date in Poland.',
  },
  {
    key: 'supplyDate',
    label: 'Supply Date',
    type: 'string',
    required: false,
    helpText:
      'Supply date (data dostawy lub wykonania usługi), YYYY-MM-DD. Default: today. A date and time is converted to the date in Poland.',
  },
  {
    key: 'paymentMethod',
    label: 'Payment Method',
    type: 'string',
    required: true,
    default: 'Transfer',
    choices: PAYMENT_METHODS,
    helpText: 'Payment method (forma płatności).',
  },
  {
    key: 'paymentDate',
    label: 'Payment Due Date',
    type: 'string',
    required: false,
    helpText: 'Payment due date (termin płatności), YYYY-MM-DD.',
  },
  {
    key: 'bankAccount',
    label: 'Bank Account',
    type: 'string',
    required: false,
    helpText: 'For bank transfer. Default: the firm’s account from KSeF Canvas.',
  },
  {
    key: 'currency',
    label: 'Currency',
    type: 'string',
    required: false,
    helpText: 'ISO 4217 code, e.g. EUR. Default: PLN.',
  },
  { key: 'notes', label: 'Notes', type: 'text', required: false, helpText: 'Notes (uwagi), printed on the invoice.' },
  {
    key: 'lines',
    label: 'Line Items',
    required: false,
    children: [
      {
        key: 'name',
        label: 'Name',
        type: 'string',
        required: false,
        helpText:
          'Product or service name. Line items (pozycje): at least one, each with a name and a net unit price; map them from another app or add them here.',
      },
      { key: 'quantity', label: 'Quantity', type: 'string', required: false, helpText: 'A decimal number. Default: 1.' },
      { key: 'unit', label: 'Unit', type: 'string', required: false, helpText: 'Default: szt.' },
      {
        key: 'netUnitPrice',
        label: 'Net Unit Price',
        type: 'string',
        required: false,
        helpText: 'In the invoice currency, e.g. 123.45 (a decimal comma also works).',
      },
      {
        key: 'vatRate',
        label: 'VAT Rate',
        type: 'string',
        required: false,
        choices: VAT_RATES,
        helpText: 'Default: 23%.',
      },
      {
        key: 'discountPercent',
        label: 'Discount (%)',
        type: 'string',
        required: false,
        helpText: 'From 0 to 100. Default: 0.',
      },
      { key: 'pkwiu', label: 'PKWiU', type: 'string', required: false, helpText: 'Optional classification code.' },
    ],
  },
  {
    key: 'draftData',
    label: 'Draft Data (JSON)',
    type: 'text',
    required: false,
    helpText:
      'Advanced. A JSON object sent unchanged as the draft data of the KSeF Canvas API, for every field it supports ' +
      '(amounts in grosz). When this is filled in, all other fields of this action are ignored.',
  },
];

const invalid = (z, message) => new z.errors.Error(message, 'invalid_input', 400);

const numberOrThrow = (z, value, fallback, label, index) => {
  if (isBlank(value)) return fallback;
  const parsed = parseDecimal(value);
  if (!Number.isFinite(parsed)) throw invalid(z, `Line ${index + 1}: ${label} "${value}" is not a number.`);
  return parsed;
};

const mapLine = (z, line, index) => {
  const out = {};
  const name = text(line.name);
  if (name !== undefined) out.name = name;
  out.quantity = numberOrThrow(z, line.quantity, DEFAULT_QUANTITY, 'Quantity', index);
  out.unit = text(line.unit) || DEFAULT_UNIT;
  if (!isBlank(line.netUnitPrice)) {
    const grosz = toGrosz(line.netUnitPrice);
    if (!Number.isFinite(grosz)) throw invalid(z, `Line ${index + 1}: Net Unit Price "${line.netUnitPrice}" is not a number.`);
    out.netUnitPriceGrosz = grosz;
  }
  out.discountPercent = numberOrThrow(z, line.discountPercent, DEFAULT_DISCOUNT, 'Discount (%)', index);
  if (isBlank(line.vatRate)) {
    out.vatRate = DEFAULT_VAT_RATE;
  } else {
    const rate = parseVatRate(line.vatRate);
    if (!Number.isFinite(rate)) throw invalid(z, `Line ${index + 1}: VAT Rate "${line.vatRate}" is not one of the listed rates.`);
    out.vatRate = rate;
  }
  const pkwiu = text(line.pkwiu);
  if (pkwiu !== undefined) out.pkwiu = pkwiu;
  return out;
};

const lineHasContent = (line) => line && typeof line === 'object' && Object.values(line).some((value) => !isBlank(value));

const clientAddress = (client) =>
  [text(client.address), [text(client.postalCode), text(client.city)].filter(Boolean).join(' ')].filter(Boolean).join(', ');

// Only the fields the user filled in; the API fills the rest from the firm's profile and today's date.
const buildDraftData = async (z, bundle) => {
  const input = bundle.inputData || {};
  const data = {};

  if (!isBlank(input.clientId)) {
    const response = await z.request({ url: `/v1/clients/${encodeURIComponent(String(input.clientId).trim())}` });
    const client = response.data || {};
    if (text(client.name)) data.buyerName = text(client.name);
    if (text(client.nip)) data.buyerNip = normalizeNip(client.nip);
    if (clientAddress(client)) data.buyerAddress = clientAddress(client);
  }

  if (!isBlank(input.buyerName)) data.buyerName = text(input.buyerName);
  if (!isBlank(input.buyerNip)) data.buyerNip = normalizeNip(input.buyerNip);
  if (!isBlank(input.buyerAddress)) data.buyerAddress = text(input.buyerAddress);
  if (!isBlank(input.issueDate)) data.issueDate = normalizeDate(input.issueDate);
  if (!isBlank(input.supplyDate)) data.supplyDate = normalizeDate(input.supplyDate);
  if (!isBlank(input.paymentMethod)) data.paymentMethod = text(input.paymentMethod);
  if (!isBlank(input.paymentDate)) data.paymentDate = normalizeDate(input.paymentDate);
  if (!isBlank(input.bankAccount)) data.bankAccount = text(input.bankAccount);
  if (!isBlank(input.currency)) data.currency = text(input.currency).toUpperCase();
  if (!isBlank(input.notes)) data.notes = text(input.notes);

  const rawLines = Array.isArray(input.lines) ? input.lines : input.lines ? [input.lines] : [];
  const lines = rawLines.filter(lineHasContent).map((line, index) => mapLine(z, line, index));
  if (lines.length) data.lines = lines;
  return data;
};

const parseDraftJson = (z, value) => {
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch (e) {
    throw invalid(z, `Draft Data (JSON) is not valid JSON: ${e.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalid(z, 'Draft Data (JSON) must be a JSON object.');
  }
  return parsed;
};

const perform = async (z, bundle) => {
  const input = bundle.inputData || {};
  const data = isBlank(input.draftData) ? await buildDraftData(z, bundle) : parseDraftJson(z, input.draftData);
  const response = await z.request({ method: 'POST', url: '/v1/drafts', body: { data } });
  return response.data;
};

module.exports = {
  key: 'create_draft',
  noun: 'Draft',
  display: {
    label: 'Create Draft',
    description:
      'Creates an invoice draft (szkic) in KSeF Canvas. Seller details come from the firm’s profile; the number is assigned when the invoice is issued.',
  },
  operation: {
    inputFields,
    perform,
    sample: samples.draft,
    outputFields: [
      { key: 'id', label: 'Draft ID' },
      { key: 'version', label: 'Draft Version', type: 'integer' },
      { key: 'state', label: 'State' },
      { key: 'buyerName', label: 'Buyer Name' },
      { key: 'buyerNip', label: 'Buyer NIP' },
      { key: 'totals__netGrosz', label: 'Net Total (grosz)', type: 'integer' },
      { key: 'totals__vatGrosz', label: 'VAT Total (grosz)', type: 'integer' },
      { key: 'totals__grossGrosz', label: 'Gross Total (grosz)', type: 'integer' },
    ],
  },
};
