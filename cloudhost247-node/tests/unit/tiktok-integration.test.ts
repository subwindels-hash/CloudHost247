import { describe, expect, it, vi } from 'vitest';
import { tiktokPixelIdSchema, tiktokConfigurationSchema, defaultTikTokConfiguration, TIKTOK_EVENTS } from '../../src/tiktok/types';
import { sendTikTokEvent, TIKTOK_EVENTS_API_URL } from '../../src/tiktok/events-api-client';
import { toTikTokProperties } from '../../src/tiktok/event-service';

const PIXEL = 'C4A7B2D9E1F0A3B5C6D7';

describe('TikTok Pixel ID validation', () => {
  it('accepts documented alphanumeric pixel codes', () => {
    expect(tiktokPixelIdSchema.safeParse(PIXEL).success).toBe(true);
    expect(tiktokPixelIdSchema.safeParse('D1234567890ABCDEF').success).toBe(true);
  });
  it('rejects markup, scripts, numeric Meta-style IDs and whitespace', () => {
    for (const bad of ['<script>alert(1)</script>', '123456789012345', 'C4A7 B2D9 E1F0', 'short', '', 'C4A7B2D9E1F0A3B5C6D7E8F9A0B1C2D3E4F5']) {
      expect(tiktokPixelIdSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('TikTok configuration schema', () => {
  const valid = { ...defaultTikTokConfiguration, pixelId: PIXEL, websiteDomain: 'cloudhost247.com', enabled: true };
  it('accepts a complete enabled configuration', () => {
    expect(tiktokConfigurationSchema.safeParse(valid).success).toBe(true);
  });
  it('requires a Pixel ID before enabling and a code in test mode', () => {
    expect(tiktokConfigurationSchema.safeParse({ ...valid, pixelId: null }).success).toBe(false);
    expect(tiktokConfigurationSchema.safeParse({ ...valid, testMode: true, testEventCode: null }).success).toBe(false);
    expect(tiktokConfigurationSchema.safeParse({ ...valid, testMode: true, testEventCode: 'TEST123' }).success).toBe(true);
  });
  it('requires the browser pixel before the Events API or remarketing', () => {
    expect(tiktokConfigurationSchema.safeParse({ ...valid, enabled: false, eventsApi: { enabled: true } }).success).toBe(false);
    expect(tiktokConfigurationSchema.safeParse({ ...valid, enabled: false, remarketingEnabled: true }).success).toBe(false);
  });
  it('rejects unknown events and unknown keys (no arbitrary script fields)', () => {
    expect(tiktokConfigurationSchema.safeParse({ ...valid, enabledEvents: ['PageView', 'CustomThing'] }).success).toBe(false);
    expect(tiktokConfigurationSchema.safeParse({ ...valid, customScript: '<script>' }).success).toBe(false);
    expect(TIKTOK_EVENTS).toContain('CompletePayment');
    expect(TIKTOK_EVENTS).not.toContain('Purchase');
  });
});

describe('TikTok Events API client', () => {
  const credentials = { pixelId: PIXEL, token: 'token-value-0123456789', testEventCode: null };
  const event = { eventName: 'CompletePayment' as const, eventId: 'purchase:abc-123', occurredAt: '2026-11-08T00:00:00.000Z', sourceUrl: 'https://cloudhost247.com/invoices/1', customData: { value: 1500, currency: 'NGN' }, user: { ttp: 'ttp-value', externalIdHash: 'a'.repeat(64) } };
  it('posts to the official endpoint with token only in the Access-Token header and a shared event_id', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: 0, message: 'OK' }) })) as unknown as typeof fetch;
    const result = await sendTikTokEvent(credentials, event, fetchImpl);
    expect(result).toMatchObject({ accepted: true, httpStatus: 200 });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(TIKTOK_EVENTS_API_URL);
    expect(url).not.toContain('token-value');
    expect(init.headers['Access-Token']).toBe('token-value-0123456789');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ event_source: 'web', event_source_id: PIXEL });
    expect(body.data[0]).toMatchObject({ event: 'CompletePayment', event_id: 'purchase:abc-123', properties: { value: 1500, currency: 'NGN' }, user: { ttp: 'ttp-value' } });
    expect(body.data[0].event_time).toBe(Math.floor(new Date(event.occurredAt).getTime() / 1000));
  });
  it('includes test_event_code only in test mode', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: 0 }) })) as unknown as typeof fetch;
    await sendTikTokEvent({ ...credentials, testEventCode: 'TEST999' }, event, fetchImpl);
    const body = JSON.parse((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.test_event_code).toBe('TEST999');
  });
  it('classifies 5xx/429 as retryable and deterministic 4xx as terminal', async () => {
    const server = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ code: 50001 }) })) as unknown as typeof fetch;
    expect(await sendTikTokEvent(credentials, event, server)).toMatchObject({ accepted: false, retryable: true });
    const client = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ code: 40001 }) })) as unknown as typeof fetch;
    expect(await sendTikTokEvent(credentials, event, client)).toMatchObject({ accepted: false, retryable: false });
    const network = vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect(await sendTikTokEvent(credentials, event, network)).toMatchObject({ accepted: false, retryable: true, httpStatus: null });
  });
  it('never accepts a malformed 200 body as delivery', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } })) as unknown as typeof fetch;
    expect(await sendTikTokEvent(credentials, event, fetchImpl)).toMatchObject({ accepted: false, retryable: true });
  });
});

describe('TikTok properties mapping', () => {
  it('maps contents to documented content_id/price shape and preserves actual currency/value', () => {
    expect(toTikTokProperties({ contents: [{ id: 'catalog:hosting:pro', quantity: 2, item_price: 750 }], content_ids: ['catalog:hosting:pro'], value: 1500, currency: 'NGN', content_type: 'product' }))
      .toEqual({ contents: [{ content_id: 'catalog:hosting:pro', quantity: 2, price: 750 }], content_ids: ['catalog:hosting:pro'], value: 1500, currency: 'NGN', content_type: 'product' });
  });
});
