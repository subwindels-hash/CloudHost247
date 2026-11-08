/**
 * Parser for `exim -bp` output (the read-only queue listing).
 *
 * The listing is informational, not authoritative: it is a snapshot taken by a collector at a
 * moment in time, and the UI must present it as "as of the last successful collection" rather than
 * a live counter. Nothing here can delete, retry, freeze or force a message — the parser only reads
 * text, and the collector that feeds it is limited to the read-only queue commands.
 *
 * Shape being parsed (synthetic example):
 *
 * ```
 *  2d  1xYzAb-000123-CD  1.3K  sender@example.com
 *         recipient@example.org
 *  4h  1xYzQq-000456-EF  2.0K  <>
 *         user@example.com
 *         SMTP error from remote mail server after RCPT TO:<user@example.com>: 450 4.7.1 Greylisted
 * ```
 *
 * A message whose body contains an error line is counted as deferred. A token the parser does not
 * understand increments `unparsedLines` and is reported — an unreadable queue must never look like
 * an empty one.
 */
import type { QueueSnapshot, QueuedMessage } from '../types';

/** `14h`, `2d`, `3d4h`, `45m`, `9s` — Exim's compact age column. */
const AGE_RE = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;
const MESSAGE_HEADER_RE =
  /^\s{0,3}(\S+)\s+([A-Za-z0-9]{6}-[A-Za-z0-9]{6}-[A-Za-z0-9]{2})\s+(\S+)\s+(\S+)\s*$/;
const SUMMARY_RE = /^\s*\d+\s+messages?\s+found\s*$/i;

export function parseEximAge(token: string): number | null {
  const match = AGE_RE.exec(token.trim());
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  if (!days && !hours && !minutes && !seconds) return null;
  return (
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  );
}

function isRecipientLine(text: string): boolean {
  // `D <addr>` marks an address already delivered in this delivery; it is still an address.
  const candidate = text.startsWith('D ') ? text.slice(2).trim() : text;
  return /^[^\s@]+@[^\s@]+$/.test(candidate.replace(/[<>]/g, ''));
}

/** Parses `exim -bp` output into a snapshot the queue view may display. */
export function parseEximQueue(text: string): QueueSnapshot {
  const messages: QueuedMessage[] = [];
  let current: QueuedMessage | null = null;
  let unparsedLines = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.trim() === '') continue;
    if (SUMMARY_RE.test(line)) continue;

    const header = MESSAGE_HEADER_RE.exec(line);
    if (header) {
      const ageToken = header[1] ?? '';
      const messageId = header[2] ?? '';
      const sizeText = header[3] ?? null;
      const sender = header[4] ?? null;
      const entry: QueuedMessage = {
        messageId,
        ageSeconds: parseEximAge(ageToken),
        sizeText,
        sender: sender === '<>' ? '<>' : sender,
        recipientCount: 0,
        hasError: false,
      };
      current = entry;
      messages.push(entry);
      continue;
    }

    const indented = /^\s{4,}/.test(rawLine);
    if (current && indented) {
      const body = line.trim();
      if (isRecipientLine(body)) {
        current.recipientCount += 1;
      } else {
        // Any other indented text is an explanation of why the message is still queued.
        current.hasError = true;
      }
      continue;
    }

    unparsedLines += 1;
  }

  const ages = messages.map((message) => message.ageSeconds).filter((age): age is number => age !== null);

  return {
    messages,
    count: messages.length,
    oldestSeconds: ages.length > 0 ? Math.max(...ages) : null,
    deferred: messages.filter((message) => message.hasError).length,
    unparsedLines,
  };
}
