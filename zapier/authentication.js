'use strict';

const { KEYS_PAGE } = require('./lib/http');

const test = async (z) => {
  const response = await z.request({ url: '/v1/key' });
  return response.data;
};

// "{firm.name} ({firm.nip})", marked when a development version uses a test key, so both connections can be told apart.
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
  ],
  test,
  connectionLabel,
};
