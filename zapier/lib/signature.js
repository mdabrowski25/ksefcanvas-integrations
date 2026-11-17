'use strict';

const crypto = require('crypto');

const TOLERANCE_SECONDS = 300;

// KsefCanvas-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 keyed with the secret's UTF-8 bytes over "<t>.<raw body>">
const verifySignature = (secret, header, rawBody, nowSeconds = Math.floor(Date.now() / 1000)) => {
  if (!secret || typeof header !== 'string' || typeof rawBody !== 'string') return false;
  const parts = header
    .split(',')
    .map((part) => part.trim())
    .map((part) => {
      const at = part.indexOf('=');
      return at > 0 ? [part.slice(0, at), part.slice(at + 1)] : null;
    })
    .filter(Boolean);
  const timestamp = (parts.find(([name]) => name === 't') || [])[1];
  if (!/^\d{1,12}$/.test(timestamp || '')) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(
    crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(Buffer.from(`${timestamp}.${rawBody}`, 'utf8')).digest('hex'),
    'ascii',
  );
  return parts
    .filter(([name, value]) => name === 'v1' && value.length === expected.length)
    .some(([, value]) => crypto.timingSafeEqual(expected, Buffer.from(value, 'ascii')));
};

// Zapier hands hook headers over as "Http-Ksefcanvas-Signature" (prefixed, Camel-Case); match any spelling.
const headerValue = (headers, name) => {
  if (!headers || typeof headers !== 'object') return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase().replace(/^http[-_]/, '').replace(/_/g, '-');
    if (normalized === wanted) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
};

module.exports = { TOLERANCE_SECONDS, headerValue, verifySignature };
