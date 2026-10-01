import { describe,expect,it } from 'vitest';
import { sanitizeProviderRecord, sanitizeProviderResponse } from '../../src/infrastructure/providers/sanitize-provider-response';

describe('provider response sanitization', () => {
  it('recursively redacts credentials and bootstrap data while retaining diagnostic evidence', () => {
    expect(sanitizeProviderRecord({
      status: 401,
      requestId: 'provider-request-1',
      Authorization: 'Bearer exposed',
      apiKey: 'exposed',
      nested: {
        accessToken: 'exposed',
        refresh_token: 'exposed',
        password: 'exposed',
        user_data: '#cloud-config\nsecret',
        reason: 'invalid credentials',
      },
    })).toEqual({
      status: 401,
      requestId: 'provider-request-1',
      Authorization: '[REDACTED]',
      apiKey: '[REDACTED]',
      nested: {
        accessToken: '[REDACTED]',
        refresh_token: '[REDACTED]',
        password: '[REDACTED]',
        user_data: '[REDACTED]',
        reason: 'invalid credentials',
      },
    });
  });

  it('bounds untrusted response sizes and converts non-JSON primitives', () => {
    const long = 'x'.repeat(5_000);
    const sanitized = sanitizeProviderResponse({ body: long, sequence: 12n }) as Record<string,unknown>;
    expect(String(sanitized.body)).toContain('[truncated]');
    expect(String(sanitized.body).length).toBeLessThan(long.length);
    expect(sanitized.sequence).toBe('12');
  });

  it('returns null when there is no structured provider response', () => {
    expect(sanitizeProviderRecord(undefined)).toBeNull();
    expect(sanitizeProviderRecord('provider unavailable')).toBeNull();
  });
});
