import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { createUser, updateFullName, updatePasswordHash, updateUserRole, updateUserStatus, listUsers } from '../../src/db/users';
import { createProduct } from '../../src/db/catalog-products';
import { createPlan } from '../../src/db/catalog-plans';
import {
  createCustomerService,
  findServiceById,
  listServicesForUser,
  updateCustomerService,
} from '../../src/db/customer-services';
import { createCustomerDomain, listDomainsForUser, updateCustomerDomain } from '../../src/db/customer-domains';
import {
  appendTicketMessage,
  createTicket,
  findTicketById,
  listAllTickets,
  listMessagesForTicket,
  listTicketsForUser,
  updateTicketStatus,
} from '../../src/db/support-tickets';

/**
 * Exercises the real Phase 4 schema (customer_services, customer_domains, support_tickets,
 * support_ticket_messages, users.password_changed_at) and the repository functions on top of it,
 * against a real embedded Postgres engine (pglite) migrated with the actual committed migration
 * files — not mocks. Mirrors tests/integration/catalog-schema.test.ts's approach for Phase 3.
 */
describe('Phase 4 customer-app database schema and repositories', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  async function makeUser(email: string) {
    return createUser(db, { id: randomUUID(), email, passwordHash: 'hash', fullName: 'Test User' });
  }

  it('creates a customer_services record with FK links to a real catalog product/plan and resolves their slugs', async () => {
    const user = await makeUser('cust1@example.com');
    const staff = await makeUser('staff1@example.com');
    const product = await createProduct(db, { id: randomUUID(), slug: 'cpanel-hosting', name: 'cPanel Hosting', productType: 'hosting' });
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: 'starter', name: 'Starter' });

    const service = await createCustomerService(db, {
      id: randomUUID(),
      userId: user.id,
      productId: product.id,
      planId: plan.id,
      label: 'cPanel Hosting — Starter',
      createdBy: staff.id,
    });

    expect(service.status).toBe('active');
    expect(service.product_slug).toBe('cpanel-hosting');
    expect(service.plan_slug).toBe('starter');

    const listed = await listServicesForUser(db, user.id);
    expect(listed.map((s) => s.id)).toEqual([service.id]);
  });

  it('rejects an invalid customer_services status and cascades on user deletion, but SETs NULL on staff deletion', async () => {
    const user = await makeUser('cust2@example.com');
    const staff = await makeUser('staff2@example.com');

    await expect(
      db.query(
        `INSERT INTO customer_services (id, user_id, label, status, created_by) VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), user.id, 'Broken', 'not-a-real-status', staff.id]
      )
    ).rejects.toThrow();

    const service = await createCustomerService(db, { id: randomUUID(), userId: user.id, label: 'Real Service', createdBy: staff.id });

    // Deleting the staff account who entered the record must not delete the customer's record —
    // only null out the attribution.
    await db.query('DELETE FROM users WHERE id = $1', [staff.id]);
    const afterStaffDelete = await findServiceById(db, service.id);
    expect(afterStaffDelete).not.toBeNull();
    expect(afterStaffDelete?.created_by).toBeNull();

    // Deleting the customer account *does* cascade-delete their service records (no orphaned PII).
    await db.query('DELETE FROM users WHERE id = $1', [user.id]);
    const afterUserDelete = await findServiceById(db, service.id);
    expect(afterUserDelete).toBeNull();
  });

  it('updateCustomerService only changes provided fields, preserves notes/created_by (staff-only)', async () => {
    const user = await makeUser('cust3@example.com');
    const staff = await makeUser('staff3@example.com');
    const service = await createCustomerService(db, {
      id: randomUUID(),
      userId: user.id,
      label: 'Original label',
      notes: 'internal cost note',
      createdBy: staff.id,
    });

    const updated = await updateCustomerService(db, service.id, { status: 'suspended' });
    expect(updated?.status).toBe('suspended');
    expect(updated?.label).toBe('Original label');
    expect(updated?.notes).toBe('internal cost note');
  });

  it('creates and updates a customer_domains record without any registrar/live-availability behavior', async () => {
    const user = await makeUser('cust4@example.com');
    const staff = await makeUser('staff4@example.com');

    const domain = await createCustomerDomain(db, {
      id: randomUUID(),
      userId: user.id,
      domainName: 'example.com',
      registrar: 'Legacy WHMCS import',
      createdBy: staff.id,
    });
    expect(domain.status).toBe('active');

    const listed = await listDomainsForUser(db, user.id);
    expect(listed.map((d) => d.id)).toEqual([domain.id]);

    const updated = await updateCustomerDomain(db, domain.id, { status: 'expired' });
    expect(updated?.status).toBe('expired');

    await expect(
      db.query(`INSERT INTO customer_domains (id, user_id, domain_name, status) VALUES ($1, $2, $3, $4)`, [
        randomUUID(),
        user.id,
        'bad.example',
        'not-a-real-status',
      ])
    ).rejects.toThrow();
  });

  it('allows re-entering the same domain name for a different customer (no global uniqueness enforced)', async () => {
    const userA = await makeUser('cust5a@example.com');
    const userB = await makeUser('cust5b@example.com');

    await expect(
      createCustomerDomain(db, { id: randomUUID(), userId: userA.id, domainName: 'shared-example.com', createdBy: userA.id })
    ).resolves.toBeTruthy();
    await expect(
      createCustomerDomain(db, { id: randomUUID(), userId: userB.id, domainName: 'shared-example.com', createdBy: userB.id })
    ).resolves.toBeTruthy();
  });

  it('opens a ticket with its first message, and replying transitions status + reopens if closed', async () => {
    const customer = await makeUser('cust6@example.com');
    const staff = await makeUser('staff6@example.com');

    const ticket = await createTicket(db, {
      id: randomUUID(),
      userId: customer.id,
      subject: 'My site is slow',
      firstMessage: { id: randomUUID(), authorId: customer.id, authorRole: 'customer', body: 'Please help.' },
    });
    expect(ticket.status).toBe('open');

    const messages1 = await listMessagesForTicket(db, ticket.id);
    expect(messages1).toHaveLength(1);

    await appendTicketMessage(db, { id: randomUUID(), ticketId: ticket.id, authorId: staff.id, authorRole: 'admin', body: 'Looking into it.' });
    const afterStaffReply = await findTicketById(db, ticket.id);
    expect(afterStaffReply?.status).toBe('pending_customer');

    await appendTicketMessage(db, { id: randomUUID(), ticketId: ticket.id, authorId: customer.id, authorRole: 'customer', body: 'Thanks!' });
    const afterCustomerReply = await findTicketById(db, ticket.id);
    expect(afterCustomerReply?.status).toBe('pending_staff');

    await updateTicketStatus(db, ticket.id, 'closed');
    const closed = await findTicketById(db, ticket.id);
    expect(closed?.status).toBe('closed');
    expect(closed?.closed_at).not.toBeNull();

    // A customer reply on a closed ticket must reopen it, not be silently accepted into a dead thread.
    await appendTicketMessage(db, { id: randomUUID(), ticketId: ticket.id, authorId: customer.id, authorRole: 'customer', body: 'Still broken!' });
    const reopened = await findTicketById(db, ticket.id);
    expect(reopened?.status).toBe('pending_staff');
    expect(reopened?.closed_at).toBeNull();

    const allMessages = await listMessagesForTicket(db, ticket.id);
    expect(allMessages).toHaveLength(4);
  });

  it('rejects a blank ticket message body at the database level', async () => {
    const customer = await makeUser('cust7@example.com');
    await expect(
      createTicket(db, {
        id: randomUUID(),
        userId: customer.id,
        subject: 'Blank test',
        firstMessage: { id: randomUUID(), authorId: customer.id, authorRole: 'customer', body: '   ' },
      })
    ).rejects.toThrow();
  });

  it('listTicketsForUser only returns that user\'s tickets; listAllTickets sees everyone\'s', async () => {
    const userA = await makeUser('cust8a@example.com');
    const userB = await makeUser('cust8b@example.com');

    await createTicket(db, {
      id: randomUUID(),
      userId: userA.id,
      subject: 'A ticket',
      firstMessage: { id: randomUUID(), authorId: userA.id, authorRole: 'customer', body: 'hi' },
    });
    await createTicket(db, {
      id: randomUUID(),
      userId: userB.id,
      subject: 'B ticket',
      firstMessage: { id: randomUUID(), authorId: userB.id, authorRole: 'customer', body: 'hi' },
    });

    const aTickets = await listTicketsForUser(db, userA.id);
    expect(aTickets).toHaveLength(1);
    expect(aTickets[0]?.subject).toBe('A ticket');

    const all = await listAllTickets(db, { limit: 25, offset: 0 });
    expect(all.total).toBe(2);
    expect(all.tickets).toHaveLength(2);
  });

  it('updateFullName, updatePasswordHash (stamps password_changed_at), updateUserStatus, updateUserRole persist real changes', async () => {
    const user = await makeUser('cust9@example.com');
    expect(new Date(user.password_changed_at).getFullYear()).toBe(1970); // epoch backfill/default

    const renamed = await updateFullName(db, user.id, 'New Name');
    expect(renamed?.full_name).toBe('New Name');

    const before = Date.now();
    const passwordChanged = await updatePasswordHash(db, user.id, 'new-hash');
    expect(passwordChanged?.password_hash).toBe('new-hash');
    expect(new Date(passwordChanged!.password_changed_at).getTime()).toBeGreaterThanOrEqual(before - 1000);

    const suspended = await updateUserStatus(db, user.id, 'suspended');
    expect(suspended?.status).toBe('suspended');

    const promoted = await updateUserRole(db, user.id, 'admin');
    expect(promoted?.role).toBe('admin');
  });

  it('listUsers filters by role and search, and paginates', async () => {
    await makeUser('alice@example.com');
    await makeUser('bob@example.com');
    const admin = await createUser(db, { id: randomUUID(), email: 'carol-admin@example.com', passwordHash: 'h', fullName: 'Carol' });
    await updateUserRole(db, admin.id, 'admin');

    const onlyCustomers = await listUsers(db, { role: 'customer', limit: 10, offset: 0 });
    expect(onlyCustomers.total).toBe(2);

    const searched = await listUsers(db, { search: 'alice', limit: 10, offset: 0 });
    expect(searched.total).toBe(1);
    expect(searched.users[0]?.email).toBe('alice@example.com');

    const paginated = await listUsers(db, { limit: 1, offset: 0 });
    expect(paginated.users).toHaveLength(1);
    expect(paginated.total).toBe(3);
  });

  it('extends auth_audit_log to accept the new Phase 4 event types without weakening the CHECK to arbitrary strings', async () => {
    const user = await makeUser('cust10@example.com');
    for (const eventType of ['profile_update', 'password_change', 'admin_status_change', 'admin_role_change']) {
      await expect(
        db.query(`INSERT INTO auth_audit_log (id, user_id, event_type) VALUES ($1, $2, $3)`, [randomUUID(), user.id, eventType])
      ).resolves.toBeTruthy();
    }

    await expect(
      db.query(`INSERT INTO auth_audit_log (id, user_id, event_type) VALUES ($1, $2, $3)`, [randomUUID(), user.id, 'not-a-real-event'])
    ).rejects.toThrow();
  });
});
