import { describe, expect, it } from 'vitest';
import { isValidSocialUrl } from '../../src/social/footer-links';

describe('footer social link validation', () => {
  it('accepts blank and network-specific HTTPS links', () => {
    expect(isValidSocialUrl('instagram', '')).toBe(true);
    expect(isValidSocialUrl('instagram', 'https://www.instagram.com/example')).toBe(true);
    expect(isValidSocialUrl('whatsapp', 'https://wa.me/123')).toBe(true);
    expect(isValidSocialUrl('tiktok', 'https://www.tiktok.com/@example')).toBe(true);
    expect(isValidSocialUrl('telegram', 'https://t.me/example')).toBe(true);
  });
  it('rejects unsafe schemes, credentials, ports and unrelated or deceptive hosts', () => {
    for (const value of ['http://instagram.com/x', 'javascript:alert(1)', 'https://instagram.com.evil.example/x', 'https://user@instagram.com/x', 'https://instagram.com:444/x']) {
      expect(isValidSocialUrl('instagram', value)).toBe(false);
    }
  });
});
