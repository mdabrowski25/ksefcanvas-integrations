import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class KsefCanvasApi implements ICredentialType {
	name = 'ksefCanvasApi';

	displayName = 'KSeF Canvas API';

	icon: Icon = {
		light: 'file:../nodes/KsefCanvas/ksefCanvas.svg',
		dark: 'file:../nodes/KsefCanvas/ksefCanvas.dark.svg',
	};

	documentationUrl = 'https://github.com/mdabrowski25/ksefcanvas-integrations/tree/main/n8n#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Environment',
			name: 'environment',
			type: 'options',
			default: 'live',
			options: [
				{
					name: 'Production',
					value: 'live',
					description: 'Api.ksefcanvas.pl with production KSeF. Keys start with kc_live_.',
				},
				{
					name: 'Test (KSeF Test, No Legal Effect)',
					value: 'test',
					description: 'Staging-api.ksefcanvas.pl with KSeF Test. Keys start with kc_test_.',
				},
			],
			description: 'A key works only in its own environment',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Create a key in KSeF Canvas under Ustawienia → Integracje → API. The trigger needs the webhooks:write and invoices:read scopes, and issuing invoices needs invoices:issue.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{$credentials.environment === "test" ? "https://staging-api.ksefcanvas.pl" : "https://api.ksefcanvas.pl"}}',
			url: '/v1/key',
		},
	};
}
