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
};
