/**
 * CloudHost247 Website Builder — sites, pages, drafts, revisions, publications, media and forms.
 *
 * The service owns every rule the builder has:
 *   - a page's draft content is validated against the section registry before it is stored, and the
 *     previous version is preserved as an immutable revision;
 *   - publishing writes an immutable snapshot, and that snapshot (never the draft tables) is what a
 *     visitor is served;
 *   - a site can only be attached to a domain the customer actually owns (`customer_domains`);
 *   - plan limits come from the purchased platform tier (or the admin-configurable free tier), and
 *     a limit is enforced at create time rather than being promised in marketing copy.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../lib/errors';
import { validateSeo, validateSections, type PageSeo, type StoredSection } from './sections';
import { assertEntitlement, getSiteLimits } from './entitlements';
import { decodeAndValidateUpload } from '../lib/media-upload';
import { recordMessage } from '../inbox/inbox-service';
import { sendTransactionalEmail } from '../lib/transactional-email';

export interface SiteRow {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  status: 'draft' | 'published' | 'suspended';
  published_publication_id: string | null;
  draft_revision: number;
  domain_id: string | null;
  theme: Record<string, unknown>;
  seo: PageSeo;
  settings: Record<string, unknown>;
  plan_code: string;
  subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PageRow {
  id: string;
  site_id: string;
  title: string;
  path: string;
  is_home: boolean;
  status: 'draft' | 'published' | 'archived';
  content: StoredSection[];
  seo: PageSeo;
  revision: number;
  published_revision: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PublicationRow {
  id: string;
  site_id: string;
  version: number;
  snapshot: PublishedSnapshot;
  published_by: string | null;
  created_at: string;
  unpublished_at: string | null;
}

export interface PublishedSnapshot {
  siteId: string;
  version: number;
  publishedAt: string;
  name: string;
  theme: Record<string, unknown>;
  seo: PageSeo;
  settings: Record<string, unknown>;
  forms: Array<{ id: string; name: string; fields: unknown; successMessage: string }>;
  pages: Array<{
    id: string;
    title: string;
    path: string;
    isHome: boolean;
    seo: PageSeo;
    content: StoredSection[];
  }>;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/;
const PATH_RE = /^\/[A-Za-z0-9._~/-]*$/;

export function normalizePath(input: string): string {
  let value = (input || '/').trim();
  if (!value.startsWith('/')) value = `/${value}`;
  value = value.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  if (value === '') value = '/';
  return value.toLowerCase();
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return base.length >= 2 ? base : `site-${Math.random().toString(36).slice(2, 8)}`;
}

async function uniqueSiteSlug(db: Queryable, desired: string): Promise<string> {
  let candidate = slugify(desired);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM builder_sites WHERE lower(slug) = $1 LIMIT 1`,
      [candidate]
    );
    if (!rows[0]) return candidate;
    candidate = `${slugify(desired).slice(0, 46)}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `site-${randomUUID().slice(0, 8)}`;
}

/* --------------------------------------------------------------------------------------------
 * Sites
 * ------------------------------------------------------------------------------------------ */

export async function listSites(db: Queryable, userId: string): Promise<SiteRow[]> {
  const { rows } = await db.query<SiteRow>(
    `SELECT * FROM builder_sites WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

export async function findSite(db: Queryable, siteId: string): Promise<SiteRow | null> {
  const { rows } = await db.query<SiteRow>(`SELECT * FROM builder_sites WHERE id = $1 LIMIT 1`, [siteId]);
  return rows[0] ?? null;
}

/** Ownership-scoped read: someone else's site is indistinguishable from a missing one. */
export async function requireOwnedSite(db: Queryable, userId: string, siteId: string): Promise<SiteRow> {
  const site = await findSite(db, siteId);
  if (!site || site.user_id !== userId) throw new NotFoundError('No website was found with that id');
  return site;
}

export async function createSite(
  db: Queryable,
  userId: string,
  input: { name: string; templateSlug?: string | null; theme?: Record<string, unknown> }
): Promise<{ site: SiteRow; homePageId: string }> {
  const limits = await getSiteLimits(db, userId);
  const existing = (await listSites(db, userId)).filter((site) => site.status !== 'suspended');
  if (existing.length >= limits.sites) {
    throw new ForbiddenError(
      `Your current CloudHost247 plan includes ${limits.sites} website${limits.sites === 1 ? '' : 's'}. Upgrade to create another.`
    );
  }

  const name = input.name.trim();
  if (name.length < 2) throw new ValidationError('Give the website a name of at least 2 characters');

  const siteId = randomUUID();
  const pageId = randomUUID();
  const slug = await uniqueSiteSlug(db, name);

  const template = input.templateSlug ? await loadTemplateSchema(db, input.templateSlug) : null;
  const starter: StoredSection[] = template
    ? validateSections(template.schema)
    : validateSections([
        {
          type: 'hero',
          props: {
            heading: name,
            subheading: 'Edit this text in the CloudHost247 Website Builder, or use the AI Website Builder to draft the whole site.',
            align: 'center',
          },
        },
        { type: 'footer', props: { copyright: `© ${new Date().getFullYear()} ${name}` } },
      ]);

  await withTransaction(db, async (tx) => {
    await tx.query(
      `INSERT INTO builder_sites (id, user_id, name, slug, theme, seo, settings)
       VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,'{}'::jsonb)`,
      [siteId, userId, name, slug, JSON.stringify(input.theme ?? (template?.palette ?? {}))]
    );
    await tx.query(
      `INSERT INTO builder_pages (id, site_id, title, path, is_home, status, content, revision)
       VALUES ($1,$2,'Home','/',true,'draft',$3,1)`,
      [pageId, siteId, JSON.stringify(starter)]
    );
    await tx.query(
      `INSERT INTO builder_page_revisions (id, page_id, revision, content, seo, note, created_by)
       VALUES ($1,$2,1,$3,'{}'::jsonb,'Initial page',$4)`,
      [randomUUID(), pageId, JSON.stringify(starter), userId]
    );
    await tx.query(
      `INSERT INTO builder_forms (id, site_id, name, fields, success_message)
       VALUES ($1,$2,'Contact form',$3,'Thank you — your message has been received.')`,
      [
        randomUUID(),
        siteId,
        JSON.stringify([
          { key: 'name', label: 'Your name', kind: 'text', required: true },
          { key: 'email', label: 'Email', kind: 'email', required: true },
          { key: 'message', label: 'Message', kind: 'textarea', required: true },
        ]),
      ]
    );
  });

  const site = await findSite(db, siteId);
  if (!site) throw new Error('Site creation failed');
  return { site, homePageId: pageId };
}

export async function updateSite(
  db: Queryable,
  userId: string,
  siteId: string,
  patch: {
    name?: string;
    theme?: Record<string, unknown>;
    seo?: unknown;
    settings?: Record<string, unknown>;
    domainId?: string | null;
  }
): Promise<SiteRow> {
  const site = await requireOwnedSite(db, userId, siteId);

  if (patch.domainId !== undefined && patch.domainId !== null) {
    // The domain must be one of THIS customer's domains — the same `customer_domains` record the
    // My Domains dashboard, DNS and SSL flows operate on. A site can never be pointed at a domain
    // the customer does not control.
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM customer_domains WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [patch.domainId, userId]
    );
    if (!rows[0]) throw new NotFoundError('That domain is not on your account');
  }

  const { rows } = await db.query<SiteRow>(
    `UPDATE builder_sites SET
        name = COALESCE($2, name),
        theme = COALESCE($3, theme),
        seo = COALESCE($4, seo),
        settings = COALESCE($5, settings),
        domain_id = CASE WHEN $6::boolean THEN $7 ELSE domain_id END,
        updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [
      site.id,
      patch.name?.trim() || null,
      patch.theme === undefined ? null : JSON.stringify(patch.theme),
      patch.seo === undefined ? null : JSON.stringify(validateSeo(patch.seo)),
      patch.settings === undefined ? null : JSON.stringify(patch.settings),
      Object.prototype.hasOwnProperty.call(patch, 'domainId'),
      patch.domainId ?? null,
    ]
  );
  const updated = rows[0];
  if (!updated) throw new NotFoundError('No website was found with that id');
  return updated;
}

export async function archiveSite(db: Queryable, userId: string, siteId: string): Promise<void> {
  await requireOwnedSite(db, userId, siteId);
  // Never a hard delete: pages, revisions and publications are the customer's content.
  await withTransaction(db, async (tx) => {
    await tx.query(
      `UPDATE builder_sites SET status = 'suspended', published_publication_id = NULL, updated_at = now() WHERE id = $1`,
      [siteId]
    );
    await tx.query(`UPDATE builder_publications SET unpublished_at = now() WHERE site_id = $1 AND unpublished_at IS NULL`, [siteId]);
  });
}

/* --------------------------------------------------------------------------------------------
 * Pages
 * ------------------------------------------------------------------------------------------ */

export async function listPages(db: Queryable, siteId: string, includeArchived = false): Promise<PageRow[]> {
  const { rows } = await db.query<PageRow>(
    `SELECT * FROM builder_pages WHERE site_id = $1 ${includeArchived ? '' : `AND status <> 'archived'`}
      ORDER BY is_home DESC, sort_order ASC, created_at ASC`,
    [siteId]
  );
  return rows;
}

export async function requireOwnedPage(db: Queryable, userId: string, pageId: string): Promise<{ page: PageRow; site: SiteRow }> {
  const { rows } = await db.query<PageRow>(`SELECT * FROM builder_pages WHERE id = $1 LIMIT 1`, [pageId]);
  const page = rows[0];
  if (!page) throw new NotFoundError('No page was found with that id');
  const site = await requireOwnedSite(db, userId, page.site_id);
  return { page, site };
}

export async function createPage(
  db: Queryable,
  userId: string,
  siteId: string,
  input: { title: string; path?: string; content?: unknown; seo?: unknown; isHome?: boolean }
): Promise<PageRow> {
  const site = await requireOwnedSite(db, userId, siteId);
  const limits = await getSiteLimits(db, userId);
  const pages = await listPages(db, site.id);
  if (pages.length >= limits.pagesPerSite) {
    throw new ForbiddenError(
      `Your current CloudHost247 plan includes ${limits.pagesPerSite} pages per website. Upgrade to add more.`
    );
  }

  const title = input.title.trim();
  if (title.length < 1) throw new ValidationError('A page needs a title');
  const path = normalizePath(input.path ?? `/${slugify(title)}`);
  if (!PATH_RE.test(path)) throw new ValidationError('Page paths may only contain letters, numbers, -, _, . and /');
  const content = validateSections(input.content ?? []);
  const seo = validateSeo(input.seo);

  const { rows: clash } = await db.query<{ id: string }>(
    `SELECT id FROM builder_pages WHERE site_id = $1 AND lower(path) = lower($2) LIMIT 1`,
    [site.id, path]
  );
  if (clash[0]) throw new ConflictError(`This website already has a page at ${path}`);
  if (input.isHome) {
    const { rows: home } = await db.query<{ id: string }>(
      `SELECT id FROM builder_pages WHERE site_id = $1 AND is_home LIMIT 1`,
      [site.id]
    );
    if (home[0]) throw new ConflictError('This website already has a home page');
  }

  const pageId = randomUUID();
  const { rows } = await db.query<PageRow>(
    `INSERT INTO builder_pages (id, site_id, title, path, is_home, content, seo, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT COALESCE(max(sort_order),0)+1 FROM builder_pages WHERE site_id = $2))
     RETURNING *`,
    [pageId, site.id, title, path, input.isHome ?? false, JSON.stringify(content), JSON.stringify(seo)]
  );
  await db.query(
    `INSERT INTO builder_page_revisions (id, page_id, revision, content, seo, note, created_by)
     VALUES ($1,$2,1,$3,$4,'Page created',$5)`,
    [randomUUID(), pageId, JSON.stringify(content), JSON.stringify(seo), userId]
  );
  const page = rows[0];
  if (!page) throw new Error('Page creation failed');
  return page;
}

/**
 * Saves a draft page. Every accepted save writes an appended revision; the draft row's `revision`
 * is the version of the saved content, so "restore version N" is a real, auditable operation.
 */
export async function updatePage(
  db: Queryable,
  userId: string,
  pageId: string,
  patch: { title?: string; path?: string; content?: unknown; seo?: unknown; note?: string | null }
): Promise<PageRow> {
  const { page, site } = await requireOwnedPage(db, userId, pageId);

  let path = page.path;
  if (patch.path !== undefined) {
    path = normalizePath(patch.path);
    if (!PATH_RE.test(path)) throw new ValidationError('Page paths may only contain letters, numbers, -, _, . and /');
    const { rows: clash } = await db.query<{ id: string }>(
      `SELECT id FROM builder_pages WHERE site_id = $1 AND lower(path) = lower($2) AND id <> $3 LIMIT 1`,
      [site.id, path, page.id]
    );
    if (clash[0]) throw new ConflictError(`This website already has a page at ${path}`);
  }

  const content = patch.content === undefined ? null : validateSections(patch.content);
  const seo = patch.seo === undefined ? null : validateSeo(patch.seo);
  const nextRevision = page.revision + 1;

  const { rows } = await db.query<PageRow>(
    `UPDATE builder_pages SET
        title = COALESCE($2, title),
        path = $3,
        content = COALESCE($4, content),
        seo = COALESCE($5, seo),
        revision = $6,
        updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [
      page.id,
      patch.title?.trim() || null,
      path,
      content === null ? null : JSON.stringify(content),
      seo === null ? null : JSON.stringify(seo),
      nextRevision,
    ]
  );
  const updated = rows[0];
  if (!updated) throw new NotFoundError('No page was found with that id');

  await db.query(
    `INSERT INTO builder_page_revisions (id, page_id, revision, content, seo, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      randomUUID(),
      page.id,
      nextRevision,
      JSON.stringify(content ?? page.content),
      JSON.stringify(seo ?? page.seo),
      patch.note ?? null,
      userId,
    ]
  );

  await db.query(`UPDATE builder_sites SET draft_revision = draft_revision + 1, updated_at = now() WHERE id = $1`, [site.id]);
  return updated;
}

export async function listRevisions(db: Queryable, userId: string, pageId: string) {
  await requireOwnedPage(db, userId, pageId);
  const { rows } = await db.query(
    `SELECT id, revision, note, created_at, created_by FROM builder_page_revisions
      WHERE page_id = $1 ORDER BY revision DESC`,
    [pageId]
  );
  return rows;
}

export async function getRevision(db: Queryable, userId: string, pageId: string, revision: number) {
  await requireOwnedPage(db, userId, pageId);
  const { rows } = await db.query(
    `SELECT id, revision, content, seo, note, created_at FROM builder_page_revisions
      WHERE page_id = $1 AND revision = $2 LIMIT 1`,
    [pageId, revision]
  );
  if (!rows[0]) throw new NotFoundError('No such version of this page');
  return rows[0];
}

/** Restoring a version copies it forward as a NEW revision — history is never rewritten. */
export async function restoreRevision(db: Queryable, userId: string, pageId: string, revision: number): Promise<PageRow> {
  const stored = await getRevision(db, userId, pageId, revision) as { content: StoredSection[]; seo: PageSeo };
  return updatePage(db, userId, pageId, {
    content: stored.content,
    seo: stored.seo,
    note: `Restored version ${revision}`,
  });
}

export async function archivePage(db: Queryable, userId: string, pageId: string): Promise<void> {
  const { page } = await requireOwnedPage(db, userId, pageId);
  if (page.is_home) throw new ValidationError('The home page cannot be archived — publish a different page as home first');
  await db.query(`UPDATE builder_pages SET status = 'archived', updated_at = now() WHERE id = $1`, [pageId]);
}

/* --------------------------------------------------------------------------------------------
 * Publishing
 * ------------------------------------------------------------------------------------------ */

/**
 * Publishes the site: every draft page's current content is snapshotted into an immutable
 * publication. The draft tables are not touched, so editing after a publish does not change what
 * visitors see until the next publish.
 */
export async function publishSite(db: Queryable, userId: string, siteId: string): Promise<PublicationRow> {
  const site = await requireOwnedSite(db, userId, siteId);
  const pages = await listPages(db, site.id);
  if (pages.length === 0) throw new ValidationError('Add at least one page before publishing');
  const home = pages.find((page) => page.is_home);
  if (!home) throw new ValidationError('This website has no home page — mark one page as home before publishing');

  const { rows: forms } = await db.query<{ id: string; name: string; fields: unknown; success_message: string }>(
    `SELECT id, name, fields, success_message FROM builder_forms WHERE site_id = $1 AND status = 'active'`,
    [site.id]
  );

  const { rows: versionRows } = await db.query<{ next: number }>(
    `SELECT COALESCE(max(version), 0) + 1 AS next FROM builder_publications WHERE site_id = $1`,
    [site.id]
  );
  const version = versionRows[0]?.next ?? 1;

  const snapshot: PublishedSnapshot = {
    siteId: site.id,
    version,
    publishedAt: new Date().toISOString(),
    name: site.name,
    theme: site.theme,
    seo: site.seo,
    settings: site.settings,
    forms: forms.map((form) => ({
      id: form.id,
      name: form.name,
      fields: form.fields,
      successMessage: form.success_message,
    })),
    pages: pages.map((page) => ({
      id: page.id,
      title: page.title,
      path: page.path,
      isHome: page.is_home,
      seo: page.seo,
      content: page.content,
    })),
  };

  const publicationId = randomUUID();
  await withTransaction(db, async (tx) => {
    await tx.query(
      `INSERT INTO builder_publications (id, site_id, version, snapshot, published_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [publicationId, site.id, version, JSON.stringify(snapshot), userId]
    );
    await tx.query(
      `UPDATE builder_sites SET status = 'published', published_publication_id = $2, updated_at = now() WHERE id = $1`,
      [site.id, publicationId]
    );
    await tx.query(
      `UPDATE builder_pages SET status = 'published', published_revision = revision WHERE site_id = $1 AND status <> 'archived'`,
      [site.id]
    );
  });

  const { rows } = await db.query<PublicationRow>(`SELECT * FROM builder_publications WHERE id = $1`, [publicationId]);
  const publication = rows[0];
  if (!publication) throw new Error('Publishing failed');
  return publication;
}

export async function unpublishSite(db: Queryable, userId: string, siteId: string): Promise<void> {
  const site = await requireOwnedSite(db, userId, siteId);
  await withTransaction(db, async (tx) => {
    await tx.query(`UPDATE builder_sites SET status = 'draft', published_publication_id = NULL, updated_at = now() WHERE id = $1`, [site.id]);
    await tx.query(`UPDATE builder_publications SET unpublished_at = now() WHERE site_id = $1 AND unpublished_at IS NULL`, [site.id]);
    await tx.query(`UPDATE builder_pages SET status = 'draft' WHERE site_id = $1 AND status = 'published'`, [site.id]);
  });
}

export async function listPublications(db: Queryable, userId: string, siteId: string) {
  await requireOwnedSite(db, userId, siteId);
  const { rows } = await db.query(
    `SELECT id, version, published_by, created_at, unpublished_at FROM builder_publications
      WHERE site_id = $1 ORDER BY version DESC`,
    [siteId]
  );
  return rows;
}

/**
 * Public read path. Serves the published snapshot only — never the draft tables, never an
 * unpublished site, never a scheduled or archived publication.
 */
export async function getPublishedSite(
  db: Queryable,
  identifier: { slug?: string; host?: string }
): Promise<{ site: SiteRow; publication: PublicationRow } | null> {
  const { rows } = identifier.host
    ? await db.query<SiteRow & { publication_id: string }>(
        `SELECT s.*, s.published_publication_id AS publication_id
           FROM builder_sites s
           JOIN customer_domains d ON d.id = s.domain_id
          WHERE lower(d.domain_name) = lower($1) AND s.status = 'published' AND s.published_publication_id IS NOT NULL
          LIMIT 1`,
        [identifier.host]
      )
    : await db.query<SiteRow & { publication_id: string }>(
        `SELECT s.*, s.published_publication_id AS publication_id
           FROM builder_sites s
          WHERE lower(s.slug) = lower($1) AND s.status = 'published' AND s.published_publication_id IS NOT NULL
          LIMIT 1`,
        [identifier.slug ?? '']
      );
  const site = rows[0];
  if (!site) return null;
  const { rows: pubs } = await db.query<PublicationRow>(
    `SELECT * FROM builder_publications WHERE id = $1 AND unpublished_at IS NULL LIMIT 1`,
    [site.publication_id]
  );
  const publication = pubs[0];
  if (!publication) return null;
  return { site, publication };
}

/* --------------------------------------------------------------------------------------------
 * Media
 * ------------------------------------------------------------------------------------------ */

export async function listMedia(db: Queryable, userId: string, siteId: string) {
  await requireOwnedSite(db, userId, siteId);
  const { rows } = await db.query(
    `SELECT id, filename, content_type, byte_size, alt_text, created_at FROM builder_media
      WHERE site_id = $1 ORDER BY created_at DESC`,
    [siteId]
  );
  return rows;
}

export async function uploadMedia(
  db: Queryable,
  userId: string,
  siteId: string,
  input: { filename: string; contentType: string; base64: string; altText?: string | null }
): Promise<{ id: string }> {
  await requireOwnedSite(db, userId, siteId);
  const validated = decodeAndValidateUpload(input.base64, input.contentType, input.filename);
  const id = randomUUID();
  await db.query(
    `INSERT INTO builder_media (id, site_id, uploaded_by, filename, content_type, byte_size, checksum, alt_text, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      siteId,
      userId,
      validated.filename,
      validated.contentType,
      validated.byteSize,
      validated.checksum,
      input.altText ? input.altText.trim().slice(0, 255) : null,
      validated.data,
    ]
  );
  return { id };
}

export async function readMedia(db: Queryable, siteId: string, mediaId: string) {
  const { rows } = await db.query<{ content_type: string; filename: string; data: Buffer }>(
    `SELECT content_type, filename, data FROM builder_media WHERE id = $1 AND site_id = $2 LIMIT 1`,
    [mediaId, siteId]
  );
  return rows[0] ?? null;
}

export async function deleteMedia(db: Queryable, userId: string, mediaId: string): Promise<void> {
  const { rows } = await db.query<{ site_id: string }>(`SELECT site_id FROM builder_media WHERE id = $1`, [mediaId]);
  const media = rows[0];
  if (!media) throw new NotFoundError('No media file was found with that id');
  await requireOwnedSite(db, userId, media.site_id);
  await db.query(`DELETE FROM builder_media WHERE id = $1`, [mediaId]);
}

/* --------------------------------------------------------------------------------------------
 * Forms
 * ------------------------------------------------------------------------------------------ */

export interface FormField {
  key: string;
  label: string;
  kind: 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox';
  required?: boolean;
  options?: string[];
}

const FORM_FIELD_KINDS = ['text', 'email', 'phone', 'textarea', 'select', 'checkbox'] as const;

export function validateFormFields(input: unknown): FormField[] {
  if (!Array.isArray(input) || input.length === 0) throw new ValidationError('A form needs at least one field');
  if (input.length > 20) throw new ValidationError('A form cannot have more than 20 fields');
  return input.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new ValidationError(`Field ${index + 1} is not valid`);
    const record = entry as Record<string, unknown>;
    const key = typeof record.key === 'string' ? record.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') : '';
    if (!key) throw new ValidationError(`Field ${index + 1} needs a key`);
    const label = typeof record.label === 'string' && record.label.trim() ? record.label.trim().slice(0, 120) : key;
    const kind = (record.kind ?? 'text') as FormField['kind'];
    if (!FORM_FIELD_KINDS.includes(kind)) throw new ValidationError(`Field "${label}" has an unsupported type`);
    const field: FormField = { key, label, kind, required: record.required === true };
    if (kind === 'select') {
      const options = Array.isArray(record.options)
        ? record.options.filter((option): option is string => typeof option === 'string' && option.trim().length > 0).slice(0, 30)
        : [];
      if (options.length === 0) throw new ValidationError(`Field "${label}" needs at least one option`);
      field.options = options.map((option) => option.trim().slice(0, 80));
    }
    return field;
  });
}

export async function listForms(db: Queryable, userId: string, siteId: string) {
  await requireOwnedSite(db, userId, siteId);
  const { rows } = await db.query(
    `SELECT id, name, fields, notify_email, success_message, status, created_at FROM builder_forms
      WHERE site_id = $1 ORDER BY created_at ASC`,
    [siteId]
  );
  return rows;
}

export async function createForm(
  db: Queryable,
  userId: string,
  siteId: string,
  input: { name: string; fields: unknown; notifyEmail?: string | null; successMessage?: string }
) {
  await requireOwnedSite(db, userId, siteId);
  const fields = validateFormFields(input.fields);
  const { rows } = await db.query(
    `INSERT INTO builder_forms (id, site_id, name, fields, notify_email, success_message)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, fields, notify_email, success_message, status, created_at`,
    [
      randomUUID(),
      siteId,
      input.name.trim().slice(0, 160) || 'Form',
      JSON.stringify(fields),
      input.notifyEmail?.trim().slice(0, 255) || null,
      input.successMessage?.trim().slice(0, 500) || 'Thank you — your message has been received.',
    ]
  );
  return rows[0];
}

export async function updateForm(
  db: Queryable,
  userId: string,
  formId: string,
  patch: { name?: string; fields?: unknown; notifyEmail?: string | null; successMessage?: string; status?: 'active' | 'archived' }
) {
  const { rows: formRows } = await db.query<{ site_id: string }>(`SELECT site_id FROM builder_forms WHERE id = $1`, [formId]);
  const form = formRows[0];
  if (!form) throw new NotFoundError('No form was found with that id');
  await requireOwnedSite(db, userId, form.site_id);

  const { rows } = await db.query(
    `UPDATE builder_forms SET
        name = COALESCE($2, name),
        fields = COALESCE($3, fields),
        notify_email = CASE WHEN $4::boolean THEN $5 ELSE notify_email END,
        success_message = COALESCE($6, success_message),
        status = COALESCE($7, status),
        updated_at = now()
      WHERE id = $1
      RETURNING id, name, fields, notify_email, success_message, status, created_at`,
    [
      formId,
      patch.name?.trim().slice(0, 160) || null,
      patch.fields === undefined ? null : JSON.stringify(validateFormFields(patch.fields)),
      Object.prototype.hasOwnProperty.call(patch, 'notifyEmail'),
      patch.notifyEmail ?? null,
      patch.successMessage?.trim().slice(0, 500) || null,
      patch.status ?? null,
    ]
  );
  return rows[0];
}

export async function listSubmissions(db: Queryable, userId: string, formId: string) {
  const { rows: formRows } = await db.query<{ site_id: string }>(`SELECT site_id FROM builder_forms WHERE id = $1`, [formId]);
  const form = formRows[0];
  if (!form) throw new NotFoundError('No form was found with that id');
  await requireOwnedSite(db, userId, form.site_id);
  const { rows } = await db.query(
    `SELECT id, payload, inbox_conversation_id, created_at FROM builder_form_submissions
      WHERE form_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [formId]
  );
  return rows;
}

/* --------------------------------------------------------------------------------------------
 * Public form submissions (visitor → customer's Unified Inbox)
 * ------------------------------------------------------------------------------------------ */

const MAX_SUBMISSION_KEYS = 40;
const MAX_SUBMISSION_VALUE = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+()\-\s0-9.]{6,40}$/;
/** Conservative inet check: anything else is stored as "unknown" rather than failing the insert. */
const IP_RE = /^[0-9a-fA-F.:]{3,45}$/;

export interface FormSubmissionOutcome {
  received: true;
  successMessage: string;
  submissionId: string;
  conversationId: string | null;
  /** Present only when the form nominates a notification address; never claims an unobserved send. */
  notification: { status: 'sent' | 'manual' | 'failed'; note: string } | null;
}

/**
 * Accepts a visitor's submission for a form that is part of the *published* snapshot, validates it
 * against the form's own field definitions, stores it, and delivers it into the Unified Inbox so the
 * site owner answers it in the same place as every other customer conversation.
 *
 * Drafts and unpublished sites cannot be posted to (the snapshot is the only public surface), and a
 * submission that does not match its form definition is rejected rather than stored half-valid.
 */
export async function submitPublishedForm(
  db: Queryable,
  slug: string,
  formId: string,
  input: Record<string, unknown>,
  context: { sourceIp?: string | null; source?: NodeJS.ProcessEnv; origin?: string | null } = {}
): Promise<FormSubmissionOutcome> {
  const published = await getPublishedSite(db, { slug });
  if (!published) throw new NotFoundError('No published CloudHost247 website was found at that address');
  const stored = published.publication.snapshot.forms.find((entry) => entry.id === formId);
  if (!stored) throw new NotFoundError('That form is not part of this website');

  // The snapshot carries the field definitions; the live row confirms the form still belongs to this
  // site, is still active, and tells us where (if anywhere) to notify.
  const { rows: liveRows } = await db.query<{ notify_email: string | null }>(
    `SELECT notify_email FROM builder_forms WHERE id = $1 AND site_id = $2 AND status = 'active' LIMIT 1`,
    [formId, published.site.id]
  );
  const live = liveRows[0];
  if (!live) throw new NotFoundError('That form is not accepting submissions');

  const definitions = validateFormFields(stored.fields);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Send the form as an object of field values');
  }
  if (Object.keys(input).length > MAX_SUBMISSION_KEYS) {
    throw new ValidationError('That submission contains more fields than this form accepts');
  }

  const values: Record<string, string> = {};
  const lines: string[] = [];
  for (const field of definitions) {
    const raw = (input as Record<string, unknown>)[field.key];
    const text =
      raw === undefined || raw === null
        ? ''
        : typeof raw === 'string'
          ? raw
          : typeof raw === 'boolean'
            ? String(raw)
            : Array.isArray(raw)
              ? raw.filter((entry): entry is string => typeof entry === 'string').join(', ')
              : '';
    const value = text.trim().slice(0, MAX_SUBMISSION_VALUE);
    if (!value) {
      if (field.required) throw new ValidationError(`${field.label} is required`);
      continue;
    }
    if (field.kind === 'email' && !EMAIL_RE.test(value)) throw new ValidationError(`${field.label} must be an email address`);
    if (field.kind === 'phone' && !PHONE_RE.test(value)) throw new ValidationError(`${field.label} must be a phone number`);
    if (field.kind === 'select' && field.options && !field.options.includes(value)) {
      throw new ValidationError(`${field.label} is not one of the offered options`);
    }
    if (field.kind === 'checkbox' && !['true', 'false', 'yes', 'no', 'on'].includes(value.toLowerCase())) {
      throw new ValidationError(`${field.label} must be a yes/no answer`);
    }
    values[field.key] = value;
    lines.push(`${field.label}: ${value}`);
  }
  if (lines.length === 0) throw new ValidationError('Fill in at least one field before sending');

  const emailField = definitions.find((field) => field.kind === 'email');
  const nameField = definitions.find((field) => field.kind === 'text' && /name/i.test(field.key));
  const contactEmail = emailField ? (values[emailField.key] ?? null) : null;
  const contactName = nameField ? (values[nameField.key] ?? null) : null;
  const body = lines.join('\n').slice(0, 20_000);

  const submissionId = randomUUID();
  const sourceIp = context.sourceIp && IP_RE.test(context.sourceIp) ? context.sourceIp : null;

  let conversationId: string | null = null;
  await withTransaction(db, async (tx) => {
    await tx.query(
      `INSERT INTO builder_form_submissions (id, form_id, site_id, payload, source_ip)
       VALUES ($1,$2,$3,$4,$5)`,
      [submissionId, formId, published.site.id, JSON.stringify(values), sourceIp]
    );
    const recorded = await recordMessage(tx, {
      channelKind: 'web_form',
      userId: published.site.user_id,
      externalReference: `builder-form:${formId}`,
      externalMessageId: submissionId,
      subject: `${stored.name} — ${published.publication.snapshot.name}`,
      contactName,
      contactEmail,
      authorName: contactName,
      authorEmail: contactEmail,
      body,
    });
    conversationId = recorded.conversationId;
    await tx.query(`UPDATE builder_form_submissions SET inbox_conversation_id = $2 WHERE id = $1`, [
      submissionId,
      recorded.conversationId,
    ]);
  });

  let notification: FormSubmissionOutcome['notification'] = null;
  if (live.notify_email) {
    const delivery = await sendTransactionalEmail(
      {
        to: live.notify_email,
        subject: `New form submission — ${stored.name}`,
        template: 'website_form_submission',
        text: `${body}\n\n— ${published.publication.snapshot.name} (CloudHost247 Website Builder)${
          context.origin ? `\nSubmitted from ${context.origin}` : ''
        }`,
      },
      { source: context.source }
    );
    notification = { status: delivery.status, note: delivery.note };
  }

  return {
    received: true,
    successMessage: stored.successMessage || 'Thank you — your message has been received.',
    submissionId,
    conversationId,
    notification,
  };
}

/* --------------------------------------------------------------------------------------------
 * Templates
 * ------------------------------------------------------------------------------------------ */

interface TemplateRecord {
  slug: string;
  name: string;
  category: string;
  description: string;
  schema: unknown[];
  palette: Record<string, unknown>;
}

/** Admin-authored templates stored in the database (the first-party ones live in code). */
export async function listStoredTemplates(db: Queryable, includeUnpublished = false) {
  const { rows } = await db.query<TemplateRecord & { id: string; status: string; sort_order: number }>(
    `SELECT id, slug, name, category, description, schema, palette, status, sort_order FROM builder_templates
      ${includeUnpublished ? '' : `WHERE status = 'published'`}
      ORDER BY sort_order ASC, name ASC`
  );
  return rows;
}

export async function loadTemplateSchema(db: Queryable, slug: string): Promise<{ schema: unknown[]; palette: Record<string, unknown> } | null> {
  const { rows } = await db.query<{ schema: unknown[]; palette: Record<string, unknown> }>(
    `SELECT schema, palette FROM builder_templates WHERE slug = $1 AND status = 'published' LIMIT 1`,
    [slug]
  );
  if (rows[0]) return rows[0];
  const { FIRST_PARTY_TEMPLATES } = await import('./templates');
  const builtIn = FIRST_PARTY_TEMPLATES.find((template) => template.slug === slug);
  return builtIn ? { schema: builtIn.schema, palette: builtIn.palette } : null;
}

export async function createTemplate(
  db: Queryable,
  userId: string,
  input: { slug: string; name: string; category: string; description?: string; schema: unknown; palette?: Record<string, unknown>; status?: 'draft' | 'published'; sortOrder?: number }
) {
  const slug = slugify(input.slug);
  const schema = validateSections(input.schema);
  if (schema.length === 0) throw new ValidationError('A template needs at least one section');
  const { rows: clash } = await db.query<{ id: string }>(`SELECT id FROM builder_templates WHERE slug = $1 OR lower(slug) = $1 LIMIT 1`, [slug]);
  if (clash[0]) throw new ConflictError('A template with that slug already exists');
  void userId;
  const { rows } = await db.query(
    `INSERT INTO builder_templates (id, slug, name, category, description, schema, palette, status, sort_order, is_first_party)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)
     RETURNING id, slug, name, category, description, status, sort_order`,
    [
      randomUUID(),
      slug,
      input.name.trim().slice(0, 160) || slug,
      input.category.trim().slice(0, 40) || 'general',
      (input.description ?? '').slice(0, 500),
      JSON.stringify(schema),
      JSON.stringify(input.palette ?? {}),
      input.status ?? 'draft',
      input.sortOrder ?? 0,
    ]
  );
  return rows[0];
}

export async function setTemplateStatus(db: Queryable, templateId: string, status: 'draft' | 'published' | 'archived') {
  const { rows } = await db.query(
    `UPDATE builder_templates SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, slug, name, status`,
    [templateId, status]
  );
  if (!rows[0]) throw new NotFoundError('No template was found with that id');
  return rows[0];
}

/** Imports a template's sections into a NEW page on an existing site. */
export async function importTemplateIntoNewPage(
  db: Queryable,
  userId: string,
  siteId: string,
  templateSlug: string,
  input: { title: string; path?: string }
): Promise<PageRow> {
  const template = await loadTemplateSchema(db, templateSlug);
  if (!template) throw new NotFoundError('No template was found with that slug');
  return createPage(db, userId, siteId, {
    title: input.title,
    path: input.path,
    content: template.schema,
  });
}

export { assertEntitlement };
