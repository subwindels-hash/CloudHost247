import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_ID_SPACE,
  generateCustomerIdCandidate,
  isUniqueViolation,
  isValidCustomerId,
} from '../../src/services/customer-identity-service';
import {
  MAX_PROFILE_IMAGE_BYTES,
  sniffImageType,
  validateProfileImageUpload,
} from '../../src/lib/image-upload';
import { SUPPORT_MODE_RESTRICTED_ACTIONS, isSupportModeRestricted } from '../../src/lib/support-mode';

describe('Customer ID generation', () => {
  it('always produces a zero-padded six-digit string', () => {
    for (let i = 0; i < 2000; i += 1) {
      const id = generateCustomerIdCandidate();
      expect(id).toMatch(/^[0-9]{6}$/);
      expect(id).toHaveLength(6);
      expect(isValidCustomerId(id)).toBe(true);
    }
  });

  it('spans the full space including values that require leading zeros', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i += 1) seen.add(generateCustomerIdCandidate());
    // With 20k CSPRNG draws from a 1e6 space we expect ~20k distinct values; a broken generator
    // (e.g. a fixed prefix, or Math.random seeded identically) collapses this dramatically.
    expect(seen.size).toBeGreaterThan(15_000);
    expect(Math.max(...[...seen].map(Number))).toBeLessThan(CUSTOMER_ID_SPACE);
  });

  it('rejects malformed identifiers', () => {
    for (const bad of ['12345', '1234567', 'abcdef', '12 345', '', '12345a']) {
      expect(isValidCustomerId(bad)).toBe(false);
    }
  });

  it('recognises a unique-violation only for the matching constraint', () => {
    const err = Object.assign(new Error('duplicate key value violates unique constraint "users_customer_id_unique_idx"'), {
      code: '23505',
      constraint: 'users_customer_id_unique_idx',
    });
    expect(isUniqueViolation(err, 'customer_id')).toBe(true);
    expect(isUniqueViolation(err, 'email')).toBe(false);
    expect(isUniqueViolation(new Error('nope'))).toBe(false);
  });
});

describe('profile image validation', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 1),
  ]);

  it('accepts a real PNG and derives type, size and checksum server-side', () => {
    const result = validateProfileImageUpload({ data: png.toString('base64'), fileName: 'me.png' });
    expect(result.contentType).toBe('image/png');
    expect(result.byteSize).toBe(png.length);
    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts a data URL whose declared type matches the bytes', () => {
    const result = validateProfileImageUpload({ data: `data:image/png;base64,${png.toString('base64')}` });
    expect(result.contentType).toBe('image/png');
  });

  it('rejects SVG and other executable/markup payloads outright', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(() => validateProfileImageUpload({ data: svg.toString('base64'), contentType: 'image/svg+xml' })).toThrow();
    expect(() => validateProfileImageUpload({ data: svg.toString('base64') })).toThrow(/not a supported image/i);
    const html = Buffer.from('<!DOCTYPE html><html><body><script>1</script></body></html>');
    expect(() => validateProfileImageUpload({ data: html.toString('base64') })).toThrow();
    expect(sniffImageType(svg)).toBeNull();
  });

  it('rejects bytes that do not match the declared content type', () => {
    expect(() => validateProfileImageUpload({ data: png.toString('base64'), contentType: 'image/jpeg' })).toThrow(
      /do not match/i
    );
  });

  it('rejects a mismatched file extension even when the bytes are valid', () => {
    expect(() => validateProfileImageUpload({ data: png.toString('base64'), fileName: 'payload.php' })).toThrow(
      /extension/i
    );
  });

  it('enforces the size cap on decoded bytes', () => {
    const huge = Buffer.concat([png, Buffer.alloc(MAX_PROFILE_IMAGE_BYTES + 10, 7)]);
    expect(() => validateProfileImageUpload({ data: huge.toString('base64') })).toThrow(/smaller/i);
  });
});

describe('support-mode restrictions', () => {
  it('blocks the documented sensitive actions', () => {
    for (const action of ['password.change', 'security_number.reveal', 'security_number.change', 'account.delete']) {
      expect(isSupportModeRestricted(action)).toBe(true);
      expect(SUPPORT_MODE_RESTRICTED_ACTIONS).toContain(action);
    }
    expect(isSupportModeRestricted('tickets.reply')).toBe(false);
  });
});
