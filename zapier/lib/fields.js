'use strict';

// Input fields shared by several actions, and the conversions DESIGN.md asks for.

const PAYMENT_METHODS = [
  { value: 'Transfer', label: 'Bank Transfer', sample: 'Transfer' },
  { value: 'Cash', label: 'Cash', sample: 'Cash' },
  { value: 'Card', label: 'Card', sample: 'Card' },
  { value: 'Mobile', label: 'Mobile Payment', sample: 'Mobile' },
  { value: 'Credit', label: 'Credit', sample: 'Credit' },
  { value: 'Cheque', label: 'Cheque', sample: 'Cheque' },
  { value: 'Voucher', label: 'Voucher', sample: 'Voucher' },
  { value: 'Other', label: 'Other', sample: 'Other' },
];

const VAT_RATES = [
  { value: '23', label: '23%', sample: '23' },
  { value: '8', label: '8%', sample: '8' },
  { value: '5', label: '5%', sample: '5' },
  { value: '0', label: '0%', sample: '0' },
  { value: '-1', label: 'Exempt (zw)', sample: '-1' },
  { value: '-2', label: 'Reverse Charge (oo)', sample: '-2' },
  { value: '-3', label: 'Outside Poland (np I)', sample: '-3' },
  { value: '-4', label: 'Outside Poland, Art. 100 (np II)', sample: '-4' },
  { value: '-5', label: '0% Intra-EU Supply (WDT)', sample: '-5' },
  { value: '-6', label: '0% Export', sample: '-6' },
];

// Short names a mapped value from another app may carry instead of the code.
const VAT_ALIASES = {
  zw: -1,
  oo: -2,
  np: -3,
  'np i': -3,
  'np ii': -4,
  wdt: -5,
  'wdt 0%': -5,
  eksport: -6,
  export: -6,
};

const DOCUMENT_TYPES = [
  { value: 'pdf', label: 'Invoice PDF', sample: 'pdf' },
  { value: 'xml', label: 'Invoice XML', sample: 'xml' },
  { value: 'upo', label: 'UPO', sample: 'upo' },
];

const draftIdField = (helpText) => ({
  key: 'draftId',
  label: 'Draft',
  type: 'string',
  required: true,
  dynamic: 'draft_list.id.label',
  helpText: helpText || 'The draft (szkic) to use. Pick one of the drafts not issued yet, or map a draft ID from an earlier step.',
});

const issueIdField = (helpText) => ({
  key: 'issueId',
  label: 'Issue ID',
  type: 'string',
  required: true,
  dynamic: 'issue_list.id.label',
  helpText:
    helpText ||
    'The issue (wystawienie) returned by "Issue Invoice in KSeF" or by a trigger. Pick a recent one or map its ID.',
});

const isBlank = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

const text = (value) => (isBlank(value) ? undefined : String(value).trim());

// "1 234,56", "1,234.56", "1234.56" and 1234.56 all read as 1234.56.
const parseDecimal = (value) => {
  if (typeof value === 'number') return value;
  let s = String(value).replace(/[\s ]/g, '');
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else {
    s = s.replace(',', '.');
  }
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
};

// round(value × 100), half away from zero, without binary float surprises such as 1.005 × 100 = 100.4999….
const toGrosz = (value) => {
  const amount = parseDecimal(value);
  if (!Number.isFinite(amount)) return NaN;
  const scaled = Number((Math.abs(amount) * 100).toFixed(6));
  return Math.sign(amount) * Math.round(scaled);
};

const normalizeNip = (value) => String(value).replace(/[\s\- ]/g, '');

const WARSAW_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// YYYY-MM-DD stays as it is; a timestamp with a zone becomes the date in Poland; anything else goes to the API unchanged.
const normalizeDate = (value) => {
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const zoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  if (zoned) {
    const date = new Date(s);
    if (!Number.isNaN(date.getTime())) return WARSAW_DATE.format(date);
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  return s;
};

const parseVatRate = (value) => {
  const s = String(value).trim().toLowerCase().replace(/%$/, '').trim();
  if (Object.prototype.hasOwnProperty.call(VAT_ALIASES, s)) return VAT_ALIASES[s];
  return parseDecimal(s);
};

const toVersion = (z, value) => {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0) {
    throw new z.errors.Error(`Draft Version must be a whole number, got "${value}".`, 'invalid_version', 400);
  }
  return version;
};

module.exports = {
  DOCUMENT_TYPES,
  PAYMENT_METHODS,
  VAT_RATES,
  draftIdField,
  isBlank,
  issueIdField,
  normalizeDate,
  normalizeNip,
  parseDecimal,
  parseVatRate,
  text,
  toGrosz,
  toVersion,
};
