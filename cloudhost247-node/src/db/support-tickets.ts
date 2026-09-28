import type { Queryable } from './types';

export interface SupportTicketRow {
  id: string;
  user_id: string;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface SupportTicketMessageRow {
  id: string;
  ticket_id: string;
  author_id: string;
  author_role: string;
  body: string;
  created_at: string;
}

export type TicketStatus = 'open' | 'pending_customer' | 'pending_staff' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high';

export async function listTicketsForUser(pool: Queryable, userId: string): Promise<SupportTicketRow[]> {
  const { rows } = await pool.query<SupportTicketRow>(
    'SELECT * FROM support_tickets WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId]
  );
  return rows;
}

export interface ListTicketsFilter {
  status?: TicketStatus;
  limit: number;
  offset: number;
}

export interface ListTicketsResult {
  tickets: SupportTicketRow[];
  total: number;
}

/** Admin/super_admin ticket queue (src/routes/admin-customers.ts) — every ticket, any customer. */
export async function listAllTickets(pool: Queryable, filter: ListTicketsFilter): Promise<ListTicketsResult> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const countResult = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM support_tickets ${where}`, params);
  const total = Number(countResult.rows[0]?.count ?? '0');

  const listParams = [...params, filter.limit, filter.offset];
  const { rows } = await pool.query<SupportTicketRow>(
    `SELECT * FROM support_tickets ${where} ORDER BY updated_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  return { tickets: rows, total };
}

export async function findTicketById(pool: Queryable, id: string): Promise<SupportTicketRow | null> {
  const { rows } = await pool.query<SupportTicketRow>('SELECT * FROM support_tickets WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ?? null;
}

export async function listMessagesForTicket(pool: Queryable, ticketId: string): Promise<SupportTicketMessageRow[]> {
  const { rows } = await pool.query<SupportTicketMessageRow>(
    'SELECT * FROM support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC',
    [ticketId]
  );
  return rows;
}

export interface CreateTicketInput {
  id: string;
  userId: string;
  subject: string;
  priority?: TicketPriority;
  /** The id/role of the opening message, inserted atomically with the ticket itself. */
  firstMessage: { id: string; authorId: string; authorRole: string; body: string };
}

export async function createTicket(pool: Queryable, input: CreateTicketInput): Promise<SupportTicketRow> {
  const { rows } = await pool.query<SupportTicketRow>(
    `INSERT INTO support_tickets (id, user_id, subject, priority)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.id, input.userId, input.subject, input.priority ?? 'normal']
  );
  const ticket = rows[0];
  if (!ticket) throw new Error('Failed to create support ticket');

  await pool.query(
    `INSERT INTO support_ticket_messages (id, ticket_id, author_id, author_role, body)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.firstMessage.id, ticket.id, input.firstMessage.authorId, input.firstMessage.authorRole, input.firstMessage.body]
  );

  return ticket;
}

export interface AppendMessageInput {
  id: string;
  ticketId: string;
  authorId: string;
  authorRole: string;
  body: string;
}

/**
 * Appends a reply and updates the parent ticket's status/timestamps in the same call, so callers
 * (src/routes/account.ts, src/routes/admin-customers.ts) never have to remember to do both.
 *
 * Business rule: a customer reply always moves the ticket to 'pending_staff' (awaiting a staff
 * response); a staff reply always moves it to 'pending_customer'. Replying to a 'closed' ticket
 * reopens it (clears closed_at) rather than silently accepting a message into a dead thread —
 * this applies to a customer reopening their own resolved ticket and to staff following up on one
 * they'd already closed.
 */
export async function appendTicketMessage(pool: Queryable, input: AppendMessageInput): Promise<SupportTicketMessageRow> {
  const { rows } = await pool.query<SupportTicketMessageRow>(
    `INSERT INTO support_ticket_messages (id, ticket_id, author_id, author_role, body)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.id, input.ticketId, input.authorId, input.authorRole, input.body]
  );
  const message = rows[0];
  if (!message) throw new Error('Failed to append ticket message');

  const nextStatus: TicketStatus = input.authorRole === 'customer' ? 'pending_staff' : 'pending_customer';
  await pool.query(
    `UPDATE support_tickets SET status = $1, updated_at = now(), closed_at = NULL WHERE id = $2`,
    [nextStatus, input.ticketId]
  );

  return message;
}

export async function updateTicketStatus(pool: Queryable, id: string, status: TicketStatus): Promise<SupportTicketRow | null> {
  const closedAt = status === 'closed' ? new Date().toISOString() : null;
  const { rows } = await pool.query<SupportTicketRow>(
    `UPDATE support_tickets SET status = $1, updated_at = now(), closed_at = $2 WHERE id = $3 RETURNING *`,
    [status, closedAt, id]
  );
  return rows[0] ?? null;
}
