import type { INodeProperties } from 'n8n-workflow';

const UUID = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

const show = (resource: string, operation: string[]) => ({ show: { resource: [resource], operation } });

export const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{ name: 'Client', value: 'client', description: 'Saved buyers (kontrahenci)' },
		{ name: 'Draft', value: 'draft', description: 'Invoice drafts (szkice) before issuing' },
		{ name: 'Invoice', value: 'invoice', description: 'Issued invoices and their status in KSeF' },
		{ name: 'Product', value: 'product', description: 'Saved products and services' },
	],
	default: 'draft',
};

export const operationProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['draft'] } },
		options: [
			{ name: 'Create', value: 'create', description: 'Create an invoice draft. Nothing is sent to KSeF.', action: 'Create a draft' },
			{ name: 'Get', value: 'get', description: 'Get a draft with its lines and totals', action: 'Get a draft' },
			{ name: 'Get Many', value: 'getAll', description: 'List drafts not issued yet, newest first', action: 'Get many drafts' },
			{ name: 'Issue in KSeF', value: 'issue', description: 'Issue the draft as an invoice in KSeF. Irreversible.', action: 'Issue a draft as an invoice' },
			{ name: 'Preview PDF', value: 'preview', description: 'Render the PDF of the draft as it would be issued', action: 'Preview a draft PDF' },
			{ name: 'Validate', value: 'validate', description: 'Check the draft without issuing it', action: 'Validate a draft' },
		],
		default: 'create',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['invoice'] } },
		options: [
			{ name: 'Download Document', value: 'downloadDocument', description: 'Download the invoice PDF, its XML or the UPO', action: 'Download an invoice document' },
			{ name: 'Get Status', value: 'get', description: 'Get the status of an issued invoice in KSeF', action: 'Get the status of an invoice' },
			{ name: 'Get Many', value: 'getAll', description: 'List issued invoices, newest first', action: 'Get many invoices' },
		],
		default: 'get',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['client'] } },
		options: [
			{ name: 'Get', value: 'get', description: 'Get a saved client', action: 'Get a client' },
			{ name: 'Get Many', value: 'getAll', description: 'Search saved clients by name or NIP', action: 'Get many clients' },
		],
		default: 'getAll',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['product'] } },
		options: [
			{ name: 'Get', value: 'get', description: 'Get a saved product or service', action: 'Get a product' },
			{ name: 'Get Many', value: 'getAll', description: 'Search saved products by name or PKWiU', action: 'Get many products' },
		],
		default: 'getAll',
	},
];

const vatRates = [
	{ name: '23%', value: 23 },
	{ name: '8%', value: 8 },
	{ name: '5%', value: 5 },
	{ name: '0%', value: 0 },
	{ name: 'Exempt (Zw)', value: -1 },
	{ name: 'Reverse Charge (Oo)', value: -2 },
	{ name: 'Outside Poland (Np I)', value: -3 },
	{ name: 'Outside Poland, Art. 100 (Np II)', value: -4 },
	{ name: '0% Intra-EU Supply (WDT)', value: -5 },
	{ name: '0% Export', value: -6 },
];

const paymentMethods = [
	{ name: 'Bank Transfer', value: 'Transfer' },
	{ name: 'Card', value: 'Card' },
	{ name: 'Cash', value: 'Cash' },
	{ name: 'Cheque', value: 'Cheque' },
	{ name: 'Credit', value: 'Credit' },
	{ name: 'Mobile Payment', value: 'Mobile' },
	{ name: 'Other', value: 'Other' },
	{ name: 'Voucher', value: 'Voucher' },
];

const draftLocator = (operations: string[]): INodeProperties => ({
	displayName: 'Draft',
	name: 'draftId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	description: 'The draft (szkic) to use',
	displayOptions: show('draft', operations),
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: 'searchDrafts', searchable: false },
		},
		{
			displayName: 'ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 0b8f7c1e-5d3a-4f6b-9a2e-7c1d4e5f6a7b',
			validation: [{ type: 'regex', properties: { regex: UUID, errorMessage: 'Not a valid draft ID' } }],
		},
	],
});

const binaryProperty = (resource: string, operations: string[]): INodeProperties => ({
	displayName: 'Put Output File in Field',
	name: 'binaryPropertyName',
	type: 'string',
	default: 'data',
	required: true,
	hint: 'The name of the output binary field to put the file in',
	displayOptions: show(resource, operations),
});

const getManyProperties = (resource: string): INodeProperties[] => [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: show(resource, ['getAll']),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		description: 'Max number of results to return',
		displayOptions: { show: { resource: [resource], operation: ['getAll'], returnAll: [false] } },
	},
];

export const draftProperties: INodeProperties[] = [
	draftLocator(['get', 'validate', 'preview', 'issue']),
	{
		displayName: 'Draft Input',
		name: 'inputMode',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Fields', value: 'fields', description: 'Fill in the buyer, payment and line items below' },
			{ name: 'JSON', value: 'json', description: 'Send the API draft data as JSON, for every advanced field' },
		],
		default: 'fields',
		displayOptions: show('draft', ['create']),
	},
	{
		displayName: 'Buyer Name',
		name: 'buyerName',
		type: 'string',
		default: '',
		description: 'Buyer (nabywca) name as it should appear on the invoice',
		displayOptions: { show: { resource: ['draft'], operation: ['create'], inputMode: ['fields'] } },
	},
	{
		displayName: 'Buyer NIP',
		name: 'buyerNip',
		type: 'string',
		default: '',
		placeholder: 'e.g. 5252248481',
		description: "Buyer's Polish tax ID, 10 digits. Spaces and dashes are removed.",
		displayOptions: { show: { resource: ['draft'], operation: ['create'], inputMode: ['fields'] } },
	},
	{
		displayName: 'Buyer Address',
		name: 'buyerAddress',
		type: 'string',
		default: '',
		placeholder: 'e.g. ul. Przykładowa 1, 00-001 Warszawa',
		description: 'Street and number, postal code and city',
		displayOptions: { show: { resource: ['draft'], operation: ['create'], inputMode: ['fields'] } },
	},
	{
		displayName: 'Payment Method',
		name: 'paymentMethod',
		type: 'options',
		options: paymentMethods,
		default: 'Transfer',
		required: true,
		description: 'Payment method (forma płatności). Bank transfer uses the bank account below or the firm\'s account.',
		displayOptions: { show: { resource: ['draft'], operation: ['create'], inputMode: ['fields'] } },
	},
	{
		displayName: 'Line Items',
		name: 'lineItems',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		placeholder: 'Add Line Item',
		default: {},
		description: 'Invoice lines (pozycje). At least one is needed to issue the invoice.',
		displayOptions: { show: { resource: ['draft'], operation: ['create'], inputMode: ['fields'] } },
		options: [
			{
				displayName: 'Line Item',
				name: 'item',
				values: [
					{
						displayName: 'Discount (%)',
						name: 'discountPercent',
						type: 'number',
						default: 0,
						typeOptions: { minValue: 0, maxValue: 100, numberPrecision: 2 },
					},
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						description: 'Name of the product or service',
					},
					{
						displayName: 'Net Unit Price',
						name: 'netUnitPrice',
						type: 'number',
						default: 0,
						typeOptions: { numberPrecision: 2 },
						description: 'Net price of one unit in the invoice currency, for example 123.45',
					},
					{
						displayName: 'PKWiU',
						name: 'pkwiu',
						type: 'string',
						default: '',
						description: 'Polish product classification code, optional',
					},
					{
						displayName: 'Quantity',
						name: 'quantity',
						type: 'number',
						default: 1,
						typeOptions: { numberPrecision: 4 },
					},
					{
						displayName: 'Unit',
						name: 'unit',
						type: 'string',
						default: 'szt.',
						description: 'Unit of measure, for example szt., godz. or usł.',
					},
					{
						displayName: 'VAT Rate',
						name: 'vatRate',
						type: 'options',
						options: vatRates,
						default: 23,
					},
				],
			},
		],
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['draft'], operation: ['create'], inputMode: ['fields'] } },
		options: [
			{
				displayName: 'Bank Account',
				name: 'bankAccount',
				type: 'string',
				default: '',
				description: "Account number for a bank transfer. Defaults to the firm's account.",
			},
			{
				displayName: 'Currency',
				name: 'currency',
				type: 'string',
				default: 'PLN',
				description: 'ISO 4217 currency code',
			},
			{
				displayName: 'Issue Date',
				name: 'issueDate',
				type: 'string',
				default: '',
				placeholder: 'YYYY-MM-DD',
				description: 'Issue date (data wystawienia). Defaults to today in Polish time.',
			},
			{
				displayName: 'Notes',
				name: 'notes',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'Notes (uwagi) printed on the invoice',
			},
			{
				displayName: 'Payment Due Date',
				name: 'paymentDate',
				type: 'string',
				default: '',
				placeholder: 'YYYY-MM-DD',
				description: 'Payment due date (termin płatności)',
			},
			{
				displayName: 'Supply Date',
				name: 'supplyDate',
				type: 'string',
				default: '',
				placeholder: 'YYYY-MM-DD',
				description: 'Date of supply or service (data dostawy lub wykonania usługi). Defaults to today.',
			},
		],
	},
	{
		displayName: 'Draft Data (JSON)',
		name: 'draftJson',
		type: 'json',
		default:
			'{\n  "buyerName": "",\n  "buyerNip": "",\n  "buyerAddress": "",\n  "paymentMethod": "Transfer",\n  "lines": [\n    { "name": "", "quantity": 1, "unit": "szt.", "netUnitPriceGrosz": 0, "discountPercent": 0, "vatRate": 23 }\n  ]\n}',
		description:
			'The draft data object of the KSeF Canvas API, sent as it is. Amounts are in grosz (100.00 PLN is 10000).',
		displayOptions: { show: { resource: ['draft'], operation: ['create'], inputMode: ['json'] } },
	},
	{
		displayName:
			'Issuing is irreversible: an invoice accepted by KSeF cannot be withdrawn, only corrected with a correction invoice (faktura korygująca). The key needs the invoices:issue scope.',
		name: 'issueNotice',
		type: 'notice',
		default: '',
		displayOptions: show('draft', ['issue']),
	},
	{
		displayName: 'Draft Version',
		name: 'version',
		type: 'number',
		default: 0,
		typeOptions: { minValue: 0 },
		description:
			'The draft version to issue, as returned by Get or Validate. 0 reads the current version first.',
		displayOptions: show('draft', ['issue']),
	},
	{
		displayName: 'Options',
		name: 'issueOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show('draft', ['issue']),
		options: [
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'Repeating a request with the same key returns the first result instead of issuing a second invoice. Defaults to the draft ID and version. 1–64 letters, digits, dots, underscores, colons or dashes.',
			},
			{
				displayName: 'Wait for KSeF Result',
				name: 'waitForResult',
				type: 'boolean',
				default: false,
				description:
					'Whether to wait until KSeF accepts or rejects the invoice and return its final status',
			},
			{
				displayName: 'Wait Timeout (Seconds)',
				name: 'waitTimeout',
				type: 'number',
				default: 60,
				typeOptions: { minValue: 5, maxValue: 300 },
				description: 'How long to wait for the KSeF result before returning the current status',
			},
		],
	},
	binaryProperty('draft', ['preview']),
	...getManyProperties('draft'),
];

export const invoiceProperties: INodeProperties[] = [
	{
		displayName: 'Issue ID',
		name: 'issueId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 9a1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e',
		description: 'The issueId returned by Issue in KSeF, the trigger or Get Many',
		displayOptions: show('invoice', ['get', 'downloadDocument']),
	},
	{
		displayName: 'Document',
		name: 'documentType',
		type: 'options',
		options: [
			{ name: 'Invoice PDF', value: 'pdf', description: 'The invoice with its KSeF number and QR code' },
			{ name: 'Invoice XML', value: 'xml', description: 'The FA(3) XML sent to KSeF' },
			{ name: 'UPO', value: 'upo', description: "KSeF's official receipt (urzędowe poświadczenie odbioru)" },
		],
		default: 'pdf',
		description: 'Documents are ready once KSeF has accepted the invoice',
		displayOptions: show('invoice', ['downloadDocument']),
	},
	binaryProperty('invoice', ['downloadDocument']),
	...getManyProperties('invoice'),
];

export const clientProperties: INodeProperties[] = [
	{
		displayName: 'Client ID',
		name: 'clientId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: show('client', ['get']),
	},
	{
		displayName: 'Search Query',
		name: 'query',
		type: 'string',
		default: '',
		description: 'Part of the name or NIP. Leave empty to list every client.',
		displayOptions: show('client', ['getAll']),
	},
	...getManyProperties('client'),
];

export const productProperties: INodeProperties[] = [
	{
		displayName: 'Product ID',
		name: 'productId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: show('product', ['get']),
	},
	{
		displayName: 'Search Query',
		name: 'query',
		type: 'string',
		default: '',
		description: 'Part of the name or PKWiU. Leave empty to list every product.',
		displayOptions: show('product', ['getAll']),
	},
	...getManyProperties('product'),
];
