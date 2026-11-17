'use strict';

const { issueIdField, text } = require('../lib/fields');
const { throwForProblem } = require('../lib/http');
const samples = require('../lib/samples');
const { issueOutputFields, issuePath } = require('../creates/issues');

const SEARCH_PAGE_SIZE = 10;

// A NIP typed or mapped as "525-224-84-81" is searched as digits.
const searchText = (value) => {
  const q = text(value) || '';
  return /^[\d\s-]+$/.test(q) && q.replace(/\D/g, '').length >= 10 ? q.replace(/\D/g, '') : q;
};

const listSearch = (path) => async (z, bundle) => {
  const response = await z.request({
    url: path,
    params: { q: searchText(bundle.inputData.q), page: 1, pageSize: SEARCH_PAGE_SIZE },
  });
  return (response.data && response.data.items) || [];
};

const findClient = {
  key: 'find_client',
  noun: 'Client',
  display: {
    label: 'Find Client',
    description: 'Finds a client (kontrahent) saved in KSeF Canvas by name or NIP.',
  },
  operation: {
    inputFields: [
      { key: 'q', label: 'Name or NIP', type: 'string', required: true, helpText: 'Part of the client’s name, or its NIP.' },
    ],
    perform: listSearch('/v1/clients'),
    sample: samples.client,
    outputFields: [
      { key: 'id', label: 'Client ID' },
      { key: 'name', label: 'Name' },
      { key: 'nip', label: 'NIP' },
      { key: 'address', label: 'Address' },
      { key: 'postalCode', label: 'Postal Code' },
      { key: 'city', label: 'City' },
      { key: 'countryCode', label: 'Country Code' },
    ],
  },
};

const findProduct = {
  key: 'find_product',
  noun: 'Product',
  display: {
    label: 'Find Product',
    description: 'Finds a product or service saved in KSeF Canvas by name.',
  },
  operation: {
    inputFields: [{ key: 'q', label: 'Name', type: 'string', required: true, helpText: 'Part of the product’s name.' }],
    perform: listSearch('/v1/products'),
    sample: samples.product,
    outputFields: [
      { key: 'id', label: 'Product ID' },
      { key: 'name', label: 'Name' },
      { key: 'unit', label: 'Unit' },
      { key: 'netUnitPriceGrosz', label: 'Net Unit Price (grosz)', type: 'integer' },
      { key: 'vatRate', label: 'VAT Rate', type: 'number' },
      { key: 'pkwiu', label: 'PKWiU' },
    ],
  },
};

const findIssue = {
  key: 'find_issue',
  noun: 'Issue',
  display: {
    label: 'Find Issued Invoice',
    description: 'Finds an issued invoice (wystawienie) by its issue ID and returns its state in KSeF.',
  },
  operation: {
    inputFields: [issueIdField()],
    perform: async (z, bundle) => {
      const response = await z.request({ url: issuePath(bundle.inputData.issueId), skipThrowForStatus: true });
      if (response.status === 404) return [];
      await throwForProblem(z, response);
      return [response.data];
    },
    sample: samples.issue,
    outputFields: issueOutputFields,
  },
};

module.exports = { findClient, findIssue, findProduct };
