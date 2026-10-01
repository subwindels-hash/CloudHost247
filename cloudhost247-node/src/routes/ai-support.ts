import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { authenticate, type AuthenticatedRequestContext } from '../lib/require-auth';
import { requireRole, type AuthorizedRequestContext } from '../lib/require-role';
import { NotFoundError, ValidationError } from '../lib/errors';
import { auditRequest } from '../lib/audit';
import { createTicket } from '../db/support-tickets';
import { createNotification } from '../services/notification-service';
import { decideSupportResponse, listSupportKnowledge, type EscalationReason } from '../services/ai-support-operator';

const id = z.string().uuid('conversation id must be a valid UUID');
const email = z.string().trim().email().max(320);
const messageSchema = z.object({ message: z.string().trim().min(1).max(10000) });
const statusSchema = z.enum(['AI_ACTIVE', 'WAITING_FOR_HUMAN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED']);
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(result.error.issues.map((issue) => issue.message).join(', '));
  return result.data;
}

async function optionalAuth(request: FastifyRequest, env: Env, db: Queryable): Promise<AuthenticatedRequestContext | null> {
  if (!request.headers.authorization) return null;
  return authenticate(request, env, db);
}

function visitorToken(request: FastifyRequest): string {
  return typeof request.headers['x-ai-conversation-token'] === 'string' ? request.headers['x-ai-conversation-token'] : '';
}

/** Every customer/visitor read is scoped by either the authenticated user or the opaque visitor
 * token. Staff use the explicit admin endpoints below, never this customer endpoint. */
async function getCustomerConversation(
  db: Queryable,
  request: FastifyRequest,
  env: Env,
  conversationId: string
): Promise<{ row: any; auth: AuthenticatedRequestContext | null }> {
  const auth = await optionalAuth(request, env, db);
  const result = await db.query<any>('SELECT * FROM ai_support_conversations WHERE id = $1', [parse(id, conversationId)]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError('Conversation not found');

  const ownsByAccount = row.user_id !== null && row.user_id === auth?.userId;
  const ownsByVisitorToken = row.access_token_hash === hash(visitorToken(request));
  if (!ownsByAccount && !ownsByVisitorToken) throw new NotFoundError('Conversation not found');
  return { row, auth };
}

async function addMessage(
  db: Queryable,
  conversationId: string,
  authorType: 'CUSTOMER' | 'AI' | 'AGENT' | 'SYSTEM',
  body: string,
  authorId: string | null = null,
  intent: string | null = null,
  confidence: number | null = null,
  sources: string[] = []
) {
  const result = await db.query<any>(
    `INSERT INTO ai_support_messages
       (id, conversation_id, author_type, author_id, body, intent, confidence, knowledge_sources)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, conversation_id, author_type, author_id, body, intent, confidence, knowledge_sources, created_at`,
    [randomUUID(), conversationId, authorType, authorId, body, intent, confidence, JSON.stringify(sources)]
  );
  await db.query(
    `UPDATE ai_support_conversations SET last_message_at = now(), updated_at = now() WHERE id = $1`,
    [conversationId]
  );
  return result.rows[0];
}

async function availability(db: Queryable): Promise<'ONLINE' | 'BUSY' | 'OFFLINE'> {
  const result = await db.query<{ available: string; online: string; busy: string }>(
    `SELECT count(*) FILTER (
              WHERE p.status = 'ONLINE' AND
                (SELECT count(*) FROM ai_support_conversations c
                  WHERE c.assigned_agent_id = p.user_id AND c.status IN ('ASSIGNED', 'IN_PROGRESS')) < p.capacity
            )::text AS available,
            count(*) FILTER (WHERE p.status = 'ONLINE')::text AS online,
            count(*) FILTER (WHERE p.status = 'BUSY')::text AS busy
       FROM support_agent_presence p
       JOIN users u ON u.id = p.user_id
      WHERE u.status = 'active' AND u.role IN ('staff', 'admin', 'super_admin')`
  );
  const available = Number(result.rows[0]?.available ?? 0);
  const online = Number(result.rows[0]?.online ?? 0);
  const busy = Number(result.rows[0]?.busy ?? 0);
  return available > 0 ? 'ONLINE' : online > 0 || busy > 0 ? 'BUSY' : 'OFFLINE';
}

async function identityForConversation(db: Queryable, row: any): Promise<{ name: string; email: string | null }> {
  if (row.user_id) {
    const result = await db.query<{ full_name: string; email: string }>(
      'SELECT full_name, email FROM users WHERE id = $1',
      [row.user_id]
    );
    const user = result.rows[0];
    if (user) return { name: user.full_name, email: user.email };
  }
  return { name: row.visitor_name ?? 'Visitor', email: row.visitor_email ?? null };
}

async function notifySupportQueue(
  db: Queryable,
  row: any,
  reason: EscalationReason,
  assignedAgentId: string | null,
  subject: string,
  notificationType?: string
): Promise<void> {
  const customer = await identityForConversation(db, row);
  const message = [
    `Customer: ${customer.name}`,
    `Email: ${customer.email ?? 'Not provided'}`,
    `Subject: ${subject}`,
    `Escalation reason: ${reason}`,
    `Conversation ID: ${row.id}`,
    'The complete transcript is available in the AI Support dashboard.',
  ].join('\n');

  if (assignedAgentId) {
    await createNotification(db, {
      userId: assignedAgentId,
      type: notificationType ?? 'AI_SUPPORT_ASSIGNED',
      title: 'New AI Support conversation assigned',
      message,
      resourceType: 'ai_support_conversation',
      resourceId: row.id,
    });
    return;
  }

  const admins = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE status = 'active' AND role IN ('staff', 'admin', 'super_admin')`
  );
  for (const admin of admins.rows) {
    await createNotification(db, {
      userId: admin.id,
      type: notificationType ?? 'AI_SUPPORT_ESCALATION',
      title: 'New AI Support escalation',
      message,
      resourceType: 'ai_support_conversation',
      resourceId: row.id,
    });
  }
}

async function escalate(
  db: Queryable,
  row: any,
  reason: EscalationReason
): Promise<{
  status: string;
  assignedAgentId: string | null;
  ticketId: string | null;
  availability: 'ONLINE' | 'BUSY' | 'OFFLINE';
  requiresContact: boolean;
  body: string;
}> {
  const supportAvailability = await availability(db);
  const available = await db.query<{ user_id: string }>(
    `SELECT p.user_id
       FROM support_agent_presence p
       JOIN users u ON u.id = p.user_id
      WHERE p.status = 'ONLINE' AND u.status = 'active'
        AND u.role IN ('staff', 'admin', 'super_admin')
        AND (
          SELECT count(*) FROM ai_support_conversations c
           WHERE c.assigned_agent_id = p.user_id AND c.status IN ('ASSIGNED', 'IN_PROGRESS')
        ) < p.capacity
      ORDER BY p.updated_at DESC, p.user_id
      LIMIT 1`
  );
  const assignedAgentId = available.rows[0]?.user_id ?? null;
  let ticketId: string | null = row.support_ticket_id;

  // The existing support_tickets table is intentionally customer-owned and requires user_id.
  // Visitor conversations remain first-class queue records in ai_support_conversations until a
  // person creates an account; authenticated escalations additionally bridge into the existing
  // ticket system without creating a duplicate ticket schema.
  if (!assignedAgentId && row.user_id && !ticketId) {
    const first = await db.query<{ body: string }>(
      `SELECT body FROM ai_support_messages
        WHERE conversation_id = $1 AND author_type = 'CUSTOMER'
        ORDER BY created_at ASC LIMIT 1`,
      [row.id]
    );
    ticketId = randomUUID();
    await createTicket(db, {
      id: ticketId,
      userId: row.user_id,
      subject: `AI support escalation: ${reason.replaceAll('_', ' ').toLowerCase()}`,
      priority: ['SECURITY_RELATED', 'COMPLAINT', 'REFUND_REQUEST'].includes(reason) ? 'high' : 'normal',
      firstMessage: {
        id: randomUUID(),
        authorId: row.user_id,
        authorRole: 'customer',
        body: first.rows[0]?.body ?? 'Please review the attached AI support conversation.',
      },
    });
  }

  const status = assignedAgentId ? 'ASSIGNED' : 'WAITING_FOR_HUMAN';
  const priority = ['SECURITY_RELATED', 'COMPLAINT', 'REFUND_REQUEST'].includes(reason) ? 'high' : 'normal';
  await db.query(
    `UPDATE ai_support_conversations
        SET status = $2, escalation_reason = $3, escalation_note = $4,
            assigned_agent_id = $5, support_ticket_id = $6, priority = $7, updated_at = now()
      WHERE id = $1`,
    [
      row.id,
      status,
      reason,
      assignedAgentId ? 'Assigned to the available CloudHost247 support queue.' : 'Waiting for the CloudHost247 support queue.',
      assignedAgentId,
      ticketId,
      priority,
    ]
  );

  const body = assignedAgentId
    ? 'I’m transferring this conversation to CloudHost247 Support now. A support representative has been assigned.'
    : 'Our support team is currently unavailable. I have preserved this conversation in the support queue so the team can follow up. Please provide your name and email if they are not already attached.';
  await addMessage(db, row.id, 'SYSTEM', body);
  await notifySupportQueue(db, { ...row, support_ticket_id: ticketId }, reason, assignedAgentId, `AI Support — ${reason.replaceAll('_', ' ').toLowerCase()}`);

  return {
    status,
    assignedAgentId,
    ticketId,
    availability: supportAvailability,
    requiresContact: !row.user_id && !row.visitor_email,
    body,
  };
}

export async function registerAiSupportRoutes(app: FastifyInstance, env: Env, override?: Queryable) {
  const db = override ?? getPool(env);

  app.post('/api/v1/ai-support/conversations', async (request, reply) => {
    const auth = await optionalAuth(request, env, db);
    const token = randomBytes(32).toString('base64url');
    const conversationId = randomUUID();
    await db.query(
      `INSERT INTO ai_support_conversations(id, user_id, access_token_hash)
       VALUES ($1, $2, $3)`,
      [conversationId, auth?.userId ?? null, hash(token)]
    );
    const opening = await addMessage(
      db,
      conversationId,
      'AI',
      'Hello! I’m the CloudHost247 AI Support assistant. I use verified CloudHost247 information. Ask a question, request a human, or subscribe to service updates.'
    );
    await auditRequest(db, request, auth?.userId ?? null, {
      action: 'AI_CONVERSATION_STARTED',
      resourceType: 'ai_support_conversation',
      resourceId: conversationId,
    });
    reply.code(201);
    return { conversationId, accessToken: token, status: 'AI_ACTIVE', message: opening };
  });

  app.get<{ Params: { id: string } }>('/api/v1/ai-support/conversations/:id', async (request) => {
    const { row } = await getCustomerConversation(db, request, env, request.params.id);
    const messages = await db.query(
      `SELECT id, author_type, body, intent, confidence, knowledge_sources, created_at
         FROM ai_support_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [row.id]
    );
    return { conversation: { ...row, access_token_hash: undefined }, messages: messages.rows };
  });

  app.post<{ Params: { id: string } }>('/api/v1/ai-support/conversations/:id/messages', async (request) => {
    const input = parse(messageSchema, request.body);
    const { row, auth } = await getCustomerConversation(db, request, env, request.params.id);

    if (row.status !== 'AI_ACTIVE') {
      if (['RESOLVED', 'CLOSED'].includes(row.status)) throw new ValidationError('This conversation is closed');
      await addMessage(db, row.id, 'CUSTOMER', input.message, auth?.userId ?? null);
      await db.query(
        `UPDATE ai_support_conversations
            SET status = CASE WHEN assigned_agent_id IS NULL THEN 'WAITING_FOR_HUMAN' ELSE 'IN_PROGRESS' END,
                updated_at = now()
          WHERE id = $1`,
        [row.id]
      );
      return { accepted: true, humanActive: true };
    }

    const previous = await db.query<{ author_type: string; body: string }>(
      `SELECT author_type, body FROM ai_support_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 8`,
      [row.id]
    );
    await addMessage(db, row.id, 'CUSTOMER', input.message, auth?.userId ?? null);
    const decision = await decideSupportResponse(db, input.message, { previousMessages: previous.rows });

    await auditRequest(db, request, auth?.userId ?? null, {
      action: decision.kind === 'ESCALATE' ? 'AI_ESCALATION_TRIGGERED' : decision.kind === 'NEWSLETTER' ? 'NEWSLETTER_SUBSCRIPTION_REQUESTED' : 'AI_RESPONSE_GENERATED',
      resourceType: 'ai_support_conversation',
      resourceId: row.id,
      metadata: { intent: decision.intent, confidence: decision.confidence, reason: decision.reason ?? null },
    });
    if (decision.reason === 'USER_REQUESTED_HUMAN') {
      await auditRequest(db, request, auth?.userId ?? null, {
        action: 'HUMAN_TRANSFER_REQUESTED',
        resourceType: 'ai_support_conversation',
        resourceId: row.id,
      });
    }

    if (decision.kind === 'ESCALATE') {
      const transfer = await escalate(db, row, decision.reason ?? 'OTHER');
      await auditRequest(db, request, auth?.userId ?? null, {
        action: transfer.assignedAgentId ? 'HUMAN_TRANSFER_COMPLETED' : 'SUPPORT_TICKET_CREATED',
        resourceType: 'ai_support_conversation',
        resourceId: row.id,
        metadata: {
          reason: decision.reason ?? 'OTHER',
          assignedAgentId: transfer.assignedAgentId,
          supportTicketId: transfer.ticketId,
          availability: transfer.availability,
        },
      });
      if (transfer.assignedAgentId) {
        await auditRequest(db, request, auth?.userId ?? null, {
          action: 'HUMAN_AGENT_ASSIGNED',
          resourceType: 'ai_support_conversation',
          resourceId: row.id,
          metadata: { assignedAgentId: transfer.assignedAgentId },
        });
      }
      return { decision, transfer };
    }

    // Newsletter is an AI answer plus a distinct, explicit form. Persisting it as an AI message
    // fixes the important visitor experience where the form appeared with no explanatory reply.
    const response = await addMessage(db, row.id, 'AI', decision.body, null, decision.intent, decision.confidence, decision.sources);
    return { decision, response };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/ai-support/conversations/:id/contact', async (request) => {
    const input = parse(z.object({ name: z.string().trim().min(2).max(160), email }), request.body);
    const { row, auth } = await getCustomerConversation(db, request, env, request.params.id);
    if (row.user_id && row.user_id !== auth?.userId) throw new NotFoundError('Conversation not found');
    await db.query(
      `UPDATE ai_support_conversations
          SET visitor_name = $2, visitor_email = $3, updated_at = now()
        WHERE id = $1`,
      [row.id, input.name, input.email.toLowerCase()]
    );
    if (row.status !== 'AI_ACTIVE') {
      await notifySupportQueue(
        db,
        { ...row, visitor_name: input.name, visitor_email: input.email.toLowerCase() },
        row.escalation_reason ?? 'OTHER',
        row.assigned_agent_id,
        'AI support contact details captured',
        'AI_SUPPORT_CONTACT_CAPTURED'
      );
    }
    await auditRequest(db, request, auth?.userId ?? null, {
      action: 'SUPPORT_CONTACT_DETAILS_CAPTURED',
      resourceType: 'ai_support_conversation',
      resourceId: row.id,
    });
    return { saved: true };
  });

  app.post<{ Params: { id: string } }>('/api/v1/ai-support/conversations/:id/newsletter', async (request) => {
    const input = parse(z.object({ name: z.string().trim().min(2).max(160), email }), request.body);
    const { row, auth } = await getCustomerConversation(db, request, env, request.params.id);
    const inserted = await db.query<{ id: string; status: string }>(
      `INSERT INTO newsletter_subscriptions(id, name, email, status, source)
       VALUES ($1, $2, $3, 'ACTIVE', 'ai_assistant')
       ON CONFLICT (lower(email)) DO NOTHING
       RETURNING id, status`,
      [randomUUID(), input.name, input.email.toLowerCase()]
    );
    const subscription = inserted.rows[0] ?? (await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM newsletter_subscriptions WHERE lower(email) = lower($1)`,
      [input.email]
    )).rows[0];
    if (!subscription) throw new ValidationError('Could not save the newsletter subscription');
    await auditRequest(db, request, auth?.userId ?? null, {
      action: 'NEWSLETTER_SUBSCRIPTION_COMPLETED',
      resourceType: 'newsletter_subscription',
      resourceId: subscription.id,
      metadata: { source: 'ai_assistant', alreadySubscribed: inserted.rows.length === 0 },
    });
    return { subscribed: true, alreadySubscribed: inserted.rows.length === 0, status: subscription.status };
  });

  app.get('/api/v1/ai-support/availability', async () => ({ status: await availability(db) }));

  // --- Human support/admin surface -----------------------------------------------------------

  app.get('/api/v1/admin/ai-support/agents', async (request) => {
    await requireRole(request, env, db, ['staff', 'admin', 'super_admin']);
    const agents = await db.query(
      `SELECT u.id, u.full_name, u.email, u.role, COALESCE(p.status, 'OFFLINE') AS presence_status,
              COALESCE(p.capacity, 3) AS capacity
         FROM users u LEFT JOIN support_agent_presence p ON p.user_id = u.id
        WHERE u.status = 'active' AND u.role IN ('staff', 'admin', 'super_admin')
        ORDER BY u.full_name ASC`
    );
    return { agents: agents.rows };
  });

  app.get('/api/v1/admin/ai-support/knowledge', async (request) => {
    await requireRole(request, env, db, ['staff', 'admin', 'super_admin']);
    return { knowledge: listSupportKnowledge() };
  });

  app.get('/api/v1/admin/ai-support/conversations', async (request) => {
    await requireRole(request, env, db, ['staff', 'admin', 'super_admin']);
    const query = parse(z.object({ status: statusSchema.optional(), search: z.string().trim().max(160).optional() }), request.query ?? {});
    const params: unknown[] = [];
    const where: string[] = ['1 = 1'];
    if (query.status) {
      params.push(query.status);
      where.push(`c.status = $${params.length}`);
    }
    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(`(c.visitor_name ILIKE $${params.length} OR c.visitor_email ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.full_name ILIKE $${params.length} OR c.id::text ILIKE $${params.length})`);
    }
    const rows = await db.query(
      `SELECT c.id, c.user_id, c.visitor_name, c.visitor_email, c.status, c.escalation_reason,
              c.escalation_note, c.priority, c.assigned_agent_id, c.support_ticket_id, c.source,
              c.created_at, c.updated_at, c.last_message_at,
              u.full_name AS customer_account_name, u.email AS customer_account_email,
              a.full_name AS assigned_agent_name, a.email AS assigned_agent_email
         FROM ai_support_conversations c
         LEFT JOIN users u ON u.id = c.user_id
         LEFT JOIN users a ON a.id = c.assigned_agent_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.updated_at DESC LIMIT 200`,
      params
    );
    return { conversations: rows.rows };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/ai-support/conversations/:id', async (request) => {
    await requireRole(request, env, db, ['staff', 'admin', 'super_admin']);
    const conversationId = parse(id, request.params.id);
    const result = await db.query<any>(
      `SELECT c.*, u.full_name AS customer_account_name, u.email AS customer_account_email,
              a.full_name AS assigned_agent_name, a.email AS assigned_agent_email
         FROM ai_support_conversations c
         LEFT JOIN users u ON u.id = c.user_id
         LEFT JOIN users a ON a.id = c.assigned_agent_id
        WHERE c.id = $1`,
      [conversationId]
    );
    if (!result.rows[0]) throw new NotFoundError('Conversation not found');
    const messages = await db.query(
      `SELECT * FROM ai_support_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId]
    );
    return { conversation: result.rows[0], messages: messages.rows };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/ai-support/conversations/:id/reply', async (request) => {
    const auth = await requireRole(request, env, db, ['staff', 'admin', 'super_admin']);
    const input = parse(messageSchema, request.body);
    const conversationId = parse(id, request.params.id);
    const found = await db.query<any>(
      `UPDATE ai_support_conversations
          SET assigned_agent_id = COALESCE(assigned_agent_id, $2), status = 'IN_PROGRESS', updated_at = now()
        WHERE id = $1 AND status NOT IN ('CLOSED', 'RESOLVED') RETURNING *`,
      [conversationId, auth.userId]
    );
    const row = found.rows[0];
    if (!row) throw new NotFoundError('Conversation not found or already closed');
    const reply = await addMessage(db, conversationId, 'AGENT', input.message, auth.userId);
    if (row.user_id) {
      await createNotification(db, {
        userId: row.user_id,
        type: 'AI_SUPPORT_AGENT_REPLY',
        title: 'CloudHost247 Support replied to your conversation',
        message: 'A support representative replied to your CloudHost247 Support conversation. Open the support widget to continue.',
        resourceType: 'ai_support_conversation',
        resourceId: conversationId,
      });
    }
    await auditRequest(db, request, auth.userId, {
      action: 'HUMAN_AGENT_REPLIED',
      resourceType: 'ai_support_conversation',
      resourceId: conversationId,
    });
    return { message: reply };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/admin/ai-support/conversations/:id', async (request) => {
    const auth = await requireRole(request, env, db, ['staff', 'admin', 'super_admin']);
    const input = parse(
      z.object({
        status: statusSchema.optional(),
        assignedAgentId: z.string().uuid().nullable().optional(),
        priority: z.enum(['low', 'normal', 'high']).optional(),
      }).refine((value) => value.status !== undefined || value.assignedAgentId !== undefined || value.priority !== undefined, {
        message: 'At least one conversation field must be provided',
      }),
      request.body
    );
    const conversationId = parse(id, request.params.id);

    if (input.assignedAgentId) {
      const agent = await db.query<{ id: string }>(
        `SELECT id FROM users WHERE id = $1 AND status = 'active' AND role IN ('staff', 'admin', 'super_admin')`,
        [input.assignedAgentId]
      );
      if (!agent.rows[0]) throw new ValidationError('Assigned user is not an active support agent');
    }

    const result = await db.query<any>(
      `UPDATE ai_support_conversations
          SET status = COALESCE($2, status),
              assigned_agent_id = CASE WHEN $3::boolean THEN $4 ELSE assigned_agent_id END,
              priority = COALESCE($5, priority),
              resolved_at = CASE
                WHEN $2 IN ('RESOLVED', 'CLOSED') THEN now()
                WHEN $2 IS NOT NULL THEN NULL
                ELSE resolved_at
              END,
              updated_at = now()
        WHERE id = $1 RETURNING *`,
      [conversationId, input.status ?? null, input.assignedAgentId !== undefined, input.assignedAgentId ?? null, input.priority ?? null]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('Conversation not found');

    if (input.status === 'AI_ACTIVE') {
      await addMessage(db, conversationId, 'SYSTEM', 'CloudHost247 Support returned this conversation to the AI assistant.');
    }
    if (input.status === 'RESOLVED' || input.status === 'CLOSED') {
      await addMessage(db, conversationId, 'SYSTEM', `This conversation was marked ${input.status.toLowerCase()} by CloudHost247 Support.`);
    }
    if (input.assignedAgentId) {
      await notifySupportQueue(db, row, row.escalation_reason ?? 'OTHER', input.assignedAgentId, 'AI Support reassigned conversation');
    }

    await auditRequest(db, request, auth.userId, {
      action: input.status === 'AI_ACTIVE' ? 'AI_HANDOFF_RETURNED' : input.status === 'RESOLVED' ? 'CONVERSATION_RESOLVED' : 'AI_CONVERSATION_UPDATED',
      resourceType: 'ai_support_conversation',
      resourceId: conversationId,
      metadata: input,
    });
    return { conversation: row };
  });

  app.put('/api/v1/admin/ai-support/presence', async (request) => {
    const auth = await requireRole(request, env, db, ['staff', 'admin', 'super_admin']);
    const input = parse(z.object({ status: z.enum(['ONLINE', 'BUSY', 'OFFLINE']), capacity: z.number().int().min(1).max(20).optional() }), request.body);
    await db.query(
      `INSERT INTO support_agent_presence(user_id, status, capacity)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET status = excluded.status, capacity = excluded.capacity, updated_at = now()`,
      [auth.userId, input.status, input.capacity ?? 3]
    );
    await auditRequest(db, request, auth.userId, {
      action: 'SUPPORT_AGENT_PRESENCE_UPDATED',
      resourceType: 'support_agent_presence',
      resourceId: auth.userId,
      metadata: { status: input.status, capacity: input.capacity ?? 3 },
    });
    return { status: input.status, capacity: input.capacity ?? 3 };
  });

  app.get('/api/v1/admin/ai-support/overview', async (request) => {
    await requireRole(request, env, db, ['staff', 'admin', 'super_admin']);
    const counts = await db.query<{ status: string; count: string }>(
      `SELECT status, count(*)::text AS count FROM ai_support_conversations GROUP BY status`
    );
    const newsletter = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM newsletter_subscriptions WHERE status = 'ACTIVE'`);
    const humans = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_support_conversations WHERE status IN ('ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED')`);
    const handledByAi = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_support_conversations WHERE status = 'AI_ACTIVE'`);
    const byReason = await db.query<{ escalation_reason: string; count: string }>(
      `SELECT escalation_reason, count(*)::text AS count FROM ai_support_conversations WHERE escalation_reason IS NOT NULL GROUP BY escalation_reason ORDER BY count(*) DESC`
    );
    return {
      counts: Object.fromEntries(counts.rows.map((row) => [row.status, Number(row.count)])),
      newsletterSubscriptions: Number(newsletter.rows[0]?.count ?? 0),
      aiHandledConversations: Number(handledByAi.rows[0]?.count ?? 0),
      humanHandledConversations: Number(humans.rows[0]?.count ?? 0),
      humanEscalations: counts.rows.filter((row) => row.status !== 'AI_ACTIVE').reduce((sum, row) => sum + Number(row.count), 0),
      byReason: Object.fromEntries(byReason.rows.map((row) => [row.escalation_reason, Number(row.count)])),
    };
  });

  app.get('/api/v1/admin/newsletter-subscriptions', async (request) => {
    await requireRole(request, env, db, ['admin', 'super_admin']);
    const rows = await db.query(
      `SELECT id, name, email, status, source, created_at, updated_at
         FROM newsletter_subscriptions ORDER BY created_at DESC LIMIT 500`
    );
    return { subscriptions: rows.rows };
  });
}
