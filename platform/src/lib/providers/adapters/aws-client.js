/**
 * AWS query-protocol client (EC2, CloudWatch, EC2 Instance Connect).
 *
 * The audited original used `@aws-sdk/client-*`. This build is dependency-free, so the wire
 * protocol is implemented here: a form-encoded POST carrying `Action` and `Version`, signed with
 * Signature Version 4 (see ../aws-sigv4.js) and answered with XML (see ../aws-xml.js).
 *
 * Three AWS conventions are encoded here because they are easy to get subtly wrong:
 *  - EC2 lists serialise with the *singular* parameter name (`InstanceId.1`, `Tag.1.Key`,
 *    `TagSpecification.1.ResourceType`), while CloudWatch uses `member.1`;
 *  - error documents carry `<Code>`/`<Message>` inside `<Errors><Error>`, and the code — not the
 *    HTTP status — decides whether a failure is capacity, throttling or a bad configuration;
 *  - every call is signed with the exact body bytes that are sent, so nothing here re-serialises a
 *    request after signing it.
 */
'use strict';

const { ProviderError } = require('../types');
const { providerRequest } = require('../http');
const { signAwsRequest } = require('../aws-sigv4');
const { parseXml, child, childText, root } = require('../aws-xml');

/** The exact content-type sent and signed; SigV4 covers whatever headers are signed, byte for byte. */
const AWS_CONTENT_TYPE = 'application/x-www-form-urlencoded; charset=utf-8';

const API_VERSIONS = Object.freeze({
  ec2: '2016-11-15',
  monitoring: '2010-08-01',
  'ec2-instance-connect': '2019-04-18',
});

const LIST_MEMBER_STYLE = Object.freeze({
  ec2: 'singular',
  monitoring: 'member',
  'ec2-instance-connect': 'singular',
});

/** The regional endpoint for a service; overridable per provider for AWS-compatible endpoints. */
function endpointFor(service, region) {
  if (service === 'ec2') return `https://ec2.${region}.amazonaws.com/`;
  if (service === 'monitoring') return `https://monitoring.${region}.amazonaws.com/`;
  if (service === 'ec2-instance-connect') return `https://ec2-instance-connect.${region}.amazonaws.com/`;
  return `https://${service}.${region}.amazonaws.com/`;
}

/** EC2 singularises list members; CloudWatch uses `member`. */
function listMemberPrefix(prefix, style) {
  return style === 'member' ? `${prefix}.member` : prefix.replace(/s$/, '');
}

/**
 * Serialises action parameters into an AWS query-protocol body. Values are encoded with
 * `encodeURIComponent`, so a space is `%20` rather than `+` — both are valid form encodings, and
 * `%20` is what AWS's own SDKs send.
 */
function serializeQuery(params, options = {}) {
  const style = options.listMember ?? 'singular';
  const pairs = [];

  const add = (name, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => add(`${listMemberPrefix(name, style)}.${index + 1}`, entry));
      return;
    }
    if (value instanceof Date) {
      pairs.push([name, value.toISOString()]);
      return;
    }
    if (typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) add(`${name}.${key}`, entry);
      return;
    }
    if (typeof value === 'boolean') {
      pairs.push([name, value ? 'true' : 'false']);
      return;
    }
    pairs.push([name, String(value)]);
  };

  for (const [name, value] of Object.entries(params)) add(name, value);
  return pairs.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('&');
}

/** Extracts `<Code>`/`<Message>` from an AWS error document carried by a failed request. */
function awsErrorFromResponse(error) {
  const body = error?.providerResponse?.body;
  if (typeof body !== 'string' || !body.includes('<')) return {};
  try {
    const document = parseXml(body);
    const rootNode = root(document);
    if (!rootNode) return {};
    const errors = child(rootNode, 'Errors');
    const errorNode = child(errors ?? rootNode, 'Error') ?? rootNode;
    return { name: childText(errorNode, 'Code') ?? '', message: childText(errorNode, 'Message') };
  } catch {
    return {};
  }
}

/**
 * Turns an AWS failure into the provider failure vocabulary. The AWS error *code* is checked before
 * the generic status fallback, because the interesting AWS failures (insufficient capacity, request
 * throttling, a disabled serial console) arrive as HTTP 400.
 */
function translateAwsError(error) {
  if (!(error instanceof ProviderError)) return error;
  const status = error.providerResponse?.status;
  const { name = '', message } = awsErrorFromResponse(error);

  if (status === 401 || status === 403 || /AuthFailure|Unauthorized|InvalidClientToken/i.test(name)) {
    return new ProviderError('AUTHENTICATION_FAILED', 'AWS rejected the configured credentials or IAM permissions', false, error.providerResponse);
  }
  if (status === 404 || /NotFound/i.test(name)) {
    return new ProviderError('RESOURCE_NOT_FOUND', 'The requested AWS resource was not found', false, error.providerResponse);
  }
  if (/InsufficientInstanceCapacity|InsufficientHostCapacity/i.test(name)) {
    return new ProviderError('INSUFFICIENT_CAPACITY', 'AWS has insufficient capacity for the requested instance type', true, error.providerResponse);
  }
  if (/RequestLimitExceeded|Throttl/i.test(name) || status === 429) {
    return new ProviderError('RATE_LIMITED', 'AWS rate limited the request', true, error.providerResponse);
  }
  if (/Timeout|ETIMEDOUT/i.test(name)) {
    return new ProviderError('PROVIDER_TIMEOUT', 'AWS request timed out', true, error.providerResponse);
  }
  if (/ECONNRESET|ENOTFOUND|NetworkingError|Network/i.test(name)) {
    return new ProviderError('NETWORK_TEMPORARY_FAILURE', 'AWS network request failed', true, error.providerResponse);
  }
  if (/^AuthException$/i.test(name)) {
    return new ProviderError('AUTHENTICATION_FAILED', 'AWS rejected the configured credentials for EC2 Instance Connect', false, error.providerResponse);
  }
  if (/SerialConsoleAccessDisabled/i.test(name)) {
    return new ProviderError(
      'UNSUPPORTED_OPERATION',
      'EC2 Serial Console access is disabled for this AWS account; an operator must enable it with EnableSerialConsoleAccess',
      false,
      error.providerResponse,
    );
  }
  if (/EC2InstanceTypeInvalid/i.test(name)) {
    return new ProviderError('UNSUPPORTED_OPERATION', 'AWS offers the serial console only on Nitro instance types', false, error.providerResponse);
  }
  if (/EC2InstanceStateInvalid/i.test(name)) {
    return new ProviderError('SERVICE_UNAVAILABLE', 'The instance is not in a state that supports the serial console; start it and try again', true, error.providerResponse);
  }
  if (/SerialConsoleSessionLimitExceeded/i.test(name)) {
    return new ProviderError('SERVICE_UNAVAILABLE', 'The instance already has an open serial console session; only one is supported at a time', true, error.providerResponse);
  }

  if (name.length === 0) {
    // No AWS error document: a transport failure. Keep the classification providerRequest already
    // made rather than flattening a timeout into a generic provider error.
    if (['NETWORK_TEMPORARY_FAILURE', 'PROVIDER_TIMEOUT', 'RATE_LIMITED'].includes(error.code)) return error;
    const retryable = status === undefined || status >= 500;
    return new ProviderError(retryable ? 'NETWORK_TEMPORARY_FAILURE' : 'PROVIDER_ERROR', error.message, retryable, error.providerResponse);
  }

  return new ProviderError(
    'PROVIDER_ERROR',
    message ?? error.message,
    status === undefined || status >= 500,
    error.providerResponse,
  );
}

class AwsQueryClient {
  constructor(options) {
    this.service = options.service;
    this.region = options.region;
    this.endpoint = options.endpoint ?? endpointFor(options.service, options.region);
    this.credentials = options.credentials;
    this.transport = options.transport;
    this.apiVersion = options.apiVersion ?? API_VERSIONS[options.service];
    this.listMember = options.listMember ?? LIST_MEMBER_STYLE[options.service] ?? 'singular';
  }

  /**
   * Performs one API call and returns the parsed XML document. `params` are the action's parameters
   * in AWS's own names; `Action` and `Version` are added here so a caller cannot forget them.
   */
  async call(action, params = {}) {
    const body = serializeQuery({ Action: action, Version: this.apiVersion, ...params }, { listMember: this.listMember });
    const signed = signAwsRequest({
      method: 'POST',
      url: this.endpoint,
      body,
      headers: { 'content-type': AWS_CONTENT_TYPE },
      credentials: this.credentials,
      region: this.region,
      service: this.service,
    });
    // `host` is signed but not sent explicitly: fetch derives it from the URL, which is the same
    // value that was signed, and Node's fetch refuses to let a caller set it.
    const { host, ...sendableHeaders } = signed.headers;

    let raw;
    try {
      raw = await providerRequest(this.endpoint, { method: 'POST', body, headers: sendableHeaders }, {
        transport: this.transport,
        as: 'text',
      });
    } catch (error) {
      throw translateAwsError(error);
    }

    try {
      return parseXml(raw);
    } catch {
      throw new ProviderError(
        'PROVIDER_ERROR',
        `AWS returned a response to ${action} that could not be parsed as XML`,
        true,
      );
    }
  }
}

module.exports = {
  AwsQueryClient,
  AWS_CONTENT_TYPE,
  API_VERSIONS,
  LIST_MEMBER_STYLE,
  endpointFor,
  serializeQuery,
  listMemberPrefix,
  translateAwsError,
  awsErrorFromResponse,
};
