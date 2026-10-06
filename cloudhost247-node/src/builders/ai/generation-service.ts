/**
 * AI Website Builder orchestration: brief → ledger row → provider → validated plan → (optionally)
 * applied to a real site.
 *
 * The ledger is written BEFORE the provider is called and updated after, so a failure leaves a
 * record of what was attempted and why it failed. That is what makes it possible for the admin
 * console (and the customer's own history) to tell the truth about what happened, rather than
 * showing an empty list after an outage.
 *
 * Metering is a database count against the customer's allowance (src/builders/entitlements.ts),
 * never an in-memory counter, so it survives restarts and cannot be reset by reconnecting.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import type { Env } from '../../config/env';
import { ValidationError, NotFoundError, ForbiddenError } from '../../lib/errors';
import { withTransaction } from '../../db/transaction';
import { createNotification } from '../../services/notification-service';
import { getSiteLimits } from '../entitlements';
import { listPages, normalizePath, requireOwnedSite } from '../site-service';
import { validateSeo, validateSections, type StoredSection } from '../sections';
import { resolveProvider } from './registry';
import {
  AiProviderError,
  safeAiMessage,
  type GeneratedSitePlan,
  type SiteBrief,
} from './types';

export interface BriefInput {
  businessName: string;
  industry?: string | null;
  description: string;
  audience?: string | null;
  goals?: string[];
  tone?: string | null;
  pages?: string[];
  language?: string | null;
  keywords?: string[];
}

export function validateBrief(input: unknown): BriefInput {
  if (!input || typeof input !== 'object') throw new ValidationError('Describe the website you want');
  const record = input as Record<string, unknown>;
  const businessName = typeof record.businessName === 'string' ? record.businessName.trim() : '';
  const description = typeof record.description === 'string' ? record.description.trim() : '';
  if (businessName.length < 2) throw new ValidationError('Tell us the business or website name (at least 2 characters)');
  if (businessName.length > 160) throw new ValidationError('The business name is too long');
  if (description.length < 20) {
    throw new ValidationError('Describe what the website is for — at least 20 characters so the generator has something real to work from');
  }
  if (description.length > 4000) throw new ValidationError('Keep the description under 4000 characters');
  const list = (value: unknown, max: number): string[] =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).slice(0, max).map((entry) => entry.trim().slice(0, 160))
      : [];
  return {
    businessName,
    industry: typeof record.industry === 'string' ? record.industry.trim().slice(0, 80) : null,
    description,
    audience: typeof record.audience === 'string' ? record.audience.trim().slice(0, 300) : null,
    goals: list(record.goals, 8),
    tone: typeof record.tone === 'string' ? record.tone.trim().slice(0, 60) : null,
    pages: list(record.pages, 8).map((page) => page.toLowerCase()),
    language: typeof record.language === 'string' ? record.language.trim().slice(0, 40) : null,
    keywords: list(record.keywords, 12),
  };
}

export interface ProjectRow {
  id: string;
  user_id: string;
  site_id: string | null;
  name: string;
  industry: string | null;
  brief: BriefInput;
  status: string;
  engine: string | null;
  model: string | null;
  last_generation_id: string | null;
  created_at: string;
  updated_at: string;
}

async function findProject(db: Queryable, projectId: string): Promise<ProjectRow | null> {
  const { rows } = await db.query<ProjectRow>(`SELECT * FROM ai_site_projects WHERE id = $1 LIMIT 1`, [projectId]);
  return rows[0] ?? null;
}

export async function requireOwnedProject(db: Queryable, userId: string, projectId: string): Promise<ProjectRow> {
  const project = await findProject(db, projectId);
  if (!project || project.user_id !== userId) throw new NotFoundError('No AI website project was found with that id');
  return project;
}

export async function createProject(
  db: Queryable,
  userId: string,
  input: { brief: unknown; siteId?: string | null; name?: string }
): Promise<ProjectRow> {
  const brief = validateBrief(input.brief);
  if (input.siteId) {
    // Applying a generated plan to a site requires owning that site.
    await requireOwnedSite(db, userId, input.siteId);
  }
  const { rows } = await db.query<ProjectRow>(
    `INSERT INTO ai_site_projects (id, user_id, site_id, name, industry, brief, status)
     VALUES ($1,$2,$3,$4,$5,$6,'draft') RETURNING *`,
    [
      randomUUID(),
      userId,
      input.siteId ?? null,
      (input.name ?? brief.businessName).slice(0, 200),
      brief.industry ?? null,
      JSON.stringify(brief),
    ]
  );
  const project = rows[0];
  if (!project) throw new Error('Project creation failed');
  return project;
}

export async function listProjects(db: Queryable, userId: string) {
  const { rows } = await db.query<ProjectRow>(
    `SELECT * FROM ai_site_projects WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [userId]
  );
  return rows;
}

export async function listGenerations(db: Queryable, userId: string, projectId?: string) {
  const { rows } = projectId
    ? await db.query(
        `SELECT g.id, g.project_id, g.engine, g.model, g.status, g.error_code, g.error_message, g.output,
                g.input_tokens, g.output_tokens, g.duration_ms, g.created_at, g.completed_at
           FROM ai_site_generations g
           JOIN ai_site_projects p ON p.id = g.project_id
          WHERE g.project_id = $1 AND p.user_id = $2
          ORDER BY g.created_at DESC LIMIT 50`,
        [projectId, userId]
      )
    : await db.query(
        `SELECT id, project_id, engine, model, status, error_code, error_message, output,
                input_tokens, output_tokens, duration_ms, created_at, completed_at
           FROM ai_site_generations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [userId]
      );
  return rows;
}

export interface GenerateResult {
  /** The stored generation row's id (the same `id` the list endpoint returns). */
  id: string;
  status: 'succeeded' | 'failed';
  plan: GeneratedSitePlan | null;
  engine: string;
  engineLabel: string;
  error: { code: string; message: string } | null;
  allowance: { used: number; limit: number };
}

/**
 * Runs one generation. The caller supplies the engine key; the server decides whether that engine
 * can run, whether the customer has allowance left, and whether the resulting plan is storable.
 */
export async function generatePlan(
  db: Queryable,
  env: Env,
  userId: string,
  projectId: string,
  engineKey: string
): Promise<GenerateResult> {
  const project = await requireOwnedProject(db, userId, projectId);
  const limits = await getSiteLimits(db, userId);

  const { rows: usageRows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ai_site_generations
      WHERE user_id = $1 AND status = 'succeeded' AND created_at >= date_trunc('month', now())`,
    [userId]
  );
  const used = Number(usageRows[0]?.count ?? '0');
  if (used >= limits.aiGenerationsPerMonth) {
    throw new ForbiddenError(
      `Your CloudHost247 plan includes ${limits.aiGenerationsPerMonth} AI website generations per month and you have used ${used}. ` +
        `Upgrade for more, or use the built-in generator at any time.`
    );
  }

  // Resolving the provider happens before the ledger row: asking for an engine the platform does
  // not have configured must not consume the customer's allowance.
  const provider = resolveProvider(env, engineKey);
  const brief = project.brief;

  const generationId = randomUUID();
  await db.query(
    `INSERT INTO ai_site_generations (id, project_id, user_id, engine, model, prompt_hash, brief, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$3)`,
    [
      generationId,
      project.id,
      userId,
      provider.engine,
      env.AI_LLM_MODEL ?? null,
      createHash('sha256').update(JSON.stringify(brief)).digest('hex'),
      JSON.stringify(brief),
    ]
  );
  await db.query(`UPDATE ai_site_projects SET status = 'generating', engine = $2, updated_at = now() WHERE id = $1`, [
    project.id,
    provider.engine,
  ]);

  const startedAt = Date.now();
  let providerReference: string | null = null;

  try {
    const plan = await provider.generate({
      brief: brief as SiteBrief,
      onProviderReference: (reference) => {
        providerReference = reference;
      },
    });
    const duration = Date.now() - startedAt;

    await withTransaction(db, async (tx) => {
      await tx.query(
        `UPDATE ai_site_generations
            SET status = 'succeeded', output = $2, provider_reference = $3, duration_ms = $4, completed_at = now()
          WHERE id = $1`,
        [generationId, JSON.stringify(plan), providerReference, duration]
      );
      await tx.query(
        `UPDATE ai_site_projects SET status = 'generated', last_generation_id = $2, updated_at = now() WHERE id = $1`,
        [project.id, generationId]
      );
      await tx.query(`DELETE FROM ai_site_image_suggestions WHERE generation_id = $1`, [generationId]);
      for (const suggestion of plan.imageSuggestions) {
        await tx.query(
          `INSERT INTO ai_site_image_suggestions (id, generation_id, section_key, description, search_terms)
           VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), generationId, suggestion.sectionKey, suggestion.description, JSON.stringify(suggestion.searchTerms)]
        );
      }
    });

    return {
      id: generationId,
      status: 'succeeded',
      plan,
      engine: provider.engine,
      engineLabel: provider.label,
      error: null,
      allowance: { used: used + 1, limit: limits.aiGenerationsPerMonth },
    };
  } catch (error) {
    const providerError =
      error instanceof AiProviderError
        ? error
        : new AiProviderError('PROVIDER_ERROR', error instanceof Error ? error.message : 'Unknown failure');
    await db.query(
      `UPDATE ai_site_generations
          SET status = 'failed', error_code = $2, error_message = $3, duration_ms = $4, completed_at = now()
        WHERE id = $1`,
      [generationId, providerError.code, providerError.message.slice(0, 800), Date.now() - startedAt]
    );
    await db.query(`UPDATE ai_site_projects SET status = 'failed', updated_at = now() WHERE id = $1`, [project.id]);

    // A failed attempt never consumes allowance — only `succeeded` rows are counted.
    if (providerError.code === 'CONFIGURATION_REQUIRED') throw providerError;
    return {
      id: generationId,
      status: 'failed',
      plan: null,
      engine: provider.engine,
      engineLabel: provider.label,
      error: { code: providerError.code, message: safeAiMessage(providerError) },
      allowance: { used, limit: limits.aiGenerationsPerMonth },
    };
  }
}

export interface ApplyResult {
  siteId: string;
  pagesCreated: number;
  pagesSkipped: number;
  formId: string | null;
}

/**
 * Applies a succeeded generation to a site: creates the pages the plan defines (skipping paths the
 * site already has, so re-applying never destroys existing work), sets the theme, and replaces the
 * `REPLACE_WITH_FORM_ID` placeholder with the site's real form id — the one piece of the plan that
 * must reference live platform data.
 */
export async function applyPlanToSite(
  db: Queryable,
  userId: string,
  generationId: string,
  siteId: string
): Promise<ApplyResult> {
  const site = await requireOwnedSite(db, userId, siteId);

  const { rows } = await db.query<{ output: GeneratedSitePlan | null; status: string }>(
    `SELECT g.output, g.status FROM ai_site_generations g
       JOIN ai_site_projects p ON p.id = g.project_id
      WHERE g.id = $1 AND g.user_id = $2 LIMIT 1`,
    [generationId, userId]
  );
  const generation = rows[0];
  if (!generation) throw new NotFoundError('No generation was found with that id');
  if (generation.status !== 'succeeded' || !generation.output) {
    throw new ValidationError('That generation did not succeed, so there is nothing to apply');
  }

  const { rows: formRows } = await db.query<{ id: string }>(
    `SELECT id FROM builder_forms WHERE site_id = $1 AND status = 'active' ORDER BY created_at ASC LIMIT 1`,
    [site.id]
  );
  const formId = formRows[0]?.id ?? null;

  const existingPaths = new Set((await listPages(db, site.id)).map((page) => page.path.toLowerCase()));
  let pagesCreated = 0;
  let pagesSkipped = 0;

  await withTransaction(db, async (tx) => {
    await tx.query(
      `UPDATE builder_sites SET theme = $2, updated_at = now() WHERE id = $1`,
      [site.id, JSON.stringify({ ...site.theme, ...generation.output!.theme })]
    );

    for (const page of generation.output!.pages) {
      // Sections are re-validated on apply, so a plan stored under an older registry version can
      // never write content the current renderer cannot handle.
      const sections = validateSections(
        page.sections.map((section) => ({
          ...section,
          props:
            section.type === 'contact_form' && formId
              ? { ...section.props, formId }
              : section.props,
        }))
      ) as StoredSection[];
      const path = normalizePath(page.path);
      if (path !== '/' && existingPaths.has(path)) {
        pagesSkipped += 1;
        continue;
      }
      if (path === '/') {
        // The home page always exists; apply the generated content to it instead of duplicating it.
        const { rows: homeRows } = await tx.query<{ id: string; revision: number }>(
          `SELECT id, revision FROM builder_pages WHERE site_id = $1 AND is_home LIMIT 1`,
          [site.id]
        );
        const home = homeRows[0];
        if (home) {
          await tx.query(
            `UPDATE builder_pages SET title = $2, content = $3, seo = $4, revision = $5, updated_at = now() WHERE id = $1`,
            [home.id, page.title, JSON.stringify(sections), JSON.stringify(validateSeo(page.seo)), home.revision + 1]
          );
          await tx.query(
            `INSERT INTO builder_page_revisions (id, page_id, revision, content, seo, note, created_by)
             VALUES ($1,$2,$3,$4,$5,'Applied AI generation',$6)`,
            [randomUUID(), home.id, home.revision + 1, JSON.stringify(sections), JSON.stringify(validateSeo(page.seo)), userId]
          );
          existingPaths.add('/');
          pagesCreated += 1;
          continue;
        }
      }

      const pageId = randomUUID();
      await tx.query(
        `INSERT INTO builder_pages (id, site_id, title, path, is_home, content, seo, sort_order)
         VALUES ($1,$2,$3,$4,false,$5,$6,(SELECT COALESCE(max(sort_order),0)+1 FROM builder_pages WHERE site_id = $2))`,
        [pageId, site.id, page.title.slice(0, 200), path, JSON.stringify(sections), JSON.stringify(validateSeo(page.seo))]
      );
      await tx.query(
        `INSERT INTO builder_page_revisions (id, page_id, revision, content, seo, note, created_by)
         VALUES ($1,$2,1,$3,$4,'Applied AI generation',$5)`,
        [randomUUID(), pageId, JSON.stringify(sections), JSON.stringify(validateSeo(page.seo)), userId]
      );
      existingPaths.add(path);
      pagesCreated += 1;
    }

    await tx.query(
      `UPDATE ai_site_projects SET site_id = $2, status = 'applied', updated_at = now() WHERE id = (
         SELECT project_id FROM ai_site_generations WHERE id = $1
       )`,
      [generationId, site.id]
    );
  });

  await createNotification(db, {
    userId,
    type: 'AI_SITE_APPLIED',
    title: 'Your AI-generated website is ready to edit',
    message: [
      `${pagesCreated} page${pagesCreated === 1 ? '' : 's'} were written into ${site.name}.`,
      pagesSkipped > 0 ? `${pagesSkipped} page path(s) already existed and were left untouched.` : '',
      'Nothing is public until you publish the site.',
    ]
      .filter(Boolean)
      .join('\n'),
    resourceType: 'builder_site',
    resourceId: site.id,
  });

  return { siteId: site.id, pagesCreated, pagesSkipped, formId };
}

export { safeAiMessage };
