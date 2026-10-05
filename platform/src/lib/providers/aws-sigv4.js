/**
 * AWS Signature Version 4 request signing, on Node's crypto module only.
 *
 * The audited original signed with the AWS SDK's EC2/CloudWatch/EC2-Instance-Connect clients. This
 * build has no dependencies, so the signing is implemented here from the published algorithm and
 * verified against the AWS SigV4 test suite (see the known-answer tests: `get-vanilla` and
 * `post-x-www-form-urlencoded`). Getting this wrong would produce a request the provider rejects as
 * `SignatureDoesNotMatch`, which is exactly the kind of failure a loopback fake cannot invent — hence
 * the published vectors.
 *
 * What is signed: every header the caller passes plus `host`, `x-amz-date` and (for temporary
 * credentials) `x-amz-security-token`. `x-amz-content-sha256` is not sent: EC2, CloudWatch and EC2
 * Instance Connect do not require it, and the payload hash is already inside the canonical request.
 */
'use strict';

const { createHash, createHmac } = require('node:crypto');

/** Lowercase hex SHA-256, the hash form SigV4 uses everywhere. */
function sha256Hex(value) {
  return createHash('sha256').update(value ?? '', 'utf8').digest('hex');
}

/** Raw HMAC-SHA256 bytes. `key` may be a string or a Buffer. */
function hmacSha256(key, value) {
  return createHmac('sha256', key).update(value ?? '', 'utf8').digest();
}

/**
 * The signature key is derived through a fixed HMAC chain so that the secret itself never has to
 * leave the process: kDate, kRegion, kService, kSigning.
 */
function signingKey(secretAccessKey, dateStamp, region, service) {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

/** `20150830T123600Z` — the X-Amz-Date form, always UTC. */
function amzTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** RFC 3986 encoding with the extra characters SigV4 requires to be escaped. */
function uriEncode(value) {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Canonical URI: each path segment is encoded, but the separators stay. The path is not
 * double-encoded, so a caller must pass an already-decoded path.
 */
function canonicalUri(path) {
  const raw = path && path.length > 0 ? path : '/';
  return raw.split('/').map(uriEncode).join('/');
}

/** Canonical query string: encoded, sorted by name then value, empty when there is no query. */
function canonicalQueryString(search) {
  const query = String(search ?? '').replace(/^\?/, '');
  if (query.length === 0) return '';
  const pairs = [];
  for (const pair of query.split('&')) {
    if (pair.length === 0) continue;
    const index = pair.indexOf('=');
    const name = index === -1 ? pair : pair.slice(0, index);
    const value = index === -1 ? '' : pair.slice(index + 1);
    pairs.push([uriEncode(decodeURIComponent(name)), uriEncode(decodeURIComponent(value))]);
  }
  pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : (a[0] < b[0] ? -1 : 1)));
  return pairs.map(([name, value]) => `${name}=${value}`).join('&');
}

/** Header values are trimmed and internal runs of whitespace collapse to one space. */
function normalizeHeaderValue(value) {
  return String(value).trim().replace(/\s+/g, ' ');
}

function canonicalizeHeaders(headers) {
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), normalizeHeaderValue(value)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return {
    block: entries.map(([name, value]) => `${name}:${value}\n`).join(''),
    signedHeaders: entries.map(([name]) => name).join(';'),
  };
}

function canonicalRequest({ method, path, query, headers, payloadHash }) {
  const canonical = canonicalizeHeaders(headers);
  return [
    method.toUpperCase(),
    canonicalUri(path),
    canonicalQueryString(query),
    canonical.block,
    canonical.signedHeaders,
    payloadHash,
  ].join('\n');
}

function stringToSign({ timestamp, scope, canonicalRequest: request }) {
  return ['AWS4-HMAC-SHA256', timestamp, scope, sha256Hex(request)].join('\n');
}

/**
 * Signs one request.
 *
 * @param {object} options
 * @param {string} options.method
 * @param {string} options.url                  absolute URL; its host, path and query are signed
 * @param {string} [options.body]               exact bytes that will be sent ('' when there is none)
 * @param {{accessKeyId: string, secretAccessKey: string, sessionToken?: string}} options.credentials
 * @param {string} options.region
 * @param {string} options.service              `ec2`, `monitoring`, `ec2-instance-connect`, …
 * @param {Date} [options.date]                 the signing time; defaults to now
 * @param {Record<string,string>} [options.headers] extra headers to sign and send
 * @returns {{headers: Record<string,string>, signature: string, scope: string,
 *            payloadHash: string, canonicalRequest: string, stringToSign: string}}
 */
function signAwsRequest(options) {
  const {
    method, url, body = '', credentials, region, service, date = new Date(), headers: extraHeaders = {},
  } = options;
  const parsed = new URL(url);
  const headers = { host: parsed.host, ...extraHeaders };
  const timestamp = amzTimestamp(date);
  headers['x-amz-date'] = timestamp;
  if (credentials.sessionToken) headers['x-amz-security-token'] = credentials.sessionToken;

  const payloadHash = sha256Hex(body);
  const request = canonicalRequest({
    method,
    path: parsed.pathname,
    query: parsed.search,
    headers,
    payloadHash,
  });
  const dateStamp = timestamp.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const toSign = stringToSign({ timestamp, scope, canonicalRequest: request });
  const signature = createHmac('sha256', signingKey(credentials.secretAccessKey, dateStamp, region, service))
    .update(toSign, 'utf8')
    .digest('hex');
  const canonical = canonicalizeHeaders(headers);

  return {
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, `
        + `SignedHeaders=${canonical.signedHeaders}, Signature=${signature}`,
    },
    signature,
    scope,
    payloadHash,
    canonicalRequest: request,
    stringToSign: toSign,
  };
}

module.exports = {
  sha256Hex,
  hmacSha256,
  signingKey,
  amzTimestamp,
  uriEncode,
  canonicalUri,
  canonicalQueryString,
  canonicalizeHeaders,
  canonicalRequest,
  stringToSign,
  signAwsRequest,
};
