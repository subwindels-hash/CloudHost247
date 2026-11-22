/**
 * Per-conversation publication serialization for the support transcript. Handoff, cancellation
 * and staff status changes must not interleave with an AI publication that assumed a stale
 * state, so every publication takes the conversation row lock and rechecks inside one
 * transaction. Long work (retrieval, task execution) stays outside the lock; a lost COMMIT
 * acknowledgement leaves the publication outcome uncertain and must not be retried blindly.
 * Routes must authorize conversation access before calling these helpers.
 */
import type { Queryable } from '../../db/types';
import { withTransaction } from '../../db/transaction';

export class ConversationUnavailable extends Error {
  constructor() {
    super('Conversation is no longer available');
    this.name = 'ConversationUnavailable';
  }
}

/**
 * Run `fn` while holding the conversation row lock, passing its freshly read status. `fn` must
 * only use the transaction handle. Callers decide whether a changed status aborts or adapts;
 * concurrent publications, status changes and handoffs serialize on this lock.
 */
export async function withConversationLock<T>(
  db: Queryable, conversationId: string, fn: (tx: Queryable, status: string) => Promise<T>,
): Promise<T> {
  return withTransaction(db, async (tx) => {
    const conversation = await tx.query<{ status: string }>(
      `SELECT status FROM ai_support_conversations WHERE id = $1 FOR UPDATE`, [conversationId],
    );
    if (!conversation.rows[0]) throw new ConversationUnavailable();
    return fn(tx, conversation.rows[0].status);
  });
}

/**
 * Publish under the conversation lock, only while the conversation is still `AI_ACTIVE`.
 * Returns null — without running the insert — when a concurrent handoff, staff takeover or
 * closure won first, so a suppressed publication never appears after the new state.
 */
export async function publishWhileAiActive<T>(
  db: Queryable, conversationId: string, insert: (tx: Queryable) => Promise<T>,
): Promise<T | null> {
  return withConversationLock(db, conversationId, async (tx, status) =>
    (status === 'AI_ACTIVE' ? insert(tx) : null));
}
