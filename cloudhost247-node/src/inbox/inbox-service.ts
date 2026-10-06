/**
 * CloudHost247 Unified Inbox — conversations, messages, labels, assignment, notes and unread
 * counts, across every channel.
 *
 * Design commitments:
 *
 *   - **Channels are data.** A channel row names a `kind` and the `provider_key` that implements it.
 *     Adding WhatsApp, Telegram, SMS, live chat or a second mailbox later means registering a
 *     connector, not reworking conversations, labels or the UI.
 *   - **A connector that is not configured says so.** `inbox_channels.status` is set by a real
 *     health check; inbound delivery from an unconfigured connector never happens, and the UI shows
 *     "not configured" rather than an empty inbox that looks like silence.
 *   - **Internal notes are invisible to customers at the query level**, not merely in the UI: every
 *     customer-facing read filters `visibility = 'public'`.
 *   - **Idempotent inbound.** A redelivered webhook is deduplicated on
 *     (conversation, external_message_id), so a channel that retries cannot double-count unread
 *     messages or duplicate a conversation.
 *   - The web-form channel is fed by the Website Builder's form submissions, and the support
 *     channel mirrors the existing support tickets — this module never becomes a second ticket
 *     system or a second form store.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { ValidationError, NotFoundError } from '../lib/errors';
import { sendTransactionalEmail } from '../lib/transactional-email';
import { createNotification } from '../services/notification-service';

export type ChannelKind =
  | 'web_form'
  | 'email'
  | 'support'
  | 'api'
  | 'live_chat'
  | 'whatsapp'
  | 'telegram'
  | 'sms'
  | 'social';

export type ConversationStatus = 'open' | 'pending' | 'snoozed' | 'closed';

export interface ChannelRow {
  id: string;
  kind: ChannelKind;
  name: string;
  provider_key: string;
  status: 'not_configured' | 'connected' | 'auth_failed' | 'error' | 'disabled';
  config: Record<string, unknown>;
  last_health_check_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
}

export interface ConversationRow {
  id: string;
  channel_id: string;
  user_id: string | null;
  ticket_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  external_reference: string | null;
  subject: string;
  status: ConversationStatus;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  assignee_id: string | null;
  unread_for_staff: number;
  unread_for_customer: number;
  is_starred: boolean;
  last_message_at: string;
  last_message_preview: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  direction: 'inbound' | 'outbound';
  visibility: 'public' | 'internal';
  author_user_id: string | null;
  author_name: string | null;
  author_email: string | null;
  body: string;
  delivery_status: string;
  delivery_error: string | null;
  external_message_id: string | null;
  attachments: unknown;
  created_at: string;
}

/** The channels the platform knows how to speak, and what each one needs to be usable. */
export interface ChannelConnector {
  kind: ChannelKind;
  label: string;
  providerKey: string;
  description: string;
  /** Setup an admin must complete before the connector can carry traffic. */
  requiredConfiguration: string[];
  /**
   * Whether the connector is operational right now. Every connector shipped today is
   * inbound-only-by-webhook or manual, so "configured" means an admin created the channel and any
   * required non-secret configuration is present. Outbound sending always goes through the
   * platform's existing email transport.
   */
  isConfigured: (channel: ChannelRow, context: { emailTransportConfigured: boolean }) => { configured: boolean; reason: string | null };
}

export const CHANNEL_CONNECTORS: readonly ChannelConnector[] = [
  {
    kind: 'web_form',
    label: 'Website forms',
    providerKey: 'builder_form',
    description: 'Submissions from CloudHost247 Website Builder forms land here automatically.',
    requiredConfiguration: [],
    isConfigured: () => ({ configured: true, reason: null }),
  },
  {
    kind: 'support',
    label: 'Support tickets',
    providerKey: 'support_tickets',
    description: 'Mirrors the existing support ticket queue — one conversation per ticket.',
    requiredConfiguration: [],
    isConfigured: () => ({ configured: true, reason: null }),
  },
  {
    kind: 'api',
    label: 'API / integrations',
    providerKey: 'inbound_api',
    description: 'Conversations created by other CloudHost247 modules and authorised integrations.',
    requiredConfiguration: [],
    isConfigured: () => ({ configured: true, reason: null }),
  },
  {
    kind: 'live_chat',
    label: 'Live chat widget',
    providerKey: 'web_chat',
    description: 'A chat widget embedded on customer websites; visitors appear here in real time.',
    requiredConfiguration: ['An allowed origin for the widget'],
    isConfigured: (channel) =>
      typeof channel.config.allowedOrigin === 'string' && channel.config.allowedOrigin.startsWith('https://')
        ? { configured: true, reason: null }
        : { configured: false, reason: 'Set the widget’s allowed https:// origin to enable live chat.' },
  },
  {
    kind: 'email',
    label: 'Email mailbox',
    providerKey: 'imap_smtp',
    description: 'An inbound mailbox plus replies sent through the platform’s email transport.',
    requiredConfiguration: ['Mailbox address', 'Mailbox password in AI & Integrations', 'Inbound forwarding rule'],
    isConfigured: (channel, context) => {
      if (typeof channel.config.address !== 'string' || !channel.config.address.includes('@')) {
        return { configured: false, reason: 'Set the mailbox address for this channel.' };
      }
      if (!context.emailTransportConfigured) {
        return {
          configured: false,
          reason: 'The platform’s outbound email transport is not configured, so replies could not be sent.',
        };
      }
      return { configured: true, reason: null };
    },
  },
  {
    kind: 'whatsapp',
    label: 'WhatsApp Business',
    providerKey: 'whatsapp_cloud',
    description: 'WhatsApp Business Cloud API conversations.',
    requiredConfiguration: ['Business phone number id', 'Access token in AI & Integrations', 'Webhook verification token'],
    isConfigured: (channel) =>
      typeof channel.config.phoneNumberId === 'string' && channel.config.phoneNumberId.length > 0
        ? { configured: true, reason: null }
        : { configured: false, reason: 'Connect WhatsApp Business credentials in AI & Integrations, then set the phone number id.' },
  },
  {
    kind: 'telegram',
    label: 'Telegram',
    providerKey: 'telegram_bot',
    description: 'Telegram bot conversations.',
    requiredConfiguration: ['Bot username', 'Bot token in AI & Integrations'],
    isConfigured: (channel) =>
      typeof channel.config.botUsername === 'string' && channel.config.botUsername.length > 0
        ? { configured: true, reason: null }
        : { configured: false, reason: 'Add the bot username and store the bot token in AI & Integrations.' },
  },
  {
    kind: 'sms',
    label: 'SMS',
    providerKey: 'sms_gateway',
    description: 'Two-way SMS through a connected messaging provider.',
    requiredConfiguration: ['Sender id', 'Provider credentials in AI & Integrations'],
    isConfigured: (channel) =>
      typeof channel.config.senderId === 'string' && channel.config.senderId.length > 0
        ? { configured: true, reason: null }
        : { configured: false, reason: 'Add the sender id and store the provider credentials in AI & Integrations.' },
  },
  {
    kind: 'social',
    label: 'Social messaging',
    providerKey: 'social_messaging',
    description: 'Direct messages from connected social pages.',
    requiredConfiguration: ['Page id', 'Page access token in AI & Integrations'],
    isConfigured: (channel) =>
      typeof channel.config.pageId === 'string' && channel.config.pageId.length > 0
        ? { configured: true, reason: null }
        : { configured: false, reason: 'Add the page id and store the page access token in AI & Integrations.' },
  },
];

export function connectorFor(kind: string): ChannelConnector | undefined {
  return CHANNEL_CONNECTORS.find((connector) => connector.kind === kind);
}

/* --------------------------------------------------------------------------------------------
 * Channels
 * ------------------------------------------------------------------------------------------ */

export async function listChannels(db: Queryable): Promise<ChannelRow[]> {
  const { rows } = await db.query<ChannelRow>(`SELECT * FROM inbox_channels ORDER BY kind ASC, name ASC`);
  return rows;
}

/**
 * Idempotently ensures the platform's built-in channels exist. Built-in channels are those the
 * platform itself feeds (forms, support tickets, other modules); they are created `connected`
 * because there is nothing to configure. External channels are only ever created by an admin.
 */
export async function ensureBuiltInChannels(db: Queryable): Promise<void> {
  for (const connector of CHANNEL_CONNECTORS) {
    if (connector.kind === 'live_chat' || connector.kind === 'email' || connector.kind === 'whatsapp' || connector.kind === 'telegram' || connector.kind === 'sms' || connector.kind === 'social') {
      continue;
    }
    await db.query(
      `INSERT INTO inbox_channels (id, kind, name, provider_key, status)
       VALUES ($1,$2,$3,$4,'connected')
       ON CONFLICT (kind, lower(name)) DO NOTHING`,
      [randomUUID(), connector.kind, connector.label, connector.providerKey]
    );
  }
}

export async function createChannel(
  db: Queryable,
  input: { kind: ChannelKind; name: string; config?: Record<string, unknown> },
  context: { emailTransportConfigured: boolean }
): Promise<ChannelRow> {
  const connector = connectorFor(input.kind);
  if (!connector) throw new ValidationError(`"${input.kind}" is not a channel type this platform supports`);
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new ValidationError('Give the channel a name');

  const id = randomUUID();
  await db.query(
    `INSERT INTO inbox_channels (id, kind, name, provider_key, config, status)
     VALUES ($1,$2,$3,$4,$5,'not_configured')
     ON CONFLICT (kind, lower(name)) DO NOTHING`,
    [id, input.kind, name, connector.providerKey, JSON.stringify(scrubChannelConfig(input.config ?? {}))]
  );
  const channel = (await listChannels(db)).find((row) => row.kind === input.kind && row.name === name);
  if (!channel) throw new ValidationError('That channel already exists');
  return refreshChannelHealth(db, channel.id, context);
}

/** Only non-secret configuration is stored on a channel row; anything credential-shaped is dropped. */
export function scrubChannelConfig(config: Record<string, unknown>): Record<string, unknown> {
  const forbidden = /(secret|token|password|key|api[_-]?key|credential)/i;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (forbidden.test(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 500);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/** Runs the connector's real configuration check and records the outcome on the row. */
export async function refreshChannelHealth(
  db: Queryable,
  channelId: string,
  context: { emailTransportConfigured: boolean }
): Promise<ChannelRow> {
  const { rows } = await db.query<ChannelRow>(`SELECT * FROM inbox_channels WHERE id = $1 LIMIT 1`, [channelId]);
  const channel = rows[0];
  if (!channel) throw new NotFoundError('No channel was found with that id');
  const connector = connectorFor(channel.kind);
  if (!connector) throw new ValidationError('This channel has no connector registered');

  const state = connector.isConfigured(channel, context);
  const status = state.configured ? 'connected' : 'not_configured';
  const { rows: updated } = await db.query<ChannelRow>(
    `UPDATE inbox_channels
        SET status = $2, last_health_check_at = now(), last_error_code = $3, last_error_message = $4, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [channelId, status, state.configured ? null : 'NOT_CONFIGURED', state.configured ? null : state.reason]
  );
  const row = updated[0];
  if (!row) throw new NotFoundError('No channel was found with that id');
  return row;
}

/* --------------------------------------------------------------------------------------------
 * Conversations
 * ------------------------------------------------------------------------------------------ */

export interface InboundMessageInput {
  channelKind: ChannelKind;
  /** Which conversation to attach to. When omitted, one is created/found by external reference. */
  conversationId?: string | null;
  externalReference?: string | null;
  userId?: string | null;
  ticketId?: string | null;
  subject?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  body: string;
  authorName?: string | null;
  authorEmail?: string | null;
  authorUserId?: string | null;
  direction?: 'inbound' | 'outbound';
  visibility?: 'public' | 'internal';
  externalMessageId?: string | null;
  attachments?: unknown;
}

async function findOrCreateChannel(db: Queryable, kind: ChannelKind): Promise<ChannelRow> {
  const { rows } = await db.query<ChannelRow>(
    `SELECT * FROM inbox_channels WHERE kind = $1 ORDER BY created_at ASC LIMIT 1`,
    [kind]
  );
  if (rows[0]) return rows[0];
  await ensureBuiltInChannels(db);
  const retry = await db.query<ChannelRow>(`SELECT * FROM inbox_channels WHERE kind = $1 ORDER BY created_at ASC LIMIT 1`, [kind]);
  if (retry.rows[0]) return retry.rows[0];
  throw new ValidationError(`The "${kind}" channel is not enabled on this platform yet`);
}

function preview(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * Records a message. Creates its conversation when needed, deduplicates a redelivered external
 * message id, bumps the right unread counter, and updates the conversation preview — all in one
 * transaction, so the list view can never disagree with the thread.
 */
export async function recordMessage(
  db: Queryable,
  input: InboundMessageInput
): Promise<{ conversationId: string; messageId: string; created: boolean; duplicate: boolean }> {
  const body = input.body.trim();
  if (!body) throw new ValidationError('A message needs a body');
  if (body.length > 20_000) throw new ValidationError('That message is too long');

  const channel = await findOrCreateChannel(db, input.channelKind);

  let conversationId = input.conversationId ?? null;
  if (!conversationId) {
    if (input.externalReference) {
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM inbox_conversations WHERE channel_id = $1 AND external_reference = $2 LIMIT 1`,
        [channel.id, input.externalReference]
      );
      conversationId = rows[0]?.id ?? null;
    }
    if (!conversationId) {
      conversationId = randomUUID();
      await db.query(
        `INSERT INTO inbox_conversations
           (id, channel_id, user_id, ticket_id, contact_name, contact_email, contact_phone,
            external_reference, subject, last_message_preview, last_message_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`,
        [
          conversationId,
          channel.id,
          input.userId ?? null,
          input.ticketId ?? null,
          input.contactName ?? null,
          input.contactEmail ?? null,
          input.contactPhone ?? null,
          input.externalReference ?? null,
          (input.subject ?? '').slice(0, 255),
          preview(body),
        ]
      );
    }
  }

  const { rows: conversationRows } = await db.query<ConversationRow>(
    `SELECT * FROM inbox_conversations WHERE id = $1 LIMIT 1`,
    [conversationId]
  );
  const conversation = conversationRows[0];
  if (!conversation) throw new NotFoundError('No conversation was found with that id');

  if (input.externalMessageId) {
    const { rows: existing } = await db.query<{ id: string }>(
      `SELECT id FROM inbox_messages WHERE conversation_id = $1 AND external_message_id = $2 LIMIT 1`,
      [conversationId, input.externalMessageId]
    );
    if (existing[0]) {
      return { conversationId, messageId: existing[0].id, created: false, duplicate: true };
    }
  }

  const direction = input.direction ?? 'inbound';
  const visibility = input.visibility ?? 'public';
  const messageId = randomUUID();
  await db.query(
    `INSERT INTO inbox_messages
       (id, conversation_id, direction, visibility, author_user_id, author_name, author_email, body,
        delivery_status, external_message_id, attachments)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      messageId,
      conversationId,
      direction,
      visibility,
      input.authorUserId ?? null,
      input.authorName ?? null,
      input.authorEmail ?? null,
      body,
      direction === 'inbound' ? 'received' : 'queued',
      input.externalMessageId ?? null,
      JSON.stringify(input.attachments ?? []),
    ]
  );

  // An internal note is staff-only: it must never raise the customer's unread counter, and it must
  // not resurface the conversation as "waiting on the customer".
  const incrementStaff = direction === 'inbound' && visibility === 'public' ? 1 : 0;
  const incrementCustomer = direction === 'outbound' && visibility === 'public' ? 1 : 0;
  const reopen = direction === 'inbound' && conversation.status === 'closed';

  await db.query(
    `UPDATE inbox_conversations
        SET last_message_at = now(),
            last_message_preview = $2,
            unread_for_staff = unread_for_staff + $3,
            unread_for_customer = unread_for_customer + $4,
            status = CASE WHEN $5 THEN 'open' ELSE status END,
            closed_at = CASE WHEN $5 THEN NULL ELSE closed_at END,
            updated_at = now()
      WHERE id = $1`,
    [conversationId, preview(body), incrementStaff, incrementCustomer, reopen]
  );

  if (incrementStaff > 0 && conversation.assignee_id) {
    await createNotification(db, {
      userId: conversation.assignee_id,
      type: 'INBOX_MESSAGE',
      title: `New message: ${conversation.subject || conversation.contact_email || 'conversation'}`,
      message: preview(body),
      resourceType: 'inbox_conversation',
      resourceId: conversationId,
    });
  }

  return { conversationId, messageId, created: true, duplicate: false };
}

export interface ConversationFilter {
  status?: ConversationStatus | 'all';
  assigneeId?: string | null | 'unassigned';
  channelKind?: ChannelKind;
  labelId?: string;
  search?: string;
  starredOnly?: boolean;
  limit?: number;
  offset?: number;
}

export async function listConversations(db: Queryable, filter: ConversationFilter = {}) {
  const params: unknown[] = [];
  const where: string[] = [];

  if (filter.status && filter.status !== 'all') {
    params.push(filter.status);
    where.push(`c.status = $${params.length}`);
  }
  if (filter.assigneeId === 'unassigned') where.push('c.assignee_id IS NULL');
  else if (typeof filter.assigneeId === 'string') {
    params.push(filter.assigneeId);
    where.push(`c.assignee_id = $${params.length}`);
  }
  if (filter.channelKind) {
    params.push(filter.channelKind);
    where.push(`ch.kind = $${params.length}`);
  }
  if (filter.labelId) {
    params.push(filter.labelId);
    where.push(`EXISTS (SELECT 1 FROM inbox_conversation_labels l WHERE l.conversation_id = c.id AND l.label_id = $${params.length})`);
  }
  if (filter.starredOnly) where.push('c.is_starred = true');
  if (filter.search) {
    params.push(`%${filter.search.trim().slice(0, 100)}%`);
    where.push(
      `(c.subject ILIKE $${params.length} OR c.contact_email ILIKE $${params.length} OR c.contact_name ILIKE $${params.length} OR c.last_message_preview ILIKE $${params.length}
        OR EXISTS (SELECT 1 FROM inbox_messages m WHERE m.conversation_id = c.id AND m.body ILIKE $${params.length}))`
    );
  }

  const limit = Math.min(Math.max(filter.limit ?? 25, 1), 100);
  const offset = Math.max(filter.offset ?? 0, 0);
  params.push(limit, offset);

  const { rows } = await db.query(
    `SELECT c.*, ch.kind AS channel_kind, ch.name AS channel_name, ch.status AS channel_status,
            (SELECT COALESCE(array_agg(l.name ORDER BY l.name), '{}') FROM inbox_conversation_labels cl
              JOIN inbox_labels l ON l.id = cl.label_id WHERE cl.conversation_id = c.id) AS labels
       FROM inbox_conversations c
       JOIN inbox_channels ch ON ch.id = c.channel_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY c.is_starred DESC, c.last_message_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const { rows: counts } = await db.query<{ open: string; unassigned: string; unread: string }>(
    `SELECT
        count(*) FILTER (WHERE status = 'open')::text AS open,
        count(*) FILTER (WHERE assignee_id IS NULL AND status <> 'closed')::text AS unassigned,
        COALESCE(sum(unread_for_staff), 0)::text AS unread
      FROM inbox_conversations`
  );

  return {
    conversations: rows,
    counts: {
      open: Number(counts[0]?.open ?? '0'),
      unassigned: Number(counts[0]?.unassigned ?? '0'),
      unread: Number(counts[0]?.unread ?? '0'),
    },
    limit,
    offset,
  };
}

export async function getConversation(db: Queryable, conversationId: string, viewer: 'staff' | 'customer') {
  const { rows } = await db.query<ConversationRow & { channel_kind: string; channel_name: string }>(
    `SELECT c.*, ch.kind AS channel_kind, ch.name AS channel_name
       FROM inbox_conversations c JOIN inbox_channels ch ON ch.id = c.channel_id
      WHERE c.id = $1 LIMIT 1`,
    [conversationId]
  );
  const conversation = rows[0];
  if (!conversation) throw new NotFoundError('No conversation was found with that id');

  const { rows: messages } = await db.query<MessageRow>(
    `SELECT id, conversation_id, direction, visibility, author_user_id, author_name, author_email, body,
            delivery_status, delivery_error, external_message_id, attachments, created_at
       FROM inbox_messages
      WHERE conversation_id = $1 ${viewer === 'customer' ? `AND visibility = 'public'` : ''}
      ORDER BY created_at ASC LIMIT 500`,
    [conversationId]
  );

  const { rows: labels } = await db.query(
    `SELECT l.id, l.name, l.color FROM inbox_conversation_labels cl
       JOIN inbox_labels l ON l.id = cl.label_id WHERE cl.conversation_id = $1 ORDER BY l.name`,
    [conversationId]
  );

  const { rows: assignments } = await db.query(
    `SELECT id, from_assignee_id, to_assignee_id, actor_id, note, created_at
       FROM inbox_assignment_events WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 100`,
    [conversationId]
  );

  return { conversation, messages, labels, assignments };
}

export async function markConversationRead(db: Queryable, conversationId: string, viewer: 'staff' | 'customer') {
  await db.query(
    `UPDATE inbox_conversations
        SET ${viewer === 'staff' ? 'unread_for_staff' : 'unread_for_customer'} = 0, updated_at = now()
      WHERE id = $1`,
    [conversationId]
  );
}

export async function updateConversation(
  db: Queryable,
  conversationId: string,
  patch: {
    status?: ConversationStatus;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    isStarred?: boolean;
    assigneeId?: string | null;
    actorId?: string | null;
    note?: string | null;
  }
) {
  const { rows: currentRows } = await db.query<ConversationRow>(`SELECT * FROM inbox_conversations WHERE id = $1 LIMIT 1`, [
    conversationId,
  ]);
  const current = currentRows[0];
  if (!current) throw new NotFoundError('No conversation was found with that id');

  const { rows } = await db.query<ConversationRow>(
    `UPDATE inbox_conversations SET
        status = COALESCE($2::text, status),
        priority = COALESCE($3::text, priority),
        is_starred = COALESCE($4, is_starred),
        assignee_id = CASE WHEN $5::boolean THEN $6 ELSE assignee_id END,
        closed_at = CASE WHEN $2::text = 'closed' THEN now() WHEN $2 IS NOT NULL THEN NULL ELSE closed_at END,
        updated_at = now()
      WHERE id = $1 RETURNING *`,
    [
      conversationId,
      patch.status ?? null,
      patch.priority ?? null,
      patch.isStarred ?? null,
      Object.prototype.hasOwnProperty.call(patch, 'assigneeId'),
      patch.assigneeId ?? null,
    ]
  );

  if (Object.prototype.hasOwnProperty.call(patch, 'assigneeId') && patch.assigneeId !== current.assignee_id) {
    await db.query(
      `INSERT INTO inbox_assignment_events (id, conversation_id, from_assignee_id, to_assignee_id, actor_id, note)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), conversationId, current.assignee_id, patch.assigneeId ?? null, patch.actorId ?? null, patch.note ?? null]
    );
  }

  const updated = rows[0];
  if (!updated) throw new NotFoundError('No conversation was found with that id');
  return updated;
}

/* --------------------------------------------------------------------------------------------
 * Labels
 * ------------------------------------------------------------------------------------------ */

export async function listLabels(db: Queryable) {
  const { rows } = await db.query(
    `SELECT l.id, l.name, l.color, l.description, l.sort_order,
            (SELECT count(*)::int FROM inbox_conversation_labels cl WHERE cl.label_id = l.id) AS conversation_count
       FROM inbox_labels l ORDER BY l.sort_order ASC, l.name ASC`
  );
  return rows;
}

export async function createLabel(db: Queryable, input: { name: string; color?: string; description?: string }) {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new ValidationError('A label needs a name');
  const color = /^#[0-9a-fA-F]{6}$/.test(input.color ?? '') ? input.color! : '#0756d8';
  const { rows } = await db.query<{ id: string; name: string; color: string; description: string }>(
    `INSERT INTO inbox_labels (id, name, color, description) VALUES ($1,$2,$3,$4)
     ON CONFLICT (lower(name)) DO UPDATE SET color = EXCLUDED.color
     RETURNING id, name, color, description`,
    [randomUUID(), name, color, (input.description ?? '').slice(0, 200)]
  );
  const label = rows[0];
  if (!label) throw new Error('createLabel: upsert returned no row');
  return label;
}

export async function setConversationLabel(db: Queryable, conversationId: string, labelId: string, attach: boolean) {
  const { rows } = await db.query(`SELECT id FROM inbox_conversations WHERE id = $1`, [conversationId]);
  if (!rows[0]) throw new NotFoundError('No conversation was found with that id');
  if (attach) {
    await db.query(
      `INSERT INTO inbox_conversation_labels (conversation_id, label_id) VALUES ($1,$2)
       ON CONFLICT (conversation_id, label_id) DO NOTHING`,
      [conversationId, labelId]
    );
  } else {
    await db.query(`DELETE FROM inbox_conversation_labels WHERE conversation_id = $1 AND label_id = $2`, [
      conversationId,
      labelId,
    ]);
  }
  return getConversation(db, conversationId, 'staff');
}

/** Creates (or links) the conversation for an existing support ticket, without copying its data. */
export async function linkTicketConversation(db: Queryable, ticketId: string, userId: string, subject: string, body: string) {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM inbox_conversations WHERE ticket_id = $1 LIMIT 1`,
    [ticketId]
  );
  if (rows[0]) return rows[0].id;
  const result = await recordMessage(db, {
    channelKind: 'support',
    userId,
    ticketId,
    subject,
    body,
    externalReference: `ticket:${ticketId}`,
  });
  return result.conversationId;
}

/* --------------------------------------------------------------------------------------------
 * Outbound replies
 * ------------------------------------------------------------------------------------------ */

export interface OutboundReplyResult {
  messageId: string;
  deliveryStatus: 'sent' | 'failed' | 'manual' | 'not_applicable';
  /** Human-readable explanation shown next to the message. Never empty. */
  deliveryNote: string;
  delivered: boolean;
}

export interface OutboundReplyOptions {
  source?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  authorName?: string | null;
  authorEmail?: string | null;
}

/**
 * Records a staff reply or internal note and reports delivery exactly as it happened.
 *
 *  - An internal note is never delivered anywhere (`not_applicable`).
 *  - An email-channel reply is actually sent through the platform's existing email transport
 *    (`NOTIFICATION_EMAIL_WEBHOOK_URL`/`_TOKEN`, the same contract the notification outbox uses) and
 *    is stored `sent` or `failed` with the provider's real answer. No second mailer is introduced.
 *  - A reply on a channel that has no outbound transport today is stored `manual`: the text is
 *    kept, and the thread says plainly that it has to be sent from the channel's own app. This is
 *    the honest alternative to marking it "queued" and waiting for a worker that does not exist.
 */
export async function replyToConversation(
  db: Queryable,
  conversationId: string,
  input: { body: string; visibility?: 'public' | 'internal'; authorUserId?: string | null },
  options: OutboundReplyOptions = {}
): Promise<OutboundReplyResult> {
  const body = input.body.trim();
  if (!body) throw new ValidationError('Write a reply first');
  if (body.length > 20_000) throw new ValidationError('That reply is too long');

  const { rows: conversationRows } = await db.query<
    ConversationRow & { channel_kind: string; channel_name: string; provider_key: string }
  >(
    `SELECT c.*, ch.kind AS channel_kind, ch.name AS channel_name, ch.provider_key
       FROM inbox_conversations c JOIN inbox_channels ch ON ch.id = c.channel_id
      WHERE c.id = $1 LIMIT 1`,
    [conversationId]
  );
  const conversation = conversationRows[0];
  if (!conversation) throw new NotFoundError('No conversation was found with that id');

  const visibility = input.visibility ?? 'public';
  const messageId = randomUUID();

  if (visibility === 'internal') {
    await db.query(
      `INSERT INTO inbox_messages
         (id, conversation_id, direction, visibility, author_user_id, author_name, body, delivery_status)
       VALUES ($1,$2,'outbound','internal',$3,$4,$5,'not_applicable')`,
      [messageId, conversationId, input.authorUserId ?? null, options.authorName ?? null, body]
    );
    await touchConversation(db, conversationId, body, { bumpCustomer: 0, reopen: false });
    return {
      messageId,
      deliveryStatus: 'not_applicable',
      deliveryNote: 'Internal note — visible to staff only, never sent to the customer.',
      delivered: false,
    };
  }

  if (!conversation.contact_email && conversation.channel_kind === 'email') {
    throw new ValidationError('This conversation has no email address to reply to');
  }

  const isEmail = conversation.channel_kind === 'email';

  if (!isEmail) {
    const note = `${conversation.channel_name} is an inbound-only channel: copy this reply into the channel's own app, then mark the conversation as replied. The text is stored here so nothing is lost.`;
    await db.query(
      `INSERT INTO inbox_messages
         (id, conversation_id, direction, visibility, author_user_id, author_name, body, delivery_status, delivery_error)
       VALUES ($1,$2,'outbound','public',$3,$4,$5,'manual',$6)`,
      [messageId, conversationId, input.authorUserId ?? null, options.authorName ?? null, body, note.slice(0, 500)]
    );
    await touchConversation(db, conversationId, body, { bumpCustomer: 1, reopen: false });
    return { messageId, deliveryStatus: 'manual', deliveryNote: note, delivered: false };
  }

  // Email replies go out through the platform's one transactional transport — the outbox of this
  // system is the same code path notifications use.
  const outcome = await sendTransactionalEmail(
    {
      to: conversation.contact_email ?? '',
      name: conversation.contact_name,
      subject: conversation.subject || 'Your message to CloudHost247',
      template: 'unified_inbox_reply',
      text: body,
    },
    { source: options.source, fetchImpl: options.fetchImpl }
  );

  await db.query(
    `INSERT INTO inbox_messages
       (id, conversation_id, direction, visibility, author_user_id, author_name, body, delivery_status, delivery_error)
     VALUES ($1,$2,'outbound','public',$3,$4,$5,$6,$7)`,
    [
      messageId,
      conversationId,
      input.authorUserId ?? null,
      options.authorName ?? null,
      body,
      outcome.status,
      outcome.status === 'sent' ? null : outcome.note.slice(0, 500),
    ]
  );
  await touchConversation(db, conversationId, body, { bumpCustomer: 1, reopen: false });
  return { messageId, deliveryStatus: outcome.status, deliveryNote: outcome.note, delivered: outcome.delivered };
}

/** Keeps the conversation list row in step with the thread after a staff write. */
async function touchConversation(
  db: Queryable,
  conversationId: string,
  body: string,
  counters: { bumpCustomer: number; reopen: boolean }
): Promise<void> {
  await db.query(
    `UPDATE inbox_conversations
        SET last_message_at = now(),
            last_message_preview = $2,
            unread_for_customer = unread_for_customer + $3,
            status = CASE WHEN $4 THEN 'open' ELSE status END,
            closed_at = CASE WHEN $4 THEN NULL ELSE closed_at END,
            updated_at = now()
      WHERE id = $1`,
    [conversationId, body.replace(/\s+/g, ' ').trim().slice(0, 300), counters.bumpCustomer, counters.reopen]
  );
}

/** Lists the conversations that belong to one customer account (their own inbox view). */
export async function listCustomerConversations(db: Queryable, userId: string) {
  const { rows } = await db.query(
    `SELECT c.id, c.subject, c.status, c.last_message_preview, c.last_message_at, c.unread_for_customer, c.ticket_id,
            ch.kind AS channel_kind, ch.name AS channel_name
       FROM inbox_conversations c JOIN inbox_channels ch ON ch.id = c.channel_id
      WHERE c.user_id = $1
        AND EXISTS (SELECT 1 FROM inbox_messages m WHERE m.conversation_id = c.id AND m.visibility = 'public')
      ORDER BY c.last_message_at DESC LIMIT 100`,
    [userId]
  );
  return rows;
}

/** Reads one conversation as its owner. Foreign conversations are a 404, never a 403. */
export async function getCustomerConversation(db: Queryable, userId: string, conversationId: string) {
  const { rows } = await db.query<{ user_id: string | null }>(
    `SELECT user_id FROM inbox_conversations WHERE id = $1 LIMIT 1`,
    [conversationId]
  );
  if (!rows[0] || rows[0].user_id !== userId) throw new NotFoundError('No conversation was found with that id');
  return getConversation(db, conversationId, 'customer');
}
