/**
 * Infrastructure provider egress layer.
 *
 * The adapters in this directory are the ported, dependency-free implementations of the
 * CloudHost247 provider boundary: one file per provider kind under `adapters/`, sharing the failure
 * vocabulary, the HTTP entry point, the credential-free base-URL rules and the response sanitizer.
 *
 * Two properties hold for every adapter and are covered by tests/provider-adapters.test.js:
 *  - credentials are read from the server-side environment only, and no code path logs, returns or
 *    audits a credential, a console URL or a rescue password;
 *  - an operation a provider does not genuinely offer fails with UNSUPPORTED_OPERATION naming the
 *    provider's own reason, instead of being simulated or answered from an unrelated endpoint.
 */
'use strict';

const types = require('./types');
const common = require('./common');
const { providerRequest } = require('./http');
const { sanitizeProviderResponse, sanitizeProviderRecord } = require('./sanitize');
const { providerErrorToHttpError } = require('./error-mapping');
const {
  createInfrastructureProviderAdapter,
  UnavailableProviderAdapter,
  IMPLEMENTED_ADAPTERS,
  PENDING_ADAPTERS,
} = require('./registry');
const { resetMockProviderState, isMockProviderEnabled } = require('./adapters/mock');

/**
 * The adapter modules themselves, for callers that need a piece an adapter keeps out of the
 * interface — the providers layer calls nothing in here at runtime; the test-suite uses it to drive
 * the deterministic helpers (the Contabo rescue-password generator, the AWS SigV4 signer, …).
 */
const adapters = {
  hetzner: require('./adapters/hetzner'),
  aws: require('./adapters/aws'),
  awsClient: require('./adapters/aws-client'),
  awsReplacement: require('./adapters/aws-replacement'),
  awsSerialConsole: require('./adapters/aws-serial-console'),
  digitalocean: require('./adapters/digitalocean'),
  vultr: require('./adapters/vultr'),
  ovh: require('./adapters/ovh'),
  ovhClient: require('./adapters/ovh-client'),
  proxmox: require('./adapters/proxmox'),
  proxmoxClient: require('./adapters/proxmox-client'),
  virtualizor: require('./adapters/virtualizor'),
  solusvm: require('./adapters/solusvm'),
  contabo: require('./adapters/contabo'),
  openstack: require('./adapters/openstack'),
  openstackClient: require('./adapters/openstack-client'),
  genericHttp: require('./adapters/generic-http'),
  mock: require('./adapters/mock'),
};

const awsSigV4 = require('./aws-sigv4');
const awsXml = require('./aws-xml');

module.exports = {
  ...types,
  ...common,
  providerRequest,
  sanitizeProviderResponse,
  sanitizeProviderRecord,
  providerErrorToHttpError,
  createInfrastructureProviderAdapter,
  UnavailableProviderAdapter,
  IMPLEMENTED_ADAPTERS,
  PENDING_ADAPTERS,
  resetMockProviderState,
  isMockProviderEnabled,
  adapters,
  awsSigV4,
  awsXml,
};
