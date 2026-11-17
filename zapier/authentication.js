'use strict';

const { KEYS_PAGE } = require('./lib/http');

const test = async (z) => {
  const response = await z.request({ url: '/v1/key' });
  return response.data;
};

// "{firm.name} ({firm.nip})", marked when the key is for the test environment so both connections can be told apart.
const connectionLabel = (z, bundle) => {
  const key = bundle.inputData || {};
  const firm = key.firm || {};
  const label = firm.nip ? `${firm.name} (${firm.nip})` : firm.name || 'KSeF Canvas';
  return key.environment === 'test' ? `${label} [Test]` : label;
};

module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      helpText:
        `Create a key in KSeF Canvas under ${KEYS_PAGE}. ` +
        'Triggers need the webhooks:write and invoices:read scopes; issuing invoices needs invoices:issue.',
    },
    {
      key: 'environment',
      label: 'Environment',
      type: 'string',
      required: true,
      default: 'live',
      choices: [
        { value: 'live', label: 'Production', sample: 'live' },
        { value: 'test', label: 'Test (KSeF Test, no legal effect)', sample: 'test' },
      ],
      helpText:
        'Production issues real invoices to KSeF and takes kc_live_ keys. ' +
        'Test sends to KSeF Test, where invoices have no legal effect, and takes kc_test_ keys.',
    },
  ],
  test,
  connectionLabel,
};
