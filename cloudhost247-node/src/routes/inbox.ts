/**
 * Unified Inbox API.
 *
 * Staff surface (`/api/v1/inbox/*`, role-gated): channels, conversations, replies, notes, labels,
 * assignment and health checks. Everything a staff member can see is filterable and every mutation
 * writes an audit row.
 *
 * Customer surface (`/api/v1/inbox/my-conversations`) is ownership-scoped: a customer sees only
 * conversations attached to their own account and only `visibility = 'public'` messages — internal
 * notes are excluded in SQL, not hidden in the UI.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { requireRole } from '../lib/require-role';
import { auditRequest } from '../lib/audit';
import { ValidationError } from '../lib/errors';
import {
  CHANNEL_CONNECTORS,
  createChannel,
  createLabel,
  ensureBuiltInChannels,
  getConversation,
  getCustomerConversation,
  listChannels,
  listConversations,
  listCustomerConversations,
  listLabels,
  markConversationRead,
  recordMessage,
  refreshChannelHealth,
  replyToConversation,
  setConversationLabel,
  updateConversation,
  type ChannelKind,
  type ConversationStatus,
} from '../inbox/inbox-service';

const STAFF = ['staff', 'admin', 'super_admin'] as const;
const ADMIN = ['admin', 'super_admin'] as const;

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(', '));
  return parsed.data;
}

const CHANNEL_KINDS = CHANNEL_CONNECTORS.map((connector) => connector.kind) as [ChannelKind, ...ChannelKind[]];
const CONVERSATION_STATUSES = ['open', 'pending', 'snoozed', 'closed', 'all'] as const;

/**
 * Whether the platform's outbound email transport is configured. The inbox never guesses: this is
 * the same environment pair the notification outbox delivers through.
 */
function emailTransportConfigured(): boolean {
  return Boolean(process.env.NOTIFICATION_EMAIL_WEBHOOK_URL && process.env.NOTIFICATION_EMAIL_WEBHOOK_TOKEN);
}

export async function registerInboxRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  /* ------------------------------------------------------------------------------------------
   * Customer view of their own conversations
   * ---------------------------------------------------------------------------------------- */

  app.get('/api/v1/inbox/my-conversations', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { conversations: await listCustomerConversations(pool, auth.userId) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/inbox/my-conversations/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const data = await getCustomerConversation(pool, auth.userId, request.params.id);
    await markConversationRead(pool, request.params.id, 'customer');
    return data;
  });

  /* ------------------------------------------------------------------------------------------
   * Staff: channels
   * ---------------------------------------------------------------------------------------- */

  app.get('/api/v1/inbox/channels', async (request) => {
    await requireRole(request, env, pool, STAFF);
    await ensureBuiltInChannels(pool);
    return {
      channels: await listChannels(pool),
      // What each channel type needs before it can carry traffic — shown verbatim in the admin UI.
      connectors: CHANNEL_CONNECTORS.map((connector) => ({
        kind: connector.kind,
        label: connector.label,
        providerKey: connector.providerKey,
        description: connector.description,
        requiredConfiguration: connector.requiredConfiguration,
      })),
      emailTransportConfigured: emailTransportConfigured(),
    };
  });

  app.post('/api/v1/inbox/channels', async (request, reply) => {
    const auth = await requireRole(request, env, pool, ADMIN);
    const input = parseOrThrow(
      z.object({
        kind: z.enum(CHANNEL_KINDS),
        name: z.string().min(1).max(120),
        config: z.record(z.unknown()).optional(),
      }),
      request.body
    );
    const channel = await createChannel(pool, input, { emailTransportConfigured: emailTransportConfigured() });
    await auditRequest(pool, request, auth.userId, {
      action: 'inbox.channel_created',
      resourceType: 'inbox_channel',
      resourceId: channel.id,
      metadata: { kind: channel.kind, name: channel.name, status: channel.status },
    });
    reply.code(201);
    return { channel };
  });

  app.post<{ Params: { id: string } }>('/api/v1/inbox/channels/:id/refresh', async (request) => {
    const auth = await requireRole(request, env, pool, STAFF);
    const channel = await refreshChannelHealth(pool, request.params.id, { emailTransportConfigured: emailTransportConfigured() });
    await auditRequest(pool, request, auth.userId, {
      action: 'inbox.channel_health_checked',
      resourceType: 'inbox_channel',
      resourceId: channel.id,
      metadata: { status: channel.status },
    });
    return { channel };
  });

  /* ------------------------------------------------------------------------------------------
   * Staff: conversations
   * ---------------------------------------------------------------------------------------- */

  app.get('/api/v1/inbox/conversations', async (request) => {
    await requireRole(request, env, pool, STAFF);
    const query = request.query as Record<string, string | undefined>;
    const status = query.status as (typeof CONVERSATION_STATUSES)[number] | undefined;
    return listConversations(pool, {
      status: status ?? 'all',
      assigneeId: query.assignee === 'unassigned' ? 'unassigned' : query.assignee ?? undefined,
      channelKind: query.channel as ChannelKind | undefined,
      labelId: query.label,
      search: query.search,
      starredOnly: query.starred === 'true',
      limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
      offset: query.offset ? Number.parseInt(query.offset, 10) : undefined,
    });
  });

  app.get<{ Params: { id: string } }>('/api/v1/inbox/conversations/:id', async (request) => {
    await requireRole(request, env, pool, STAFF);
    const data = await getConversation(pool, request.params.id, 'staff');
    await markConversationRead(pool, request.params.id, 'staff');
    return data;
  });

  app.patch<{ Params: { id: string } }>('/api/v1/inbox/conversations/:id', async (request) => {
    const auth = await requireRole(request, env, pool, STAFF);
    const patch = parseOrThrow(
      z.object({
        status: z.enum(['open', 'pending', 'snoozed', 'closed']).optional(),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
        isStarred: z.boolean().optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        note: z.string().max(300).nullable().optional(),
      }),
      request.body
    );
    const conversation = await updateConversation(pool, request.params.id, { ...patch, actorId: auth.userId });
    await auditRequest(pool, request, auth.userId, {
      action: 'inbox.conversation_updated',
      resourceType: 'inbox_conversation',
      resourceId: request.params.id,
      metadata: { ...patch },
    });
    return { conversation };
  });

  app.post<{ Params: { id: string } }>('/api/v1/inbox/conversations/:id/messages', async (request, reply) => {
    const auth = await requireRole(request, env, pool, STAFF);
    const input = parseOrThrow(
      z.object({ body: z.string().min(1).max(20000), visibility: z.enum(['public', 'internal']).optional() }),
      request.body
    );
    const result = await replyToConversation(
      pool,
      request.params.id,
      { body: input.body, visibility: input.visibility ?? 'public', authorUserId: auth.userId },
      { source: process.env, authorName: 'CloudHost247 team' }
    );
    await auditRequest(pool, request, auth.userId, {
      action: 'inbox.reply_recorded',
      resourceType: 'inbox_conversation',
      resourceId: request.params.id,
      metadata: { deliveryStatus: result.deliveryStatus, visibility: input.visibility ?? 'public' },
    });
    reply.code(201);
    return result;
  });

  app.post<{ Params: { id: string } }>('/api/v1/inbox/conversations/:id/labels', async (request) => {
    const auth = await requireRole(request, env, pool, STAFF);
    const input = parseOrThrow(z.object({ labelId: z.string().uuid(), attach: z.boolean() }), request.body);
    const data = await setConversationLabel(pool, request.params.id, input.labelId, input.attach);
    await auditRequest(pool, request, auth.userId, {
      action: input.attach ? 'inbox.label_attached' : 'inbox.label_detached',
      resourceType: 'inbox_conversation',
      resourceId: request.params.id,
      metadata: { labelId: input.labelId },
    });
    return data;
  });

  app.get('/api/v1/inbox/labels', async (request) => {
    await requireRole(request, env, pool, STAFF);
    return { labels: await listLabels(pool) };
  });

  app.post('/api/v1/inbox/labels', async (request, reply) => {
    const auth = await requireRole(request, env, pool, STAFF);
    const input = parseOrThrow(
      z.object({
        name: z.string().min(1).max(60),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        description: z.string().max(200).optional(),
      }),
      request.body
    );
    const label = await createLabel(pool, input);
    await auditRequest(pool, request, auth.userId, {
      action: 'inbox.label_created',
      resourceType: 'inbox_label',
      resourceId: label?.id ?? null,
      metadata: { name: input.name },
    });
    reply.code(201);
    return { label };
  });

  /**
   * Inbound webhook for authorised integrations. The shared secret is required; a request without
   * it is rejected before anything is written.
   */
  app.post(
    '/api/v1/inbox/inbound',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const secret = env.INBOX_INBOUND_WEBHOOK_SECRET;
      const provided = request.headers['x-inbox-secret'];
      if (!secret) {
        reply.code(503);
        return {
          error: 'CONFIGURATION_REQUIRED',
          message:
            'Inbound inbox delivery is not enabled yet. An administrator must set INBOX_INBOUND_WEBHOOK_SECRET before external channels can post here.',
        };
      }
      if (typeof provided !== 'string' || provided !== secret) {
        reply.code(401);
        return { error: 'UNAUTHORIZED', message: 'The inbound secret did not match.' };
      }
      const input = parseOrThrow(
        z.object({
          channelKind: z.enum(CHANNEL_KINDS),
          /** Append to an existing conversation; omit to create/find one by external reference. */
          conversationId: z.string().uuid().nullable().optional(),
          externalReference: z.string().max(200).nullable().optional(),
          externalMessageId: z.string().max(200).nullable().optional(),
          userId: z.string().uuid().nullable().optional(),
          ticketId: z.string().uuid().nullable().optional(),
          subject: z.string().max(255).optional(),
          contactName: z.string().max(200).nullable().optional(),
          contactEmail: z.string().max(255).nullable().optional(),
          contactPhone: z.string().max(40).nullable().optional(),
          body: z.string().min(1).max(20000),
          authorName: z.string().max(200).nullable().optional(),
          authorEmail: z.string().max(255).nullable().optional(),
        }),
        request.body
      );
      const result = await recordMessage(pool, input);
      reply.code(result.duplicate ? 200 : 201);
      return result;
    }
  );
}
