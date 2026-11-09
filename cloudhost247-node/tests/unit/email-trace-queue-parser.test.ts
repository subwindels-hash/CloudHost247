/**
 * `exim -bp` queue parser — SYNTHETIC fixtures.
 *
 * A queue listing is informational: the queue view must say *when* the number was observed, so the
 * parser produces a snapshot with counts and ages rather than a live-looking figure. Unreadable
 * lines are counted, because a queue that cannot be parsed must never look empty.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEximAge, parseEximQueue } from '../../src/email-trace/exim/queue-parser';

const FIXTURE = readFileSync(
  path.join(process.cwd(), 'tests', 'fixtures', 'email-trace', 'queue-sample.txt'),
  'utf8'
);

describe('parseEximAge', () => {
  it('understands the compact age column', () => {
    expect(parseEximAge('2d')).toBe(172_800);
    expect(parseEximAge('14h')).toBe(50_400);
    expect(parseEximAge('45m')).toBe(2_700);
    expect(parseEximAge('9s')).toBe(9);
    expect(parseEximAge('3d4h')).toBe(3 * 86_400 + 4 * 3_600);
  });

  it('returns null for a token it does not understand rather than guessing an age', () => {
    expect(parseEximAge('')).toBeNull();
    expect(parseEximAge('soon')).toBeNull();
    expect(parseEximAge('12x')).toBeNull();
  });
});

describe('parseEximQueue', () => {
  const snapshot = parseEximQueue(FIXTURE);

  it('counts the messages and the oldest age from the listing itself', () => {
    expect(snapshot.count).toBe(2);
    expect(snapshot.oldestSeconds).toBe(172_800);
    expect(snapshot.unparsedLines).toBe(0);
  });

  it('counts a message with an explanation line as deferred', () => {
    expect(snapshot.deferred).toBe(1);
    const deferred = snapshot.messages.find((message) => message.hasError);
    expect(deferred?.messageId).toBe('1xYzQq-000456-EF');
    expect(deferred?.sender).toBe('<>');
  });

  it('records one recipient per listed address', () => {
    for (const message of snapshot.messages) {
      expect(message.recipientCount).toBe(1);
    }
  });

  it('reports an empty queue as empty, not as a parse failure', () => {
    const empty = parseEximQueue('');
    expect(empty.count).toBe(0);
    expect(empty.oldestSeconds).toBeNull();
    expect(empty.deferred).toBe(0);
    expect(empty.unparsedLines).toBe(0);
  });

  it('counts lines it cannot read instead of silently dropping them', () => {
    const messy = parseEximQueue(` 14h  1xYzAb-000123-CD  1.3K  sender@example.com
        recipient@example.org
this line is not part of the listing format`);
    expect(messy.unparsedLines).toBe(1);
    expect(messy.count).toBe(1);
  });

  it('ignores the trailing "N messages found" summary line', () => {
    const withSummary = parseEximQueue(` 14h  1xYzAb-000123-CD  1.3K  sender@example.com
        recipient@example.org
2 messages found`);
    expect(withSummary.unparsedLines).toBe(0);
    expect(withSummary.count).toBe(1);
  });
});
