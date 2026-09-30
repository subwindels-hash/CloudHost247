import { describe, expect, it } from 'vitest';
import { providerErrorToHttpError } from '../../src/infrastructure/providers/error-mapping';
import { ProviderError } from '../../src/infrastructure/providers/types';
import { NotFoundError } from '../../src/lib/errors';

/**
 * Request-scoped provider calls must never surface as a 500, and must never echo the provider's
 * own wording — that text can name internal endpoints and hosts. The mapping therefore returns a
 * fixed customer-facing sentence per class of failure.
 */
describe('provider error mapping', () => {
  it('reports a missing or broken integration as an explicit 503, not a 500', () => {
    for (const code of ['PROVIDER_NOT_CONFIGURED', 'CONFIGURATION_REQUIRED', 'AUTHENTICATION_FAILED', 'INVALID_CONFIGURATION']) {
      const mapped = providerErrorToHttpError(new ProviderError(code, 'token missing for https://internal.example', false));
      expect(mapped.statusCode).toBe(503);
      expect(mapped.code).toBe('SERVICE_UNAVAILABLE');
      expect(mapped.message).not.toMatch(/internal\.example|token/);
    }
  });

  it('reports transient provider trouble as retryable-sounding 503', () => {
    for (const code of ['SERVICE_UNAVAILABLE', 'RATE_LIMITED', 'PROVIDER_TIMEOUT', 'NETWORK_TEMPORARY_FAILURE']) {
      const mapped = providerErrorToHttpError(new ProviderError(code, 'upstream said no', true));
      expect(mapped.statusCode).toBe(503);
      expect(mapped.message).toMatch(/try again|capacity/i);
    }
  });

  it('turns an unsupported operation into a 400 and a missing resource into a 404', () => {
    expect(providerErrorToHttpError(new ProviderError('UNSUPPORTED_OPERATION', 'no console api', false)).statusCode).toBe(400);
    expect(providerErrorToHttpError(new ProviderError('RESOURCE_NOT_FOUND', 'vm gone', false)).statusCode).toBe(404);
  });

  it('passes an existing HttpError through untouched and defaults anything else to 502', () => {
    const passthrough = new NotFoundError('No server was found with that id');
    expect(providerErrorToHttpError(passthrough)).toBe(passthrough);
    const unknown = providerErrorToHttpError(new Error('socket exploded'));
    expect(unknown.statusCode).toBe(502);
    expect(unknown.message).not.toMatch(/socket/);
  });
});
