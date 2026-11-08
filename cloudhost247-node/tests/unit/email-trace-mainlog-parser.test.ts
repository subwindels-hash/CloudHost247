/**
 * Exim mainlog parser — behaviour against SYNTHETIC fixtures.
 *
 * The fixtures are hand-written from Exim's documented message-log format
 * (tests/fixtures/email-trace/README.md). Passing these tests proves the parser implements the
 * documented rules; it does **not** prove the deployed cPanel/Exim build logs in this shape. That
 * distinction is recorded in docs/EMAIL-TRACE-CENTRE-ARCHITECTURE.md §12.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMainlog, parseMainlogLine } from '../../src/email-trace/exim/mainlog-parser';

const FIXTURE = readFileSync(
  path.join(process.cwd(), 'tests', 'fixtures', 'email-trace', 'mainlog-sample.log'),
  'utf8'
);

function expectEvent(line: string) {
  const outcome = parseMainlogLine(line);
  if (outcome.kind !== 'event') throw new Error(`expected an event, got ${outcome.kind}: ${outcome.reason}`);
  return outcome.event;
}

describe('parseMainlogLine — message lifecycle', () => {
  it('reads a submission as ACCEPTED evidence with the sender and the `for` recipient', () => {
    const event = expectEvent(
      '2026-11-08 09:14:02 1xYzAb-000123-CD <= sender@example.com H=(mail.sender.example) [203.0.113.5] P=esmtpa A=dovecot_login:sender@example.com S=4821 id=8f2c9a@example.com T="Quarterly invoice attached" for recipient@example.org'
    );

    expect(event.flag).toBe('<=');
    expect(event.eventType).toBe('submission');
    expect(event.sender).toBe('sender@example.com');
    expect(event.recipient).toBe('recipient@example.org');
    expect(event.timestamp.toISOString()).toBe('2026-11-08T09:14:02.000Z');
  });

  it('never carries the message subject or the authenticator identity out of a submission line', () => {
    const event = expectEvent(
      '2026-11-08 09:14:02 1xYzAb-000123-CD <= sender@example.com P=esmtpa A=dovecot_login:sender@example.com T="Quarterly invoice attached" for recipient@example.org'
    );

    const serialised = JSON.stringify(event);
    expect(serialised).not.toContain('Quarterly invoice');
    expect(serialised).not.toContain('dovecot_login');
  });

  it('reads a remote acceptance with its SMTP reply, transport and remote host', () => {
    const event = expectEvent(
      '2026-11-08 09:14:03 1xYzAb-000123-CD => recipient@example.org R=dnslookup T=remote_smtp H=mx.example.org [198.51.100.9] X=TLS1.3 CV=yes C="250 2.0.0 Ok: queued as 4Wx9"'
    );

    expect(event.eventType).toBe('delivery');
    expect(event.recipient).toBe('recipient@example.org');
    expect(event.smtpResponseCode).toBe(250);
    expect(event.smtpResponseText).toBe('250 2.0.0 Ok: queued as 4Wx9');
    expect(event.remoteHostname).toBe('mx.example.org');
    expect(event.transport).toBe('remote_smtp');
    expect(event.router).toBe('dnslookup');
  });

  it('keeps the original envelope recipient on an aliased additional delivery', () => {
    const event = expectEvent(
      '2026-11-08 09:14:03 1xYzAb-000123-CD -> alias@example.org <recipient@example.org> R=dnslookup T=remote_smtp H=mx.example.org [198.51.100.9] C="250 2.0.0 Ok"'
    );

    expect(event.eventType).toBe('additional_delivery');
    expect(event.recipient).toBe('alias@example.org');
    expect(event.originalRecipient).toBe('<recipient@example.org>');
  });

  it('reads a deferral with its 4xx reply and the explanation, without mistaking `defer (-44)` for a reply code', () => {
    const event = expectEvent(
      '2026-11-08 10:02:44 1xYzAb-000125-GH == customer@example.net R=dnslookup T=remote_smtp defer (-44): SMTP error from remote mail server after RCPT TO:<customer@example.net>: host mx.example.net [198.51.100.20]: 450 4.7.1 Greylisted, try again later'
    );

    expect(event.eventType).toBe('deferral');
    expect(event.smtpResponseCode).toBe(450);
    expect(event.smtpResponseCode).not.toBe(44);
    expect(event.reason).toContain('Greylisted');
    expect(event.remoteHostname).toBe('mx.example.net');
  });

  it('reads a permanent remote refusal with its 5xx reply', () => {
    const event = expectEvent(
      '2026-11-08 10:05:10 1xYzAb-000126-IJ ** missing@example.net R=dnslookup T=remote_smtp: SMTP error from remote mail server after RCPT TO:<missing@example.net>: host mx.example.net [198.51.100.20]: 550 5.1.1 No such user'
    );

    expect(event.eventType).toBe('bounce');
    expect(event.smtpResponseCode).toBe(550);
    expect(event.recipient).toBe('missing@example.net');
  });

  it('leaves the reply code null when a local failure has no SMTP evidence', () => {
    const event = expectEvent(
      '2026-11-08 10:06:00 1xYzAb-000127-KL ** localuser@example.com R=localuser T=local_delivery: mailbox is full'
    );

    expect(event.eventType).toBe('bounce');
    expect(event.smtpResponseCode).toBeNull();
    expect(event.reason).toBe('mailbox is full');
  });

  it('reads a rejection and strips the trailing colon Exim puts after the address', () => {
    const event = expectEvent('2026-11-08 10:07:00 1xYzAb-000128-MN <* blocked@example.org: 550 5.7.1 Message rejected as spam');

    expect(event.eventType).toBe('rejection');
    expect(event.recipient).toBe('blocked@example.org');
    expect(event.smtpResponseCode).toBe(550);
  });
});

describe('parseMainlogLine — lines that must produce nothing or be rejected', () => {
  it('ignores the trace-level `Completed` marker instead of inventing a delivery event', () => {
    const outcome = parseMainlogLine('2026-11-08 09:14:03 1xYzAb-000123-CD Completed');
    expect(outcome.kind).toBe('ignored');
  });

  it('ignores a `-N` suppressed delivery, which neither delivered nor failed', () => {
    const outcome = parseMainlogLine(
      '2026-11-08 10:08:00 1xYzAb-000129-OP *> suppressed@example.org R=dnslookup T=remote_smtp suppressed by -N'
    );
    expect(outcome.kind).toBe('ignored');
  });

  it('rejects a line with no Exim message id rather than inventing one', () => {
    const outcome = parseMainlogLine('2026-11-08 10:09:00 no immediate delivery: queued 1 message');
    expect(outcome.kind).toBe('rejected');
  });

  it('rejects a line without a timestamp', () => {
    const outcome = parseMainlogLine('1xYzAb-000123-CD => recipient@example.org R=dnslookup');
    expect(outcome.kind).toBe('rejected');
  });
});

describe('parseMainlog — whole-file accounting', () => {
  const result = parseMainlog(FIXTURE);

  it('collects the seven event-bearing lines and reports the rest honestly', () => {
    expect(result.events).toHaveLength(7);
    expect(result.ignored).toHaveLength(2);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.map((entry) => entry.reason)).toEqual([
      'line has no Exim message id',
      'line has no Exim message id',
    ]);
  });

  it('produces no event from the 7th line onwards that claims a delivery the fixture did not record', () => {
    const delivered = result.events.filter((event) => event.eventType === 'delivery');
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.recipient).toBe('recipient@example.org');
  });

  it('keeps fixture addresses out of anything that would look like real customer data', () => {
    const addresses = result.events.flatMap((event) => [event.sender, event.recipient].filter(Boolean));
    expect(addresses.every((address) => String(address).endsWith('.example') || String(address).includes('example.'))).toBe(true);
  });
});
