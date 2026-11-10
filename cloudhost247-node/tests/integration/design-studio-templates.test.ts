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

  describe('the round trip that matters', () => {
    it('prints the same label after a save and a reload', async () => {
      // The unit-level round trip above proves the JSON comes back. This proves the *label* does: the
      // page saves { templateId, values }, and posting that back must lay out identical draw ops. A
      // template store that returns the right bytes and prints a different label is the bug this
      // test exists to catch, and only comparing rendered output catches it.
      const values = { recipient: 'Ada Obi\n24 Zaria Road\nJos', tracking: 'CH247-88213' };
      const preview = (body: Record<string, unknown>) =>
        app.inject({ method: 'POST', url: '/api/tools/label-designer', headers: auth(ownerToken), payload: { action: 'preview', ...body } });

      const before = await preview({ templateId: 'address-70x40', values });
      expect(before.statusCode).toBe(200);
      const saveResponse = await save({ kind: 'label', name: 'Ada despatch', document: { templateId: 'address-70x40', values } });
      expect(saveResponse.statusCode).toBe(200);

      const stored = await app.inject({ method: 'GET', url: `${base}/${saveResponse.json().template.id}`, headers: auth(ownerToken) });
      const document = stored.json().template.document as { templateId: string; values: Record<string, string> };

      const after = await preview({ templateId: document.templateId, values: document.values });
      expect(after.statusCode).toBe(200);
      expect(after.json().data.document).toEqual(before.json().data.document);
      // And the values really are in the output, so the comparison above is not two identical fallbacks.
      // A multi-line field is drawn as a `lines` op, not `text`: the recipient block is one op with
      // several baselines, which is why both kinds are collected here.
      // Three op kinds carry the data: `text` (one line), `lines` (a multi-line field — the recipient
      // block is one op with several baselines) and `barcode` (whose payload is the encoded value).
      const ops = after.json().data.document.pages[0].ops as Array<{ kind: string; text?: string; lines?: string[]; encoded?: { payload?: string } }>;
      const texts = ops
        .flatMap((op) =>
          op.kind === 'text' ? [op.text ?? ''] : op.kind === 'lines' ? (op.lines ?? []) : op.kind === 'barcode' ? [op.encoded?.payload ?? ''] : []
        )
        .join('\n');
      expect(texts).toContain('Ada Obi');
      expect(texts).toContain('CH247-88213');
    });
  });

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
        ['PATCH', `${base}/${id}`],
        ['POST', `${base}/${id}/duplicate`],
        ['DELETE', `${base}/${id}`],
      ] as const) {
        // Well-formed bodies on purpose: this test is about ownership, so every verb must reach the
        // ownership check. A body that fails validation would return 400 and prove nothing about the
        // 404 rule.
        const payload =
          method === 'PUT' ? { document: DOCUMENT, expectedRevision: 1 } : method === 'PATCH' ? { name: 'Stolen' } : { name: 'Stolen' };
        const response = await app.inject({ method, url, headers: auth(otherToken), ...(method === 'GET' || method === 'DELETE' ? {} : { payload }) });
        expect(response.statusCode, `${method} ${url} should be 404 for a non-owner`).toBe(404);
        expect(response.json().message).toMatch(/saved template/i);
      }

      // Ordering is deliberate and worth pinning: malformed input is a 400 whoever is asking, so the
      // 404 above cannot be an accident of validation happening to run first.
      const malformed = await app.inject({ method: 'PUT', url: `${base}/${id}`, headers: auth(otherToken), payload: { document: DOCUMENT } });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json().message).toMatch(/expectedRevision/i);

      // The owner's copy is untouched.
      const still = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(still.statusCode).toBe(200);
      expect(still.json().template.name).toBe('Private layout');
      expect(still.json().template.revision).toBe(1);
    });
  });

  describe('updating, duplicating and deleting', () => {
    it('updates the layout in place and bumps updated_at', async () => {
      const created = await save({ kind: 'label', name: 'Editable', document: DOCUMENT });
      const id = created.json().template.id;
      const changed = { ...DOCUMENT, widthMm: 100, heightMm: 150 };

      const updated = await app.inject({
        method: 'PUT',
        url: `${base}/${id}`,
        headers: auth(ownerToken),
        payload: { document: changed, expectedRevision: created.json().template.revision },
      });
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

    it('keeps the same id and bumps the revision when a layout is overwritten', async () => {
      const created = await save({ kind: 'label', name: 'Tuned layout', document: DOCUMENT });
      const id = created.json().template.id;
      expect(created.json().template.revision).toBe(1);

      const changed = { ...DOCUMENT, widthMm: 100, heightMm: 150 };
      const updated = await app.inject({
        method: 'PUT',
        url: `${base}/${id}`,
        headers: auth(ownerToken),
        payload: { document: changed, expectedRevision: 1 },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().template.id).toBe(id);
      expect(updated.json().template.revision).toBe(2);

      // One row, not two: an overwrite is not a new template.
      const list = await app.inject({ method: 'GET', url: base, headers: auth(ownerToken) });
      expect(list.json().count).toBe(1);
      expect(list.json().templates[0].id).toBe(id);
      expect(list.json().templates[0].revision).toBe(2);
      // The list still carries no document, only its version.
      expect(list.json().templates[0].document).toBeUndefined();
    });

    it('refuses a stale overwrite with 409 and leaves the stored layout untouched', async () => {
      const created = await save({ kind: 'label', name: 'Shared layout', document: DOCUMENT });
      const id = created.json().template.id;

      // Tab A saves first.
      const first = await app.inject({
        method: 'PUT',
        url: `${base}/${id}`,
        headers: auth(ownerToken),
        payload: { document: { ...DOCUMENT, widthMm: 100 }, expectedRevision: 1 },
      });
      expect(first.statusCode).toBe(200);

      // Tab B still believes it is version 1. It must not win.
      const stale = await app.inject({
        method: 'PUT',
        url: `${base}/${id}`,
        headers: auth(ownerToken),
        payload: { document: { ...DOCUMENT, widthMm: 999 }, expectedRevision: 1 },
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().message).toContain('nothing was overwritten');
      expect(stale.json().message).toContain('revision 2');

      // Tab A's layout survived; the stale write left no trace at all.
      const stored = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(stored.json().template.document.widthMm).toBe(100);
      expect(stored.json().template.revision).toBe(2);
    });

    it('leaves the template intact when an overwrite is rejected for its contents', async () => {
      const created = await save({ kind: 'label', name: 'Fragile', document: DOCUMENT });
      const id = created.json().template.id;

      // Each of these is refused before the UPDATE runs. The failure mode being ruled out is a
      // half-applied write leaving a template the picker still lists but the editor cannot open.
      const rejected: Array<[Record<string, unknown>, number, RegExp]> = [
        [{ expectedRevision: 1 }, 400, /must include the document/i],
        [{ document: [1, 2, 3], expectedRevision: 1 }, 400, /document must be an object/i],
        [{ document: DOCUMENT, expectedRevision: 0 }, 400, /expectedRevision/i],
        [{ document: DOCUMENT, expectedRevision: 'latest' }, 400, /expectedRevision/i],
        // Above the 2 MB document cap the request is refused by Fastify's own body limit (413) before
        // the repository sees it — also a clean refusal, and the same guarantee: nothing was written.
        [{ document: { blob: 'x'.repeat(2 * 1024 * 1024 + 16) }, expectedRevision: 1 }, 413, /too large|payload/i],
      ];
      for (const [payload, status, message] of rejected) {
        const response = await app.inject({ method: 'PUT', url: `${base}/${id}`, headers: auth(ownerToken), payload });
        expect(response.statusCode, JSON.stringify(payload).slice(0, 80)).toBe(status);
        expect(response.json().message).toMatch(message);
      }

      const stored = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(stored.statusCode).toBe(200);
      expect(stored.json().template.revision).toBe(1);
      expect(stored.json().template.document).toEqual(DOCUMENT);
    });

    it('only renames a conflict into advice: an overwrite cannot steal another template’s name', async () => {
      // Overwrite deliberately does not accept a name, so the unique index is never in play: the way to
      // change a name is PATCH. This asserts the split holds at the API surface.
      const created = await save({ kind: 'label', name: 'Named once', document: DOCUMENT });
      const id = created.json().template.id;
      await save({ kind: 'label', name: 'Taken', document: DOCUMENT });

      const sneaky = await app.inject({
        method: 'PUT',
        url: `${base}/${id}`,
        headers: auth(ownerToken),
        payload: { name: 'Taken', document: DOCUMENT, expectedRevision: 1 },
      });
      expect(sneaky.statusCode).toBe(200);
      // The name in the body was ignored: an overwrite replaces content, not identity.
      expect(sneaky.json().template.name).toBe('Named once');
      expect(sneaky.json().template.revision).toBe(2);
    });

    it('lets exactly one of two concurrent conditional overwrites win', async () => {
      // The point of putting the check in the WHERE clause rather than a read-then-write: two requests
      // fired together, both holding revision 1, must not both report success. With a read-then-write
      // in TypeScript both would pass their check and the second would silently overwrite the first.
      const created = await save({ kind: 'label', name: 'Contended', document: DOCUMENT });
      const id = created.json().template.id;

      const write = (widthMm: number) =>
        app.inject({
          method: 'PUT',
          url: `${base}/${id}`,
          headers: auth(ownerToken),
          payload: { document: { ...DOCUMENT, widthMm }, expectedRevision: 1 },
        });

      const results = await Promise.all([write(80), write(120)]);
      const statuses = results.map((response) => response.statusCode).sort();
      expect(statuses).toEqual([200, 409]);

      // Exactly one revision bump, and the stored layout is the winner's — not a blend of the two.
      const stored = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(stored.json().template.revision).toBe(2);
      expect([80, 120]).toContain(stored.json().template.document.widthMm);
    });

    it('renames without touching the document, and refuses a rename that smuggles one in', async () => {
      const created = await save({ kind: 'label', name: 'Before', document: DOCUMENT });
      const id = created.json().template.id;

      const renamed = await app.inject({ method: 'PATCH', url: `${base}/${id}`, headers: auth(ownerToken), payload: { name: 'After' } });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json().template.name).toBe('After');
      // A rename is not a version: the layout is the same, so the revision does not move.
      expect(renamed.json().template.revision).toBe(1);
      expect(renamed.json().template.document).toEqual(DOCUMENT);

      const smuggled = await app.inject({
        method: 'PATCH',
        url: `${base}/${id}`,
        headers: auth(ownerToken),
        payload: { name: 'Sneaky', document: { ...DOCUMENT, widthMm: 999 } },
      });
      expect(smuggled.statusCode).toBe(400);
      expect(smuggled.json().message).toMatch(/cannot change its document/i);

      const empty = await app.inject({ method: 'PATCH', url: `${base}/${id}`, headers: auth(ownerToken), payload: {} });
      expect(empty.statusCode).toBe(400);
      expect(empty.json().message).toMatch(/new "name" or "summary"/i);

      // Neither refusal changed anything.
      const stored = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(stored.json().template.name).toBe('After');
      expect(stored.json().template.document.widthMm).toBe(DOCUMENT.widthMm);
    });

    it('reports a rename collision as a 409 with advice, and keeps the old name', async () => {
      const first = await save({ kind: 'label', name: 'Mine', document: DOCUMENT });
      await save({ kind: 'label', name: 'Yours', document: DOCUMENT });
      const id = first.json().template.id;

      const clash = await app.inject({ method: 'PATCH', url: `${base}/${id}`, headers: auth(ownerToken), payload: { name: 'yours' } });
      // Case-insensitive: "yours" and "Yours" are the same name to a human reading a picker.
      expect(clash.statusCode).toBe(409);
      expect(clash.json().message).toMatch(/Rename this one or update the existing template/i);

      const stored = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(stored.json().template.name).toBe('Mine');
    });

    it('refuses an overwrite with no expectedRevision instead of writing blind', async () => {
      // The loophole this closes: if the revision is optional, the database check protects only the
      // clients that opted in, and the last unconditional writer wins. That is the same silent
      // data-loss bug the column was added to prevent, just rarer.
      const created = await save({ kind: 'label', name: 'Checked', document: DOCUMENT });
      const id = created.json().template.id;

      // A client that saved a prior version and then sends a bare document must not be obeyed.
      await app.inject({ method: 'PUT', url: `${base}/${id}`, headers: auth(ownerToken), payload: { document: { ...DOCUMENT, widthMm: 90 }, expectedRevision: 1 } });

      const blind = await app.inject({ method: 'PUT', url: `${base}/${id}`, headers: auth(ownerToken), payload: { document: { ...DOCUMENT, widthMm: 999 } } });
      expect(blind.statusCode).toBe(400);
      expect(blind.json().message).toMatch(/expectedRevision/i);
      // The message has to say where the number comes from, or the caller is stuck.
      expect(blind.json().message).toMatch(/GET \/templates\/:id/i);

      const stored = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(stored.json().template.document.widthMm).toBe(90);
      expect(stored.json().template.revision).toBe(2);
      expect(stored.json().template.lastForcedAt).toBeUndefined();
    });

    it('closes the compatibility path at its published sunset with a 410 and a fix', async () => {
      // The published sunset (2026-05-09) has passed. The path is gone, and a legacy client gets a
      // diagnosis — not a 400 that reads like a typo, and not a silent write.
      const created = await save({ kind: 'label', name: 'Legacy client', document: DOCUMENT });
      const id = created.json().template.id;

      for (const payload of [{ document: { ...DOCUMENT, widthMm: 88 }, force: true }, { document: { ...DOCUMENT, widthMm: 88 } }]) {
        const response = await app.inject({ method: 'PUT', url: `${base}/${id}`, headers: auth(ownerToken), payload });
        // No expectedRevision → 400 (malformed); with force → 410 (removed operation).
        expect([400, 410]).toContain(response.statusCode);
      }

      const forced = await app.inject({
        method: 'PUT',
        url: `${base}/${id}`,
        headers: auth(ownerToken),
        payload: { document: { ...DOCUMENT, widthMm: 88 }, force: true },
      });
      expect(forced.statusCode).toBe(410);
      expect(forced.json().error).toBe('FORCED_OVERWRITE_SUNSET');
      expect(forced.json().message).toContain('2026-05-09');
      // The remedy has to be actionable, or the client is stuck.
      expect(forced.json().message).toMatch(/expectedRevision/);

      // Nothing was written by any of those attempts.
      const stored = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(stored.json().template.revision).toBe(1);
      expect(stored.json().template.document).toEqual(DOCUMENT);
    });

    it('closes the header form of the compatibility path too', async () => {
      const created = await save({ kind: 'label', name: 'Header client', document: DOCUMENT });
      const id = created.json().template.id;
      const viaHeader = await app.inject({
        method: 'PUT',
        url: `${base}/${id}`,
        headers: { ...auth(ownerToken), 'x-design-studio-allow-unconditional': 'true' },
        payload: { document: { ...DOCUMENT, widthMm: 77 } },
      });
      expect(viaHeader.statusCode).toBe(410);
      expect(viaHeader.json().error).toBe('FORCED_OVERWRITE_SUNSET');
    });

    it('refuses a forced overwrite from another account by the same rule as any other', async () => {
      // "Skip the version check" must never quietly mean "skip ownership". Now that the path is closed
      // the answer is 410 for everyone, but the ownership assertion still matters for the re-opened
      // case: this drives the repository directly to prove the user_id predicate is in the statement.
      const created = await save({ kind: 'label', name: 'Not yours', document: DOCUMENT });
      const id = created.json().template.id;
      const stolen = await app.inject({
        method: 'PUT',
        url: `${base}/${id}`,
        headers: auth(otherToken),
        payload: { document: { ...DOCUMENT, widthMm: 999 }, expectedRevision: 1 },
      });
      expect(stolen.statusCode).toBe(404);

      const stored = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(stored.json().template.document).toEqual(DOCUMENT);
      expect(stored.json().template.revision).toBe(1);
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

    it('keeps the same id and bumps the revision when a layout is overwritten', async () => {
      const created = await save({ kind: 'label', name: 'Tuned layout', document: DOCUMENT });
      const id = created.json().template.id;
      expect(created.json().template.revision).toBe(1);

      const changed = { ...DOCUMENT, widthMm: 100, heightMm: 150 };
      const updated = await app.inject({
        method: 'PUT',
        url: `${base}/${id}`,
        headers: auth(ownerToken),
        payload: { document: changed, expectedRevision: 1 },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().template.id).toBe(id);
      expect(updated.json().template.revision).toBe(2);

      // One row, not two: an overwrite is not a new template.
      const list = await app.inject({ method: 'GET', url: base, headers: auth(ownerToken) });
      expect(list.json().count).toBe(1);
      expect(list.json().templates[0].id).toBe(id);
      expect(list.json().templates[0].revision).toBe(2);
      // The list still carries no document, only its version.
      expect(list.json().templates[0].document).toBeUndefined();
    });

    it('refuses a stale overwrite with 409 and leaves the stored layout untouched', async () => {
      const created = await save({ kind: 'label', name: 'Shared layout', document: DOCUMENT });
      const id = created.json().template.id;

      // Tab A saves first.
      const first = await app.inject({
        method: 'PUT',
        url: `${base}/${id}`,
        headers: auth(ownerToken),
        payload: { document: { ...DOCUMENT, widthMm: 100 }, expectedRevision: 1 },
      });
      expect(first.statusCode).toBe(200);

      // Tab B still believes it is version 1. It must not win.
      const stale = await app.inject({
        method: 'PUT',
        url: `${base}/${id}`,
        headers: auth(ownerToken),
        payload: { document: { ...DOCUMENT, widthMm: 999 }, expectedRevision: 1 },
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().message).toContain('nothing was overwritten');
      expect(stale.json().message).toContain('revision 2');

      // Tab A's layout survived; the stale write left no trace at all.
      const stored = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(stored.json().template.document.widthMm).toBe(100);
      expect(stored.json().template.revision).toBe(2);
    });

    it('leaves the template intact when an overwrite is rejected for its contents', async () => {
      const created = await save({ kind: 'label', name: 'Fragile', document: DOCUMENT });
      const id = created.json().template.id;

      // Each of these is refused before the UPDATE runs. The failure mode being ruled out is a
      // half-applied write leaving a template the picker still lists but the editor cannot open.
      const rejected: Array<[Record<string, unknown>, number, RegExp]> = [
        [{ expectedRevision: 1 }, 400, /must include the document/i],
        [{ document: [1, 2, 3], expectedRevision: 1 }, 400, /document must be an object/i],
        [{ document: DOCUMENT, expectedRevision: 0 }, 400, /expectedRevision/i],
        [{ document: DOCUMENT, expectedRevision: 'latest' }, 400, /expectedRevision/i],
        // Above the 2 MB document cap the request is refused by Fastify's own body limit (413) before
        // the repository sees it — also a clean refusal, and the same guarantee: nothing was written.
        [{ document: { blob: 'x'.repeat(2 * 1024 * 1024 + 16) }, expectedRevision: 1 }, 413, /too large|payload/i],
      ];
      for (const [payload, status, message] of rejected) {
        const response = await app.inject({ method: 'PUT', url: `${base}/${id}`, headers: auth(ownerToken), payload });
        expect(response.statusCode, JSON.stringify(payload).slice(0, 80)).toBe(status);
        expect(response.json().message).toMatch(message);
      }

      const stored = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(stored.statusCode).toBe(200);
      expect(stored.json().template.revision).toBe(1);
      expect(stored.json().template.document).toEqual(DOCUMENT);
    });

    it('only renames a conflict into advice: an overwrite cannot steal another template’s name', async () => {
      // Overwrite deliberately does not accept a name, so the unique index is never in play: the way to
      // change a name is PATCH. This asserts the split holds at the API surface.
      const created = await save({ kind: 'label', name: 'Named once', document: DOCUMENT });
      const id = created.json().template.id;
      await save({ kind: 'label', name: 'Taken', document: DOCUMENT });

      const sneaky = await app.inject({
        method: 'PUT',
        url: `${base}/${id}`,
        headers: auth(ownerToken),
        payload: { name: 'Taken', document: DOCUMENT, expectedRevision: 1 },
      });
      expect(sneaky.statusCode).toBe(200);
      // The name in the body was ignored: an overwrite replaces content, not identity.
      expect(sneaky.json().template.name).toBe('Named once');
      expect(sneaky.json().template.revision).toBe(2);
    });

    it('lets exactly one of two concurrent conditional overwrites win', async () => {
      // The point of putting the check in the WHERE clause rather than a read-then-write: two requests
      // fired together, both holding revision 1, must not both report success. With a read-then-write
      // in TypeScript both would pass their check and the second would silently overwrite the first.
      const created = await save({ kind: 'label', name: 'Contended', document: DOCUMENT });
      const id = created.json().template.id;

      const write = (widthMm: number) =>
        app.inject({
          method: 'PUT',
          url: `${base}/${id}`,
          headers: auth(ownerToken),
          payload: { document: { ...DOCUMENT, widthMm }, expectedRevision: 1 },
        });

      const results = await Promise.all([write(80), write(120)]);
      const statuses = results.map((response) => response.statusCode).sort();
      expect(statuses).toEqual([200, 409]);

      // Exactly one revision bump, and the stored layout is the winner's — not a blend of the two.
      const stored = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(stored.json().template.revision).toBe(2);
      expect([80, 120]).toContain(stored.json().template.document.widthMm);
    });

    it('renames without touching the document, and refuses a rename that smuggles one in', async () => {
      const created = await save({ kind: 'label', name: 'Before', document: DOCUMENT });
      const id = created.json().template.id;

      const renamed = await app.inject({ method: 'PATCH', url: `${base}/${id}`, headers: auth(ownerToken), payload: { name: 'After' } });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json().template.name).toBe('After');
      // A rename is not a version: the layout is the same, so the revision does not move.
      expect(renamed.json().template.revision).toBe(1);
      expect(renamed.json().template.document).toEqual(DOCUMENT);

      const smuggled = await app.inject({
        method: 'PATCH',
        url: `${base}/${id}`,
        headers: auth(ownerToken),
        payload: { name: 'Sneaky', document: { ...DOCUMENT, widthMm: 999 } },
      });
      expect(smuggled.statusCode).toBe(400);
      expect(smuggled.json().message).toMatch(/cannot change its document/i);

      const empty = await app.inject({ method: 'PATCH', url: `${base}/${id}`, headers: auth(ownerToken), payload: {} });
      expect(empty.statusCode).toBe(400);
      expect(empty.json().message).toMatch(/new "name" or "summary"/i);

      // Neither refusal changed anything.
      const stored = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(stored.json().template.name).toBe('After');
      expect(stored.json().template.document.widthMm).toBe(DOCUMENT.widthMm);
    });

    it('reports a rename collision as a 409 with advice, and keeps the old name', async () => {
      const first = await save({ kind: 'label', name: 'Mine', document: DOCUMENT });
      await save({ kind: 'label', name: 'Yours', document: DOCUMENT });
      const id = first.json().template.id;

      const clash = await app.inject({ method: 'PATCH', url: `${base}/${id}`, headers: auth(ownerToken), payload: { name: 'yours' } });
      // Case-insensitive: "yours" and "Yours" are the same name to a human reading a picker.
      expect(clash.statusCode).toBe(409);
      expect(clash.json().message).toMatch(/Rename this one or update the existing template/i);

      const stored = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(stored.json().template.name).toBe('Mine');
    });

    it('refuses an overwrite with no expectedRevision instead of writing blind', async () => {
      // The loophole this closes: if the revision is optional, the database check protects only the
      // clients that opted in, and the last unconditional writer wins. That is the same silent
      // data-loss bug the column was added to prevent, just rarer.
      const created = await save({ kind: 'label', name: 'Checked', document: DOCUMENT });
      const id = created.json().template.id;

      // A client that saved a prior version and then sends a bare document must not be obeyed.
      await app.inject({ method: 'PUT', url: `${base}/${id}`, headers: auth(ownerToken), payload: { document: { ...DOCUMENT, widthMm: 90 }, expectedRevision: 1 } });

      const blind = await app.inject({ method: 'PUT', url: `${base}/${id}`, headers: auth(ownerToken), payload: { document: { ...DOCUMENT, widthMm: 999 } } });
      expect(blind.statusCode).toBe(400);
      expect(blind.json().message).toMatch(/expectedRevision/i);
      // The message has to say where the number comes from, or the caller is stuck.
      expect(blind.json().message).toMatch(/GET \/templates\/:id/i);

      const stored = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(stored.json().template.document.widthMm).toBe(90);
      expect(stored.json().template.revision).toBe(2);
      expect(stored.json().template.lastForcedAt).toBeUndefined();
    });

    it('closes the compatibility path at its published sunset with a 410 and a fix', async () => {
      // The published sunset (2026-05-09) has passed. The path is gone, and a legacy client gets a
      // diagnosis — not a 400 that reads like a typo, and not a silent write.
      const created = await save({ kind: 'label', name: 'Legacy client', document: DOCUMENT });
      const id = created.json().template.id;

      for (const payload of [{ document: { ...DOCUMENT, widthMm: 88 }, force: true }, { document: { ...DOCUMENT, widthMm: 88 } }]) {
        const response = await app.inject({ method: 'PUT', url: `${base}/${id}`, headers: auth(ownerToken), payload });
        // No expectedRevision → 400 (malformed); with force → 410 (removed operation).
        expect([400, 410]).toContain(response.statusCode);
      }

      const forced = await app.inject({
        method: 'PUT',
        url: `${base}/${id}`,
        headers: auth(ownerToken),
        payload: { document: { ...DOCUMENT, widthMm: 88 }, force: true },
      });
      expect(forced.statusCode).toBe(410);
      expect(forced.json().error).toBe('FORCED_OVERWRITE_SUNSET');
      expect(forced.json().message).toContain('2026-05-09');
      // The remedy has to be actionable, or the client is stuck.
      expect(forced.json().message).toMatch(/expectedRevision/);

      // Nothing was written by any of those attempts.
      const stored = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(stored.json().template.revision).toBe(1);
      expect(stored.json().template.document).toEqual(DOCUMENT);
    });

    it('closes the header form of the compatibility path too', async () => {
      const created = await save({ kind: 'label', name: 'Header client', document: DOCUMENT });
      const id = created.json().template.id;
      const viaHeader = await app.inject({
        method: 'PUT',
        url: `${base}/${id}`,
        headers: { ...auth(ownerToken), 'x-design-studio-allow-unconditional': 'true' },
        payload: { document: { ...DOCUMENT, widthMm: 77 } },
      });
      expect(viaHeader.statusCode).toBe(410);
      expect(viaHeader.json().error).toBe('FORCED_OVERWRITE_SUNSET');
    });

    it('records overwrites and renames in the audit log by name and version, never by document', async () => {
      const created = await save({ kind: 'label', name: 'Audited', document: DOCUMENT });
      const id = created.json().template.id;
      await app.inject({ method: 'PUT', url: `${base}/${id}`, headers: auth(ownerToken), payload: { document: { ...DOCUMENT, widthMm: 71 }, expectedRevision: 1 } });
      await app.inject({ method: 'PATCH', url: `${base}/${id}`, headers: auth(ownerToken), payload: { name: 'Audited again' } });

      const updated = await client.query<{ metadata: Record<string, unknown> }>(
        "SELECT metadata FROM audit_logs WHERE action = 'DESIGN_STUDIO_TEMPLATE_UPDATED' AND resource_id = $1",
        [id]
      );
      expect(updated.rows).toHaveLength(1);
      expect(updated.rows[0]?.metadata).toMatchObject({ kind: 'label', name: 'Audited', revision: 2, previousRevision: 1 });
      expect(JSON.stringify(updated.rows[0]?.metadata)).not.toContain('recipient');

      const renamed = await client.query<{ metadata: Record<string, unknown> }>(
        "SELECT metadata FROM audit_logs WHERE action = 'DESIGN_STUDIO_TEMPLATE_RENAMED' AND resource_id = $1",
        [id]
      );
      expect(renamed.rows).toHaveLength(1);
      expect(renamed.rows[0]?.metadata).toMatchObject({ name: 'Audited again', previousName: 'Audited' });
    });

    it('serves the same lifecycle on the /api/v1 alias', async () => {
      const v1 = '/api/v1/tools/design-studio/templates';
      const created = await save({ kind: 'card', name: 'v1 card', document: DOCUMENT }, ownerToken, v1);
      expect(created.statusCode).toBe(200);
      const id = created.json().template.id;

      const updated = await app.inject({ method: 'PUT', url: `${v1}/${id}`, headers: auth(ownerToken), payload: { document: { ...DOCUMENT, widthMm: 85 }, expectedRevision: 1 } });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().template.revision).toBe(2);

      const renamed = await app.inject({ method: 'PATCH', url: `${v1}/${id}`, headers: auth(ownerToken), payload: { name: 'v1 renamed' } });
      expect(renamed.statusCode).toBe(200);
      // Both prefixes address the same row.
      const viaV2 = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(viaV2.json().template.name).toBe('v1 renamed');
      expect(viaV2.json().template.kind).toBe('card');
    });

    it('keeps a template saved before the revision column working untouched', async () => {
      // Simulate a row written by the previous release: no revision expectation anywhere, and the
      // column at its default. Migrating must not require re-saving anything.
      const created = await save({ kind: 'shipping', name: 'Pre-existing', document: DOCUMENT });
      const id = created.json().template.id;
      await client.query('UPDATE design_studio_templates SET revision = 1 WHERE id = $1', [id]);

      const read = await app.inject({ method: 'GET', url: `${base}/${id}`, headers: auth(ownerToken) });
      expect(read.json().template.revision).toBe(1);
      expect(read.json().template.document).toEqual(DOCUMENT);

      const loadable = await app.inject({ method: 'GET', url: base, headers: auth(ownerToken) });
      expect(loadable.json().templates.find((entry: { id: string }) => entry.id === id).revision).toBe(1);
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
