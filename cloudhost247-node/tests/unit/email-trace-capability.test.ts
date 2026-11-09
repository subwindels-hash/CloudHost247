/**
 * Capability reporting for the Email Trace Centre.
 *
 * The point of these tests is that the feature reports what it *cannot* see. Every "we don't know"
 * must come out as `unknown`, never as success, and every report must carry the transport caveat so
 * the UI cannot render a delivery status as if it were inbox placement.
 */
import { describe, expect, it } from 'vitest';
import { assessCapability, type MailHostFacts } from '../../src/email-trace/capability';

const healthy: MailHostFacts = {
  agentReachable: true,
  agentSupportsMailTrace: true,
  mainlogReadable: true,
  queueListingAvailable: true,
};

describe('assessCapability', () => {
  it('reports both channels when the agent can read the log and list the queue', () => {
    const report = assessCapability(healthy);
    expect(report).toMatchObject({ mainlog: 'available', queue: 'available', canCollect: true, canShowQueue: true });
    expect(report.summary).toContain('Message log and read-only queue');
  });

  it('marks everything unknown when the agent cannot be reached', () => {
    const report = assessCapability({ ...healthy, agentReachable: false });
    expect(report).toMatchObject({ mainlog: 'unknown', queue: 'unknown', canCollect: false, canShowQueue: false });
    expect(report.summary).toBe('This server cannot be reached by the collector right now.');
  });

  it('marks an old agent as unsupported rather than silently collecting nothing', () => {
    const report = assessCapability({ ...healthy, agentSupportsMailTrace: false });
    expect(report.mainlog).toBe('unsupported');
    expect(report.canCollect).toBe(false);
    expect(report.limitations.join(' ')).toContain('update the agent');
  });

  it('distinguishes an unreadable log from an unprobed one', () => {
    const unreadable = assessCapability({ ...healthy, mainlogReadable: false });
    expect(unreadable.mainlog).toBe('unavailable');
    expect(unreadable.canCollect).toBe(false);
    expect(unreadable.summary).toContain('could not be read');

    const unprobed = assessCapability({ ...healthy, mainlogReadable: null });
    expect(unprobed.mainlog).toBe('unknown');
    expect(unprobed.canCollect).toBe(false);
    // "unknown" must never be presented as success.
    expect(unprobed.summary).toContain('not been confirmed');
  });

  it('keeps log collection working when only the queue listing is missing', () => {
    const report = assessCapability({ ...healthy, queueListingAvailable: false });
    expect(report).toMatchObject({ mainlog: 'available', queue: 'unsupported', canCollect: true, canShowQueue: false });
  });

  it('treats an unprobed queue as unknown, not unsupported', () => {
    const report = assessCapability({ ...healthy, queueListingAvailable: null });
    expect(report.queue).toBe('unknown');
    expect(report.canShowQueue).toBe(false);
  });

  it('always carries the transport caveat and never claims inbox placement', () => {
    for (const facts of [
      healthy,
      { ...healthy, agentReachable: false },
      { ...healthy, agentSupportsMailTrace: false },
      { ...healthy, mainlogReadable: false },
    ]) {
      const report = assessCapability(facts);
      const joined = [report.summary, ...report.limitations].join(' ');
      expect(joined).toMatch(/SMTP/);
      expect(joined).toContain('does not prove inbox placement');
      expect(joined.toLowerCase()).not.toContain('opened in');
      expect(joined.toLowerCase()).not.toContain('inbox delivery confirmed');
    }
  });

  it('passes agent notes through verbatim instead of hiding them', () => {
    const report = assessCapability({ ...healthy, notes: ['Queue listing requires the exim binary on PATH'] });
    expect(report.limitations).toContain('Queue listing requires the exim binary on PATH');
  });
});
