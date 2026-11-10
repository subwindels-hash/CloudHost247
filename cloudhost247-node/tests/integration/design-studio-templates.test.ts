/**
 * Design Studio — saved templates API.
 *
 * The five generation tools persist nothing (see `NON_PERSISTABLE_TOOL_SLUGS`), and this endpoint is
 * the one deliberate exception: a customer may name a *layout* and keep it. The tests therefore
 * concentrate on the line between a layout and a payload:
 *
 *   • a saved template round-trips its document (element positions, bindings) unchanged;
 *   • `userId` always comes from the token — an id from another account is NOT_FOUND, not forbidden,
 *     because a 403 on an id confirms that the id exists;
 *   • anonymous callers are refused rather than shown an empty list;
 *   • the owner column never appears in a response.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv, type Env } from '../../src/config/env';
import { signAuthToken } from '../../src/lib/jwt';

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
process.env.JWT_SECRET ??= 'f'.repeat(32);
process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);

/** A label document as the Label Designer posts it: a layout, with no customer data in it. */
const DOCUMENT = {
  name: 'Our 70 × 40 despatch label',
  category: 'address',
  widthMm: 70,
  heightMm: 40,
  orientation: 'landscape',
  templateId: 'address-70x40',
  style: { background: '#ffffff', paddingMm: 3 },
  elements: [
    { kind: 'field', id: 'recipient', name: 'Recipient block', x: 0, y: 4, width: 53, height: 15, binding: { key: 'recipient' } },
    { kind: 'barcode', id: 'tracking', name: 'Tracking', x: 0, y: 20, width: 64, height: 14, formatId: 'code128', moduleMm: 0.25, binding: { key: 'tracking' } },
  ],
};

describe('Design Studio saved templates', () => {
  let db: PGlite;
  let client: PgliteClient;
  let app: ReturnType<typeof buildApp>;
  let env: Env;
  let ownerToken: string;
  let otherToken: string;
  const ownerId = randomUUID();
  const otherId = randomUUID();

  beforeEach(async () => {
    env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
      JWT_SECRET: 'f'.repeat(32),
      SERVER_AGENT_SHARED_SECRET: 's'.repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
      LOG_LEVEL: 'silent',
    } as NodeJS.ProcessEnv);

    db = new PGlite();
    client = new PgliteClient(db);
    await migrateUp(client, { allowProduction: true });
    await client.exec(`
      INSERT INTO users (id, email, password_hash, full_name, role, status)
      VALUES
        ('${ownerId}', 'design-owner@example.com', 'hash', 'Design Owner', 'customer', 'active'),
        ('${otherId}', 'design-other@example.com', 'hash', 'Other Customer', 'customer', 'active');
    `);
    ownerToken = signAuthToken(env, { sub: ownerId, email: 'design-owner@example.com', role: 'customer' });
    otherToken = signAuthToken(env, { sub: otherId, email: 'design-other@example.com', role: 'customer' });
    app = buildApp(env, { serveFrontend: false, pool: client as never });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    await db.close();
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const base = '/api/tools/design-studio/templates';

  const save = (body: Record<string, unknown>, token = ownerToken, url = base) =>
    app.inject({ method: 'POST', url, headers: auth(token), payload: body });

  describe('saving', () => {
    it('round-trips the layout and never echoes the owner id', async () => {
      const response = await save({ kind: 'label', name: 'Despatch label', summary: 'For small parcels', document: DOCUMENT, sourceTemplate: 'address-70x40' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.template.kind).toBe('label');
      expect(body.template.name).toBe('Despatch label');
      expect(body.template.sourceTemplate).toBe('address-70x40');
      // The layout is what was saved: element positions, bindings and all.
      expect(body.template.document.elements).toHaveLength(2);
      expect(body.template.document.elements[1].formatId).toBe('code128');
      expect(body.template.document.widthMm).toBe(70);
      // `userId` is the owner column; it must never reach a client.
      expect(body.template.userId).toBeUndefined();

      const read = await app.inject({ method: 'GET', url: `${base}/${body.template.id}`, headers: auth(ownerToken) });
      expect(read.statusCode).toBe(200);
      expect(read.json().template.document).toEqual(body.template.document);
    });

    it('refuses a missing name, an unknown kind and a non-object document', async () => {
      const noName = await save({ kind: 'label', document: DOCUMENT });
      expect(noName.statusCode).toBe(400);
      expect(noName.json().message).toMatch(/name/i);

      const badKind = await save({ kind: 'poster', name: 'x', document: DOCUMENT });
      expect(badKind.statusCode).toBe(400);
      expect(badKind.json().message).toContain('label, shipping, vda, card');

      const badDocument = await save({ kind: 'label', name: 'x', document: [1, 2, 3] });
      expect(badDocument.statusCode).toBe(400);
      expect(badDocument.json().message).toMatch(/document/i);
    });

    it('refuses an anonymous caller instead of saving under a placeholder owner', async () => {
      const response = await app.inject({ method: 'POST', url: base, payload: { kind: 'label', name: 'Anon', document: DOCUMENT } });
      expect(response.statusCode).toBe(401);
    });

    it('rejects a duplicate name for the same owner with advice, not a raw constraint error', async () => {
      await save({ kind: 'label', name: 'Same name', document: DOCUMENT });
      const second = await save({ kind: 'label', name: 'Same name', document: DOCUMENT });
      expect(second.statusCode).toBe(400);
      expect(second.json().message).toMatch(/already have a label template/i);
    });

    it('allows the same name in a different kind', async () => {
      await save({ kind: 'label', name: 'Shared name', document: DOCUMENT });
      const card = await save({ kind: 'card', name: 'Shared name', document: DOCUMENT });
      expect(card.statusCode).toBe(200);
    });
  });

  describe('listing and filtering', () => {
    it('lists only the caller’s own templates and filters by kind', async () => {
      await save({ kind: 'label', name: 'Label A', document: DOCUMENT });
      await save({ kind: 'card', name: 'Card A', document: DOCUMENT });
      await save({ kind: 'label', name: 'Other’s label', document: DOCUMENT }, otherToken);

      const all = await app.inject({ method: 'GET', url: base, headers: auth(ownerToken) });
      expect(all.statusCode).toBe(200);
      const names = all.json().templates.map((entry: { name: string }) => entry.name);
      expect(names.sort()).toEqual(['Card A', 'Label A']);
      expect(names).not.toContain('Other’s label');

      const labels = await app.inject({ method: 'GET', url: `${base}?kind=label`, headers: auth(ownerToken) });
      expect(labels.json().templates.map((entry: { name: string }) => entry.name)).toEqual(['Label A']);

      // The list is a summary: it carries no document at all, so a picker cannot accidentally hold
      // every saved layout in memory.
      expect(labels.json().templates[0].document).toBeUndefined();
    });

    it('rejects an unknown kind filter rather than silently returning everything', async () => {
      const response = await app.inject({ method: 'GET', url: `${base}?kind=poster`, headers: auth(ownerToken) });
      expect(response.statusCode).toBe(400);
    });

    it('refuses an anonymous list instead of showing an empty one', async () => {
      const response = await app.inject({ method: 'GET', url: base });
      expect(response.statusCode).toBe(401);
    });

    it('mirrors every route on the /api/v1 alias', async () => {
      const created = await save({ kind: 'label', name: 'Versioned', document: DOCUMENT }, ownerToken, '/api/v1/tools/design-studio/templates');
      expect(created.statusCode).toBe(200);
      const list = await app.inject({ method: 'GET', url: '/api/v1/tools/design-studio/templates', headers: auth(ownerToken) });
      expect(list.json().templates.map((entry: { name: string }) => entry.name)).toEqual(['Versioned']);
    });
  });

  describe('ownership', () => {
    it('reports another account’s template as not found, never as forbidden', async () => {
      const created = await save({ kind: 'label', name: 'Private layout', document: DOCUMENT });
      const id = created.json().template.id;

      for (const [method, url] of [
        ['GET', `${base}/${id}`],
        ['PUT', `${base}/${id}`],
        ['POST', `${base}/${id}/duplicate`],
        ['DELETE', `${base}/${id}`],
      ] as const) {
        const response = await app.inject({ method, url, headers: auth(otherToken), ...(method === 'GET' || method === 'DELETE' ? {} : { payload: { name: 'Stolen' } }) });
        expect(response.statusCode, `${method} ${url} should be 404 for a non-owner`).toBe(404);
        expect(response.json().message).toMatch(/saved template/i);
      }

      // The owner's copy is untouched.
      const still = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(still.statusCode).toBe(200);
      expect(still.json().template.name).toBe('Private layout');
    });
  });

  describe('updating, duplicating and deleting', () => {
    it('updates the layout in place and bumps updated_at', async () => {
      const created = await save({ kind: 'label', name: 'Editable', document: DOCUMENT });
      const id = created.json().template.id;
      const changed = { ...DOCUMENT, widthMm: 100, heightMm: 150 };

      const updated = await app.inject({ method: 'PUT', url: `${base}/${id}`, headers: auth(ownerToken), payload: { document: changed } });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().template.document.widthMm).toBe(100);
      expect(updated.json().template.document.heightMm).toBe(150);
      // The kind is not updatable: changing it would move the row between pickers.
      expect(updated.json().template.kind).toBe('label');
      expect(new Date(updated.json().template.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.json().template.updatedAt).getTime());
    });

    it('duplicates under a new name so the copy can be edited independently', async () => {
      const created = await save({ kind: 'label', name: 'Original', document: DOCUMENT });
      const duplicate = await app.inject({
        method: 'POST',
        url: `${base}/${created.json().template.id}/duplicate`,
        headers: auth(ownerToken),
        payload: { name: 'Original (copy)' },
      });
      expect(duplicate.statusCode).toBe(200);
      expect(duplicate.json().template.name).toBe('Original (copy)');
      expect(duplicate.json().template.id).not.toBe(created.json().template.id);
      expect(duplicate.json().template.document).toEqual(DOCUMENT);

      const list = await app.inject({ method: 'GET', url: base, headers: auth(ownerToken) });
      expect(list.json().count).toBe(2);
    });

    it('deletes the template and its audit trail records the event without the document', async () => {
      const created = await save({ kind: 'label', name: 'Disposable', document: DOCUMENT });
      const id = created.json().template.id;

      const removed = await app.inject({ method: 'DELETE', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(removed.statusCode).toBe(200);
      expect(removed.json().deleted).toBe(true);

      const gone = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(gone.statusCode).toBe(404);

      const { rows } = await client.query<{ metadata: unknown }>(
        "SELECT metadata FROM audit_logs WHERE action = 'DESIGN_STUDIO_TEMPLATE_DELETED' AND resource_id = $1",
        [id]
      );
      expect(rows).toHaveLength(1);
      // The audit row names the event; it must not become a second copy of the customer's layout.
      expect(JSON.stringify(rows[0]?.metadata ?? {})).not.toContain('elements');
    });

    it('records a save in the audit log by name and kind, never by document', async () => {
      const created = await save({ kind: 'label', name: 'Audited layout', document: DOCUMENT });
      const { rows } = await client.query<{ metadata: Record<string, unknown> }>(
        "SELECT metadata FROM audit_logs WHERE action = 'DESIGN_STUDIO_TEMPLATE_SAVED' AND resource_id = $1",
        [created.json().template.id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.metadata).toMatchObject({ kind: 'label', name: 'Audited layout' });
      expect(JSON.stringify(rows[0]?.metadata)).not.toContain('recipient');
    });
  });
});
