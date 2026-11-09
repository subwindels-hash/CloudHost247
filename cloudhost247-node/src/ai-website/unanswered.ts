import type { Queryable } from '../db/types';

/**
 * Measures what the assistant could not answer.
 *
 * The queue is deliberately *observational*: it records questions that produced no grounded answer,
 * so an administrator can go and publish the missing page. It never feeds back into answering —
 * there is no path from "a customer asked this" to "the assistant now says this", which is what
 * keeps the corpus a projection of the website rather than a rumour mill.
 */

/** Normalises a question so the same question asked five ways counts as one gap. */
export function questionKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export interface UnansweredInput {
  question: string;
  intent: string | null;
  conversationId: string | null;
  messageId: string | null;
}

/**
 * Records (or increments) an unanswered question. Best-effort: a failure here must never break a
 * customer conversation, so errors are swallowed. The unique index on `question_key` makes the
 * increment atomic under concurrent traffic.
 */
export async function recordUnansweredQuestion(db: Queryable, input: UnansweredInput): Promise<void> {
  const key = questionKey(input.question);
  if (key.length < 4) return;
  try {
    await db.query(
      `INSERT INTO ai_support_unanswered_questions (question, question_key, intent, conversation_id, message_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (question_key) DO UPDATE
          SET occurrences = ai_support_unanswered_questions.occurrences + 1,
              last_asked_at = now(),
              intent = COALESCE(ai_support_unanswered_questions.intent, EXCLUDED.intent)`,
      [input.question.slice(0, 2000), key, input.intent, input.conversationId, input.messageId]
    );
  } catch {
    // Diagnostics, not the conversation.
  }
}

/** Marks a gap covered once the content exists. */
export async function resolveUnansweredQuestion(
  db: Queryable,
  questionKeyValue: string,
  resolvedBy: string | null,
  note: string | null
): Promise<boolean> {
  const result = await db.query<{ id: string }>(
    `UPDATE ai_support_unanswered_questions
        SET resolved = true, resolved_by = $2, resolved_at = now(), resolution_note = $3
      WHERE question_key = $1 AND resolved = false
      RETURNING id`,
    [questionKeyValue, resolvedBy, note]
  );
  return result.rows.length > 0;
}
