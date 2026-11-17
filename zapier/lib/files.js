'use strict';

// Binary responses (PDF, XML, UPO) go to Zapier's file storage with z.stashFile; errors are mapped by afterResponse.

const fileName = (invoiceNumber, fallback, extension, prefix = '') => {
  const base = String(invoiceNumber || fallback).replace(/\//g, '_').replace(/[\\:*?"<>|\s]+/g, '_');
  return `${prefix}${base}.${extension}`;
};

const stashBinary = async (z, request, name, defaultContentType) => {
  const response = await z.request({ ...request, raw: true });
  const buffer = await response.buffer();
  const header = response.headers.get('content-type');
  const contentType = header ? header.split(';')[0].trim() : defaultContentType;
  const file = await z.stashFile(buffer, buffer.length, name, contentType || defaultContentType);
  return { file, fileName: name, contentType: contentType || defaultContentType, size: buffer.length };
};

module.exports = { fileName, stashBinary };
