/**
 * Status resolution — the rule that keeps the dashboard honest.
 *
 * Every assertion here is about a *single event*. The resolver is not allowed to consult history,
 * so a delivery line is the only thing that can produce `DELIVERED`, and a contradictory line must
 * degrade to `UNKNOWN` instead of picking the friendlier reading.
 */
import { describe, expect, it } from 'vitest';
import { resolveDeliveryStatus } from '../../src/email-trace/status-resolver';
import type { EximFlag, RawEximEvent, TraceEventType } from '../../src/email-trace/types';

const FLAG_EVENT: Record<EximFlag, TraceEventType> = {
  '<=': 'submission',
  '=>': 'delivery',
  '->': 'additional_delivery',
  '**': 'bounce',
  '==': 'deferral',
  '<*': 'rejection',
  '*>': 'completion',
  '!!': 'completion',
};

function event(flag: EximFlag, overrides: Partial<RawEximEvent> = {}): RawEximEvent {
  return {
    timestamp: new Date('2026-11-08T10:00:00.000Z'),
    messageId: '1xYzAb-000123-CD',
    flag,
    eventType: FLAG_EVENT[flag],
    sender: null,
    recipient: 'recipient@example.org',
    originalRecipient: null,
    remoteHostname: 'mx.example.org',
    smtpResponseCode: null,
    smtpResponseText: null,
    transport: null,
    router: null,
    reason: null,
    ...overrides,
  };
}

describe('resolveDeliveryStatus', () => {
  it('maps each flag to the status its evidence supports', () => {
    expect(resolveDeliveryStatus(event('<=')).status).toBe('ACCEPTED');
    expect(resolveDeliveryStatus(event('=>', { smtpResponseCode: 250 })).status).toBe('DELIVERED');
    expect(resolveDeliveryStatus(event('->', { smtpResponseCode: 250 })).status).toBe('DELIVERED');
    expect(resolveDeliveryStatus(event('==', { smtpResponseCode: 450 })).status).toBe('DEFERRED');
    expect(resolveDeliveryStatus(event('<*', { smtpResponseCode: 550 })).status).toBe('REJECTED');
  });

  it('separates a bounced message (remote 5xx) from a local permanent failure (no reply)', () => {
    const bounced = resolveDeliveryStatus(event('**', { smtpResponseCode: 550 }));
    const failed = resolveDeliveryStatus(event('**', { smtpResponseCode: null }));

    expect(bounced.status).toBe('BOUNCED');
    expect(failed.status).toBe('FAILED');
    expect(bounced.explanation).toContain('550');
  });

  it('never upgrades a remote acceptance into an inbox-placement claim', () => {
    const resolution = resolveDeliveryStatus(event('=>', { smtpResponseCode: 250 }));
    expect(resolution.status).toBe('DELIVERED');
    expect(resolution.explanation.toLowerCase()).toContain('not inbox placement');
    expect(resolution.explanation.toLowerCase()).not.toContain('read');
  });

  it('still reports DELIVERED transport evidence when the reply carries no code', () => {
    const resolution = resolveDeliveryStatus(event('=>', { smtpResponseCode: null }));
    expect(resolution.status).toBe('DELIVERED');
    expect(resolution.explanation).toContain('not inbox placement');
  });

  it('degrades contradictory evidence to UNKNOWN instead of guessing', () => {
    // A delivery line carrying a permanent failure is not a delivery.
    expect(resolveDeliveryStatus(event('=>', { smtpResponseCode: 550 })).status).toBe('UNKNOWN');
    // A deferral line carrying a permanent failure is not a deferral.
    expect(resolveDeliveryStatus(event('==', { smtpResponseCode: 550 })).status).toBe('UNKNOWN');
    // A bounce line carrying a non-permanent reply is not a bounce.
    expect(resolveDeliveryStatus(event('**', { smtpResponseCode: 450 })).status).toBe('UNKNOWN');
  });

  it('reports UNKNOWN for event types that are not delivery outcomes', () => {
    expect(resolveDeliveryStatus(event('<=', { eventType: 'routing' })).status).toBe('UNKNOWN');
    expect(resolveDeliveryStatus(event('<=', { eventType: 'completion' })).status).toBe('UNKNOWN');
  });

  it('answers QUEUED only for a queue snapshot', () => {
    expect(resolveDeliveryStatus(event('<=', { eventType: 'queue_snapshot' })).status).toBe('QUEUED');
  });

  it('always returns an explanation a person can read', () => {
    const flags: EximFlag[] = ['<=', '=>', '->', '**', '==', '<*'];
    for (const flag of flags) {
      const resolution = resolveDeliveryStatus(event(flag, { smtpResponseCode: null }));
      expect(resolution.explanation.length).toBeGreaterThan(10);
      expect(resolution.explanation.trim()).toBe(resolution.explanation);
    }
  });
});
