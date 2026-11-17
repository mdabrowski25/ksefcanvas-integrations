import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import {
	buildDraftData,
	documentFileName,
	FINAL_STATES,
	IDEMPOTENCY_KEY,
	ksefCanvasApiRequest,
	ksefCanvasApiRequestAllItems,
	type DraftFieldsInput,
	type LineItemInput,
} from './GenericFunctions';
import {
	clientProperties,
	draftProperties,
	invoiceProperties,
	operationProperties,
	productProperties,
	resourceProperty,
} from './KsefCanvasDescription';

const MIME_TYPES: Record<string, string> = {
	pdf: 'application/pdf',
	xml: 'application/xml',
	upo: 'application/xml',
};

// Programmatic style: issuing first reads the draft's version, can wait for the KSeF result, and the
// document operations return binary files; none of that maps onto declarative routing.
export class KsefCanvas implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'KSeF Canvas',
		name: 'ksefCanvas',
		icon: { light: 'file:ksefCanvas.svg', dark: 'file:ksefCanvas.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Create invoice drafts and issue them in KSeF, the Polish national e-invoicing system',
		defaults: { name: 'KSeF Canvas' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'ksefCanvasApi', required: true }],
		properties: [
			resourceProperty,
			...operationProperties,
			...draftProperties,
			...invoiceProperties,
			...clientProperties,
			...productProperties,
		],
	};

	methods = {
		listSearch: {
			async searchDrafts(
				this: ILoadOptionsFunctions,
				_filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				const page = paginationToken ? Number(paginationToken) : 1;
				const { body } = await ksefCanvasApiRequest.call(this, 'GET', '/v1/drafts', {
					qs: { page, pageSize: 50 },
				});
				const result = body as { items: IDataObject[]; total: number };
				return {
					results: result.items.map((draft) => ({
						name: [
							draft.buyerName || 'No buyer yet',
							draft.buyerNip,
							`${(Number(draft.grossGrosz) / 100).toFixed(2)} ${String(draft.currency)}`,
							String(draft.issueDate),
						]
							.filter(Boolean)
							.join(' · '),
						value: String(draft.id),
					})),
					paginationToken: page * 50 < result.total ? String(page + 1) : undefined,
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const output = await run.call(this, resource, operation, i);
				returnData.push(...output);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message, description: (error as NodeApiError).description },
						pairedItem: { item: i },
					});
					continue;
				}
				// API errors already carry the HTTP status, code and the API's detail: keep them as they are.
				const nodeError =
					error instanceof NodeApiError || error instanceof NodeOperationError
						? error
						: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
				throw nodeError;
			}
		}

		return [returnData];
	}
}

async function run(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	const json = (data: unknown): INodeExecutionData[] => [
		{ json: data as IDataObject, pairedItem: { item: i } },
	];
	const many = (data: IDataObject[]): INodeExecutionData[] =>
		data.map((entry) => ({ json: entry, pairedItem: { item: i } }));
	const list = async (path: string, qs: IDataObject = {}) => {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
		return many(await ksefCanvasApiRequestAllItems.call(this, path, qs, returnAll, limit, i));
	};
	const get = async (path: string) => (await ksefCanvasApiRequest.call(this, 'GET', path, { itemIndex: i })).body;

	if (resource === 'draft') {
		if (operation === 'create') return json(await createDraft.call(this, i));
		if (operation === 'getAll') return list('/v1/drafts');
		const draftId = encodeURIComponent(
			this.getNodeParameter('draftId', i, '', { extractValue: true }) as string,
		);
		if (operation === 'get') return json(await get(`/v1/drafts/${draftId}`));
		if (operation === 'validate') {
			const { body } = await ksefCanvasApiRequest.call(this, 'POST', `/v1/drafts/${draftId}/validate`, {
				itemIndex: i,
			});
			return json({ draftId: decodeURIComponent(draftId), ...(body as IDataObject) });
		}
		if (operation === 'preview') {
			const { body } = await ksefCanvasApiRequest.call(this, 'POST', `/v1/drafts/${draftId}/preview`, {
				binary: true,
				itemIndex: i,
			});
			const property = this.getNodeParameter('binaryPropertyName', i) as string;
			const file = await this.helpers.prepareBinaryData(
				Buffer.from(body as ArrayBuffer),
				`draft-${decodeURIComponent(draftId)}.pdf`,
				'application/pdf',
			);
			return [{ json: { draftId: decodeURIComponent(draftId) }, binary: { [property]: file }, pairedItem: { item: i } }];
		}
		if (operation === 'issue') return json(await issueDraft.call(this, decodeURIComponent(draftId), i));
	}

	if (resource === 'invoice') {
		if (operation === 'getAll') return list('/v1/issues');
		const issueId = (this.getNodeParameter('issueId', i) as string).trim();
		if (operation === 'get') return json(await get(`/v1/issues/${encodeURIComponent(issueId)}`));
		if (operation === 'downloadDocument') {
			const documentType = this.getNodeParameter('documentType', i) as string;
			const { body, headers } = await ksefCanvasApiRequest.call(
				this,
				'GET',
				`/v1/issues/${encodeURIComponent(issueId)}/${documentType}`,
				{ binary: true, itemIndex: i },
			);
			const property = this.getNodeParameter('binaryPropertyName', i) as string;
			// Name the file after the invoice number (FV/2026/11/0042 → FV_2026_11_0042.pdf).
			const issue = (await get(`/v1/issues/${encodeURIComponent(issueId)}`)) as IDataObject;
			const fileName = documentFileName(issue.invoiceNumber, headers, issueId, documentType);
			const file = await this.helpers.prepareBinaryData(
				Buffer.from(body as ArrayBuffer),
				fileName,
				MIME_TYPES[documentType],
			);
			return [
				{
					json: { issueId, invoiceNumber: issue.invoiceNumber, documentType, fileName },
					binary: { [property]: file },
					pairedItem: { item: i },
				},
			];
		}
	}

	if (resource === 'client' || resource === 'product') {
		const path = resource === 'client' ? '/v1/clients' : '/v1/products';
		if (operation === 'getAll') {
			const query = (this.getNodeParameter('query', i, '') as string).trim();
			return list(path, query ? { q: query } : {});
		}
		if (operation === 'get') {
			const id = (this.getNodeParameter(resource === 'client' ? 'clientId' : 'productId', i) as string).trim();
			return json(await get(`${path}/${encodeURIComponent(id)}`));
		}
	}

	throw new NodeOperationError(this.getNode(), `The operation "${operation}" is not supported for ${resource}`, {
		itemIndex: i,
	});
}

async function createDraft(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const inputMode = this.getNodeParameter('inputMode', i) as string;
	let data: IDataObject;
	if (inputMode === 'json') {
		const raw = this.getNodeParameter('draftJson', i) as string | IDataObject;
		try {
			data = typeof raw === 'string' ? (JSON.parse(raw) as IDataObject) : raw;
		} catch {
			throw new NodeOperationError(this.getNode(), 'Draft Data (JSON) is not valid JSON', { itemIndex: i });
		}
		if (!data || typeof data !== 'object' || Array.isArray(data)) {
			throw new NodeOperationError(this.getNode(), 'Draft Data (JSON) must be an object', { itemIndex: i });
		}
	} else {
		const lineItems = this.getNodeParameter('lineItems', i, {}) as { item?: LineItemInput[] };
		const additional = this.getNodeParameter('additionalFields', i, {}) as DraftFieldsInput;
		try {
			data = buildDraftData({
				...additional,
				buyerName: this.getNodeParameter('buyerName', i, '') as string,
				buyerNip: this.getNodeParameter('buyerNip', i, '') as string,
				buyerAddress: this.getNodeParameter('buyerAddress', i, '') as string,
				paymentMethod: this.getNodeParameter('paymentMethod', i) as string,
				lineItems: lineItems.item ?? [],
			});
		} catch (error) {
			throw new NodeOperationError(this.getNode(), (error as Error).message, { itemIndex: i });
		}
	}
	const { body } = await ksefCanvasApiRequest.call(this, 'POST', '/v1/drafts', { body: { data }, itemIndex: i });
	return body as IDataObject;
}

// Draft states once an issue exists; a rejected draft may be fixed and issued again.
const ISSUED_STATES = ['Queued', 'Submitting', 'Processing', 'Accepted', 'ManualReview'];

/** The newest issue of a draft, from the firm's issues (newest first), looking at the latest 500. */
async function findIssueOfDraft(this: IExecuteFunctions, draftId: string, i: number): Promise<IDataObject | undefined> {
	for (let page = 1; page <= 5; page++) {
		const { body } = await ksefCanvasApiRequest.call(this, 'GET', '/v1/issues', {
			qs: { page, pageSize: 100 },
			itemIndex: i,
		});
		const result = body as { items: IDataObject[]; total: number };
		const match = result.items.find((issue) => issue.draftId === draftId);
		if (match) return match;
		if (page * 100 >= result.total) return undefined;
	}
	return undefined;
}

async function issueDraft(this: IExecuteFunctions, draftId: string, i: number): Promise<IDataObject> {
	const path = `/v1/drafts/${encodeURIComponent(draftId)}`;
	const options = this.getNodeParameter('issueOptions', i, {}) as {
		idempotencyKey?: string;
		waitForResult?: boolean;
		waitTimeout?: number;
	};
	let version = Number(this.getNodeParameter('version', i, 0));
	let accepted: IDataObject | undefined;
	let idempotencyKey: string | undefined;
	if (!version) {
		const draft = (await ksefCanvasApiRequest.call(this, 'GET', path, { itemIndex: i })).body as IDataObject;
		version = Number(draft.version);
		// Issuing assigns the number and moves the version on, so a retry of this step would build another key.
		// When the draft is already issued, return its issue as a replay instead of asking to issue it again.
		if (ISSUED_STATES.includes(String(draft.state))) {
			const existing = await findIssueOfDraft.call(this, draftId, i);
			if (existing) {
				accepted = { issueId: existing.id, draftId, state: existing.state, replay: true, alreadyIssued: true };
			}
		}
	}
	if (!accepted) {
		idempotencyKey = options.idempotencyKey?.trim() || `${draftId}:${version}`;
		if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
			throw new NodeOperationError(
				this.getNode(),
				'The idempotency key may have 1–64 letters, digits, dots, underscores, colons or dashes',
				{ itemIndex: i },
			);
		}
		const { body } = await ksefCanvasApiRequest.call(this, 'POST', `${path}/issue`, {
			body: { version },
			headers: { 'Idempotency-Key': idempotencyKey },
			itemIndex: i,
		});
		accepted = body as IDataObject;
	}
	if (!options.waitForResult) return { ...accepted, version, idempotencyKey };

	// KSeF usually answers within seconds; poll the issue until it is final or the timeout passes.
	const deadline = Date.now() + Math.min(300, Math.max(5, options.waitTimeout ?? 60)) * 1000;
	const issuePath = `/v1/issues/${encodeURIComponent(String(accepted.issueId))}`;
	let issue = (await ksefCanvasApiRequest.call(this, 'GET', issuePath, { itemIndex: i })).body as IDataObject;
	while (!FINAL_STATES.includes(String(issue.state)) && Date.now() < deadline) {
		await sleep(3000);
		issue = (await ksefCanvasApiRequest.call(this, 'GET', issuePath, { itemIndex: i })).body as IDataObject;
	}
	return {
		...issue,
		issueId: accepted.issueId,
		replay: accepted.replay,
		version,
		idempotencyKey,
		final: FINAL_STATES.includes(String(issue.state)),
	};
}
