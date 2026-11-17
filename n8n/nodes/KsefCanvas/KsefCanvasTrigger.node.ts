import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { ksefCanvasApiRequest, verifySignature } from './GenericFunctions';

interface WebhookState {
	webhookId?: string;
	webhookSecret?: string;
}

export class KsefCanvasTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'KSeF Canvas Trigger',
		name: 'ksefCanvasTrigger',
		icon: { light: 'file:ksefCanvas.svg', dark: 'file:ksefCanvas.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts the workflow when KSeF accepts or rejects an invoice issued with KSeF Canvas',
		defaults: { name: 'KSeF Canvas Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'ksefCanvasApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'KSeF Canvas sends events only to public https:// addresses on port 443, so n8n must be reachable that way (set WEBHOOK_URL on a self-hosted instance). The key needs the webhooks:write scope (and invoices:read to include the invoice status), and a firm can have at most 3 webhooks.',
				name: 'requirementsNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				required: true,
				default: 'invoice.accepted',
				options: [
					{
						name: 'Invoice Accepted in KSeF',
						value: 'invoice.accepted',
						description: 'KSeF accepted an invoice and assigned its KSeF number',
					},
					{
						name: 'Invoice Rejected by KSeF',
						value: 'invoice.rejected',
						description: 'KSeF rejected an invoice; the event carries the reason',
					},
				],
			},
			{
				displayName: 'Include Invoice Status',
				name: 'includeIssue',
				type: 'boolean',
				default: true,
				description:
					'Whether to read the full status of the invoice from KSeF Canvas and add it under "issue"',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as WebhookState;
				if (!state.webhookId || !state.webhookSecret) return false;
				const response = await ksefCanvasApiRequest.call(
					this,
					'GET',
					`/v1/webhooks/${encodeURIComponent(state.webhookId)}`,
					{ allowNotFound: true },
				);
				const webhook = response.body as IDataObject;
				const event = this.getNodeParameter('event') as string;
				const matches =
					response.statusCode === 200 &&
					webhook.url === this.getNodeWebhookUrl('default') &&
					webhook.enabled === true &&
					Array.isArray(webhook.events) &&
					webhook.events.length === 1 &&
					webhook.events[0] === event;
				if (matches) return true;
				if (response.statusCode === 200) {
					// Same id, but another address or event: replace it rather than leave it behind.
					await ksefCanvasApiRequest.call(this, 'DELETE', `/v1/webhooks/${encodeURIComponent(state.webhookId)}`, {
						allowNotFound: true,
					});
				}
				delete state.webhookId;
				delete state.webhookSecret;
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default');
				const event = this.getNodeParameter('event') as string;
				if (!url) throw new NodeOperationError(this.getNode(), 'n8n did not provide a webhook URL');
				let response;
				try {
					response = await ksefCanvasApiRequest.call(this, 'POST', '/v1/webhooks', {
						body: { url, events: [event] },
					});
				} catch (error) {
					// toApiError lists each validation issue with its code in the description.
					const details = `${(error as NodeApiError).message ?? ''} ${(error as NodeApiError).description ?? ''}`;
					if (details.includes('invalid_webhook_url')) {
						throw new NodeOperationError(
							this.getNode(),
							`KSeF Canvas cannot send events to ${url}`,
							{
								description:
									'KSeF Canvas sends events only to public https:// addresses on port 443. Make this n8n instance reachable that way, for example by setting WEBHOOK_URL to its public https address.',
							},
						);
					}
					const apiError =
						error instanceof NodeApiError ? error : new NodeApiError(this.getNode(), error as JsonObject);
					throw apiError;
				}
				const webhook = response.body as IDataObject;
				const state = this.getWorkflowStaticData('node') as WebhookState;
				state.webhookId = String(webhook.id);
				state.webhookSecret = String(webhook.secret);
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as WebhookState;
				if (state.webhookId) {
					await ksefCanvasApiRequest.call(this, 'DELETE', `/v1/webhooks/${encodeURIComponent(state.webhookId)}`, {
						allowNotFound: true,
					});
				}
				delete state.webhookId;
				delete state.webhookSecret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const state = this.getWorkflowStaticData('node') as WebhookState;
		if (!request.rawBody) await request.readRawBody();
		const signature = this.getHeaderData()['ksefcanvas-signature'];
		if (
			!state.webhookSecret ||
			!request.rawBody ||
			!verifySignature(state.webhookSecret, Array.isArray(signature) ? signature[0] : signature, request.rawBody)
		) {
			const response = this.getResponseObject();
			response.status(401).json({ error: 'invalid_signature' });
			return { noWebhookResponse: true };
		}

		const event = this.getBodyData() as IDataObject;
		const expected = this.getNodeParameter('event') as string;
		// "ping" comes from "Wyślij test" in the app; other types belong to other subscriptions.
		if (event.type !== expected) return { webhookResponse: { received: true, ignored: event.type } };

		const data = (event.data ?? {}) as IDataObject;
		const output: IDataObject = {
			...data,
			eventId: event.id,
			eventType: event.type,
			livemode: event.livemode,
			createdAt: event.createdAt,
		};
		if (this.getNodeParameter('includeIssue', true) as boolean) {
			try {
				const issue = await ksefCanvasApiRequest.call(
					this,
					'GET',
					`/v1/issues/${encodeURIComponent(String(data.issueId))}`,
				);
				output.issue = issue.body as IDataObject;
			} catch (error) {
				// The event still starts the workflow; the status can be read later with Get Status.
				output.issueError = (error as Error).message || 'Could not read the invoice status';
			}
		}
		return { workflowData: [this.helpers.returnJsonArray([output])] };
	}
}
