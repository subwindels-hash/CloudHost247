/**
 * CloudHost247 Logo Maker service — projects, concepts, revisions, exports and (optional) AI
 * palette suggestions.
 *
 * Concepts are produced by the native vector engine. The AI path only ever *suggests* a palette and
 * a style, which the deterministic engine then renders — so an AI suggestion can never introduce a
 * graphic the platform cannot draw or an SVG it cannot validate, and the JSON a model returns can
 * never reach the customer's exported file.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import type { Env } from '../config/env';
import { ValidationError, NotFoundError, ForbiddenError } from '../lib/errors';
import {
  LOGO_FONT_PRESETS,
  LOGO_LAYOUTS,
  LOGO_MARK_STYLES,
  LOGO_PALETTES,
  fontBySlug,
  isValidHex,
  monogramFor,
  paletteBySlug,
  markStyleBySlug,
  STYLE_TO_PALETTE,
} from './catalog';
import { conceptVariants, renderLogo, type LogoConceptSpec, type LogoLayout, type MarkStyle } from './vector-engine';
import { rasterizeLogo } from './raster';

export interface ProjectRow {
  id: string;
  user_id: string;
  company_name: string;
  tagline: string | null;
  industry: string | null;
  style: string;
  palette_slug: string;
  font_slug: string;
  brand_keywords: string[];
  notes: string | null;
  status: string;
  selected_concept_id: string | null;
  created_at: string;
  updated_at: string;
}

const LAYOUTS = LOGO_LAYOUTS.map((layout) => layout.slug);
const MARK_STYLES = LOGO_MARK_STYLES.map((mark) => mark.slug);

export function designCatalogue() {
  return {
    palettes: LOGO_PALETTES,
    fonts: LOGO_FONT_PRESETS,
    layouts: LOGO_LAYOUTS,
    markStyles: LOGO_MARK_STYLES,
    styles: Object.keys(STYLE_TO_PALETTE),
  };
}

/* --------------------------------------------------------------------------------------------
 * Projects and concepts
 * ------------------------------------------------------------------------------------------ */

export async function listProjects(db: Queryable, userId: string): Promise<ProjectRow[]> {
  const { rows } = await db.query<ProjectRow>(`SELECT * FROM logo_projects WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
  return rows;
}

export async function requireOwnedProject(db: Queryable, userId: string, projectId: string): Promise<ProjectRow> {
  const { rows } = await db.query<ProjectRow>(`SELECT * FROM logo_projects WHERE id = $1 LIMIT 1`, [projectId]);
  const project = rows[0];
  if (!project || project.user_id !== userId) throw new NotFoundError('No logo project was found with that id');
  return project;
}

export async function createProject(
  db: Queryable,
  userId: string,
  input: {
    companyName: string;
    tagline?: string | null;
    industry?: string | null;
    style?: string;
    paletteSlug?: string;
    fontSlug?: string;
    brandKeywords?: string[];
    notes?: string | null;
  }
): Promise<ProjectRow> {
  const companyName = input.companyName.trim();
  if (companyName.length < 1) throw new ValidationError('Enter the company or brand name');
  if (companyName.length > 160) throw new ValidationError('The company name must be 160 characters or fewer');
  const style = (input.style ?? 'modern').toLowerCase();
  if (!STYLE_TO_PALETTE[style]) throw new ValidationError('Choose a supported brand style');
  const palette = paletteBySlug(input.paletteSlug ?? '') ? input.paletteSlug! : STYLE_TO_PALETTE[style]![0]!;
  const font = fontBySlug(input.fontSlug ?? '') ? input.fontSlug! : LOGO_FONT_PRESETS[0]!.slug;

  const { rows } = await db.query<ProjectRow>(
    `INSERT INTO logo_projects (id, user_id, company_name, tagline, industry, style, palette_slug, font_slug, brand_keywords, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      randomUUID(),
      userId,
      companyName,
      input.tagline?.trim().slice(0, 200) || null,
      input.industry?.trim().slice(0, 80) || null,
      style,
      palette,
      font,
      JSON.stringify((input.brandKeywords ?? []).slice(0, 10).map((keyword) => keyword.trim().slice(0, 40)).filter(Boolean)),
      input.notes?.slice(0, 2000) ?? null,
    ]
  );
  const project = rows[0];
  if (!project) throw new Error('Logo project creation failed');
  return project;
}

export async function updateProject(
  db: Queryable,
  userId: string,
  projectId: string,
  patch: { companyName?: string; tagline?: string | null; style?: string; paletteSlug?: string; fontSlug?: string; notes?: string | null }
): Promise<ProjectRow> {
  const project = await requireOwnedProject(db, userId, projectId);
  if (patch.paletteSlug && !paletteBySlug(patch.paletteSlug)) throw new ValidationError('Unknown palette');
  if (patch.fontSlug && !fontBySlug(patch.fontSlug)) throw new ValidationError('Unknown typography preset');
  if (patch.style && !STYLE_TO_PALETTE[patch.style]) throw new ValidationError('Unknown brand style');

  const { rows } = await db.query<ProjectRow>(
    `UPDATE logo_projects SET
        company_name = COALESCE($2, company_name),
        tagline = CASE WHEN $3::boolean THEN $4 ELSE tagline END,
        style = COALESCE($5, style),
        palette_slug = COALESCE($6, palette_slug),
        font_slug = COALESCE($7, font_slug),
        notes = CASE WHEN $8::boolean THEN $9 ELSE notes END,
        updated_at = now()
      WHERE id = $1 RETURNING *`,
    [
      project.id,
      patch.companyName?.trim().slice(0, 160) || null,
      Object.prototype.hasOwnProperty.call(patch, 'tagline'),
      patch.tagline?.trim().slice(0, 200) ?? null,
      patch.style ?? null,
      patch.paletteSlug ?? null,
      patch.fontSlug ?? null,
      Object.prototype.hasOwnProperty.call(patch, 'notes'),
      patch.notes ?? null,
    ]
  );
  const updated = rows[0];
  if (!updated) throw new NotFoundError('No logo project was found with that id');
  return updated;
}

function specFor(
  project: ProjectRow,
  variant: { layout: LogoLayout; markStyle: MarkStyle },
  paletteSlug?: string | null,
  fontSlug?: string | null
): LogoConceptSpec {
  return {
    companyName: project.company_name,
    tagline: project.tagline,
    layout: variant.layout,
    markStyle: variant.markStyle,
    palette: paletteBySlug(paletteSlug ?? project.palette_slug) ?? LOGO_PALETTES[0]!,
    font: fontBySlug(fontSlug ?? project.font_slug) ?? LOGO_FONT_PRESETS[0]!,
  };
}

export interface ConceptRow {
  id: string;
  project_id: string;
  variant: number;
  engine: string;
  layout: LogoLayout;
  mark_style: MarkStyle;
  palette_slug: string;
  font_slug: string;
  svg: string;
  is_selected: boolean;
  created_at: string;
  updated_at: string;
}

export async function listConcepts(db: Queryable, userId: string, projectId: string): Promise<ConceptRow[]> {
  await requireOwnedProject(db, userId, projectId);
  const { rows } = await db.query<ConceptRow>(`SELECT * FROM logo_concepts WHERE project_id = $1 ORDER BY variant ASC`, [projectId]);
  return rows;
}

/**
 * Generates the concept set for a project. Re-running replaces the *unselected* concepts but keeps
 * a selected one (and its revision history) untouched — regenerating must never silently destroy a
 * design the customer chose.
 */
export async function generateConcepts(db: Queryable, userId: string, projectId: string): Promise<ConceptRow[]> {
  const project = await requireOwnedProject(db, userId, projectId);
  const variants = conceptVariants(project.style);

  for (const [index, variant] of variants.entries()) {
    const spec = specFor(project, variant);
    const { svg } = renderLogo(spec);
    await db.query(
      `INSERT INTO logo_concepts (id, project_id, variant, engine, layout, mark_style, palette_slug, font_slug, svg)
       VALUES ($1,$2,$3,'vector',$4,$5,$6,$7,$8)
       ON CONFLICT (project_id, variant) DO UPDATE SET
         svg = EXCLUDED.svg, layout = EXCLUDED.layout, mark_style = EXCLUDED.mark_style,
         palette_slug = EXCLUDED.palette_slug, font_slug = EXCLUDED.font_slug, updated_at = now()
       WHERE logo_concepts.is_selected = false`,
      [randomUUID(), project.id, index + 1, variant.layout, variant.markStyle, spec.palette.slug, spec.font.slug, svg]
    );
  }

  await db.query(`UPDATE logo_projects SET status = 'generated', updated_at = now() WHERE id = $1 AND status = 'draft'`, [project.id]);
  return listConcepts(db, userId, project.id);
}

/** Edits one concept (layout, mark, palette, font or the strings) and appends a revision. */
export async function editConcept(
  db: Queryable,
  userId: string,
  conceptId: string,
  patch: {
    layout?: string;
    markStyle?: string;
    paletteSlug?: string;
    fontSlug?: string;
    companyName?: string;
    tagline?: string | null;
    primaryColor?: string;
    accentColor?: string;
    note?: string | null;
  }
): Promise<ConceptRow> {
  const { rows: conceptRows } = await db.query<ConceptRow>(`SELECT * FROM logo_concepts WHERE id = $1 LIMIT 1`, [conceptId]);
  const concept = conceptRows[0];
  if (!concept) throw new NotFoundError('No logo concept was found with that id');
  const project = await requireOwnedProject(db, userId, concept.project_id);

  if (patch.layout && !LAYOUTS.includes(patch.layout as LogoLayout)) throw new ValidationError('Unknown layout');
  if (patch.markStyle && !markStyleBySlug(patch.markStyle)) throw new ValidationError('Unknown mark style');
  if (patch.paletteSlug && !paletteBySlug(patch.paletteSlug)) throw new ValidationError('Unknown palette');
  if (patch.fontSlug && !fontBySlug(patch.fontSlug)) throw new ValidationError('Unknown typography preset');
  if (patch.primaryColor !== undefined && !isValidHex(patch.primaryColor)) throw new ValidationError('Primary colour must be a #rrggbb value');
  if (patch.accentColor !== undefined && !isValidHex(patch.accentColor)) throw new ValidationError('Accent colour must be a #rrggbb value');

  const basePalette = paletteBySlug(patch.paletteSlug ?? concept.palette_slug) ?? LOGO_PALETTES[0]!;
  const palette = {
    ...basePalette,
    primary: patch.primaryColor ?? basePalette.primary,
    accent: patch.accentColor ?? basePalette.accent,
  };
  const layout = (patch.layout ?? concept.layout) as LogoLayout;
  const markStyle = (patch.markStyle ?? concept.mark_style) as MarkStyle;
  const fontSlug = patch.fontSlug ?? concept.font_slug;

  const spec: LogoConceptSpec = {
    companyName: (patch.companyName ?? project.company_name).trim().slice(0, 160),
    tagline: patch.tagline === undefined ? project.tagline : patch.tagline,
    layout,
    markStyle,
    palette,
    font: fontBySlug(fontSlug) ?? LOGO_FONT_PRESETS[0]!,
  };
  const { svg } = renderLogo(spec);

  return db.query<ConceptRow>(
    `WITH updated AS (
       UPDATE logo_concepts SET svg = $2, layout = $3, mark_style = $4, palette_slug = $5, font_slug = $6, updated_at = now()
        WHERE id = $1
        RETURNING *, (SELECT COALESCE(max(revision), 0) + 1 FROM logo_concept_revisions WHERE concept_id = $1) AS next_revision
     ), revision AS (
       INSERT INTO logo_concept_revisions (id, concept_id, revision, svg, layout, mark_style, palette_slug, font_slug, note, created_by)
       SELECT $7, id, next_revision, svg, layout, mark_style, palette_slug, font_slug, $8, $9 FROM updated
       RETURNING concept_id
     )
     SELECT u.* FROM updated u JOIN revision r ON r.concept_id = u.id`,
    [
      conceptId,
      svg,
      layout,
      markStyle,
      palette.slug,
      spec.font.slug,
      randomUUID(),
      patch.note ?? null,
      userId,
    ]
  ).then((result) => {
    const row = result.rows[0];
    if (!row) throw new NotFoundError('No logo concept was found with that id');
    return row;
  });
}

export async function selectConcept(db: Queryable, userId: string, conceptId: string): Promise<{ projectId: string }> {
  const { rows } = await db.query<{ project_id: string }>(`SELECT project_id FROM logo_concepts WHERE id = $1 LIMIT 1`, [conceptId]);
  const concept = rows[0];
  if (!concept) throw new NotFoundError('No logo concept was found with that id');
  await requireOwnedProject(db, userId, concept.project_id);

  await db.query(`UPDATE logo_concepts SET is_selected = false WHERE project_id = $1 AND id <> $2`, [concept.project_id, conceptId]);
  await db.query(`UPDATE logo_concepts SET is_selected = true, updated_at = now() WHERE id = $1`, [conceptId]);
  await db.query(
    `UPDATE logo_projects SET selected_concept_id = $2, status = 'finalized', updated_at = now() WHERE id = $1`,
    [concept.project_id, conceptId]
  );
  return { projectId: concept.project_id };
}

export async function listConceptRevisions(db: Queryable, userId: string, conceptId: string) {
  const { rows } = await db.query<{ project_id: string }>(`SELECT project_id FROM logo_concepts WHERE id = $1 LIMIT 1`, [conceptId]);
  if (!rows[0]) throw new NotFoundError('No logo concept was found with that id');
  await requireOwnedProject(db, userId, rows[0].project_id);
  const { rows: revisions } = await db.query(
    `SELECT id, revision, layout, mark_style, palette_slug, font_slug, note, created_at
       FROM logo_concept_revisions WHERE concept_id = $1 ORDER BY revision DESC`,
    [conceptId]
  );
  return revisions;
}

export async function restoreConceptRevision(db: Queryable, userId: string, conceptId: string, revision: number) {
  const { rows } = await db.query<{ project_id: string }>(`SELECT project_id FROM logo_concepts WHERE id = $1 LIMIT 1`, [conceptId]);
  if (!rows[0]) throw new NotFoundError('No logo concept was found with that id');
  await requireOwnedProject(db, userId, rows[0].project_id);
  const { rows: revisions } = await db.query<{
    id: string; svg: string; layout: string; mark_style: string; palette_slug: string; font_slug: string;
  }>(`SELECT id, svg, layout, mark_style, palette_slug, font_slug FROM logo_concept_revisions WHERE concept_id = $1 AND revision = $2 LIMIT 1`, [
    conceptId,
    revision,
  ]);
  const stored = revisions[0];
  if (!stored) throw new NotFoundError('No such version of this concept');
  return editConcept(db, userId, conceptId, {
    layout: stored.layout,
    markStyle: stored.mark_style,
    paletteSlug: stored.palette_slug,
    fontSlug: stored.font_slug,
    note: `Restored version ${revision}`,
  });
}

/* --------------------------------------------------------------------------------------------
 * Exports
 * ------------------------------------------------------------------------------------------ */

export async function exportConcept(
  db: Queryable,
  userId: string,
  conceptId: string,
  input: { format: 'svg' | 'png'; width?: number; height?: number; background?: 'transparent' | 'palette' }
): Promise<{ id: string; format: 'svg' | 'png'; filename: string; contentType: string; data: Buffer; renderer: 'vector' | 'built_in_rasterizer' }> {
  const { rows } = await db.query<ConceptRow & { user_id: string }>(
    `SELECT c.*, p.user_id FROM logo_concepts c JOIN logo_projects p ON p.id = c.project_id WHERE c.id = $1 LIMIT 1`,
    [conceptId]
  );
  const concept = rows[0];
  if (!concept || concept.user_id !== userId) throw new NotFoundError('No logo concept was found with that id');
  const project = await requireOwnedProject(db, userId, concept.project_id);

  const width = Math.min(4096, Math.max(64, Math.round(input.width ?? 1200)));
  const height = Math.min(4096, Math.max(64, Math.round(input.height ?? 400)));
  const background = input.background ?? 'transparent';
  const exportId = randomUUID();

  if (input.format === 'svg') {
    const spec = specFor(project, { layout: concept.layout, markStyle: concept.mark_style }, concept.palette_slug, concept.font_slug);
    const { svg } = renderLogo(spec, { background });
    await db.query(
      `INSERT INTO logo_exports (id, concept_id, user_id, format, background, svg, byte_size)
       VALUES ($1,$2,$3,'svg',$4,$5,$6)`,
      [exportId, conceptId, userId, background, svg, Buffer.byteLength(svg, 'utf8')]
    );
    return {
      id: exportId,
      format: 'svg',
      filename: `${fileStem(project.company_name)}-logo.svg`,
      contentType: 'image/svg+xml',
      data: Buffer.from(svg, 'utf8'),
      renderer: 'vector',
    };
  }

  const spec = specFor(project, { layout: concept.layout, markStyle: concept.mark_style }, concept.palette_slug, concept.font_slug);
  const png = rasterizeLogo(spec, { width, height, background });
  await db.query(
    `INSERT INTO logo_exports (id, concept_id, user_id, format, width_px, height_px, background, data, byte_size)
     VALUES ($1,$2,$3,'png',$4,$5,$6,$7,$8)`,
    [exportId, conceptId, userId, width, height, background, png, png.length]
  );
  return {
    id: exportId,
    format: 'png',
    filename: `${fileStem(project.company_name)}-logo-${width}x${height}.png`,
    contentType: 'image/png',
    data: png,
    renderer: 'built_in_rasterizer',
  };
}

function fileStem(companyName: string): string {
  return (
    companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'brand'
  );
}

export async function listExports(db: Queryable, userId: string, conceptId: string) {
  const { rows } = await db.query<{ project_id: string }>(`SELECT project_id FROM logo_concepts WHERE id = $1 LIMIT 1`, [conceptId]);
  if (!rows[0]) throw new NotFoundError('No logo concept was found with that id');
  await requireOwnedProject(db, userId, rows[0].project_id);
  const { rows: exports } = await db.query(
    `SELECT id, format, width_px, height_px, background, byte_size, created_at FROM logo_exports
      WHERE concept_id = $1 ORDER BY created_at DESC`,
    [conceptId]
  );
  return exports;
}

/* --------------------------------------------------------------------------------------------
 * Optional AI assistance (fail-closed)
 * ------------------------------------------------------------------------------------------ */

/**
 * Asks the configured model provider for a palette/style *suggestion*, then renders it with the
 * native engine. Without credentials this throws CONFIGURATION_REQUIRED — the UI offers the design
 * catalogue instead of pretending an AI ran.
 */
export async function suggestPalette(
  db: Queryable,
  env: Env,
  userId: string,
  projectId: string,
  options: { brief?: string | null } = {}
): Promise<{ paletteSlug: string; style: string; rationale: string; engine: 'llm'; model: string }> {
  const project = await requireOwnedProject(db, userId, projectId);
  if (!env.AI_LLM_BASE_URL || !env.AI_LLM_API_KEY || !env.AI_LLM_MODEL) {
    // The message names the exact configuration that is missing, so an operator knows what to set
    // and the customer is never led to believe an AI suggestion was produced.
    const error = new Error(
      'AI palette suggestions need an administrator to connect a model provider first. ' +
        'Required configuration: AI_LLM_BASE_URL, AI_LLM_MODEL and AI_LLM_API_KEY (set AI_LLM_API_STYLE=anthropic for an Anthropic-shaped endpoint). ' +
        'Everything else in the Logo Maker works without those credentials.'
    );
    (error as Error & { code?: string }).code = 'CONFIGURATION_REQUIRED';
    throw error;
  }
  if (env.AI_LLM_API_STYLE === 'anthropic') {
    throw new ForbiddenError('AI palette suggestions currently support OpenAI-compatible endpoints only');
  }

  const generationId = randomUUID();
  await db.query(
    `INSERT INTO logo_ai_generations (id, project_id, user_id, engine, model, status, request)
     VALUES ($1,$2,$3,'llm',$4,'pending',$5)`,
    [
      generationId,
      project.id,
      userId,
      env.AI_LLM_MODEL,
      JSON.stringify({ style: project.style, industry: project.industry, brief: options.brief?.slice(0, 1500) ?? null }),
    ]
  );

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.AI_LLM_TIMEOUT_MS);
  try {
    const response = await fetch(`${env.AI_LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.AI_LLM_API_KEY}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: env.AI_LLM_MODEL,
        temperature: 0.5,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You suggest brand palettes for a logo generator. Answer with JSON only: {"paletteSlug": one of ${LOGO_PALETTES.map((p) => p.slug).join(', ')}, "style": one of ${Object.keys(STYLE_TO_PALETTE).join(', ')}, "rationale": string (max 240 chars)}. Never invent brand facts.`,
          },
          {
            role: 'user',
            content: `Company: ${project.company_name}. Industry: ${project.industry ?? 'unspecified'}. Requested style: ${project.style}. Notes: ${project.notes ?? 'none'}.${
              options.brief ? ` The customer describes their brand as: ${options.brief.slice(0, 1200)}` : ''
            }`,
          },
        ],
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Provider returned ${response.status}: ${body.slice(0, 200)}`);
    }
    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()) as Record<string, unknown>;
    const paletteSlug = typeof parsed.paletteSlug === 'string' && paletteBySlug(parsed.paletteSlug) ? parsed.paletteSlug : project.palette_slug;
    const style = typeof parsed.style === 'string' && STYLE_TO_PALETTE[parsed.style] ? parsed.style : project.style;
    const rationale = typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 240) : '';

    await db.query(
      `UPDATE logo_ai_generations SET status = 'succeeded', response = $2, duration_ms = $3, completed_at = now() WHERE id = $1`,
      [generationId, JSON.stringify({ paletteSlug, style, rationale }), Date.now() - startedAt]
    );
    return { paletteSlug, style, rationale, engine: 'llm', model: env.AI_LLM_MODEL };
  } catch (error) {
    await db.query(
      `UPDATE logo_ai_generations SET status = 'failed', error_code = 'PROVIDER_ERROR', error_message = $2, duration_ms = $3, completed_at = now() WHERE id = $1`,
      [generationId, (error instanceof Error ? error.message : 'unknown').slice(0, 500), Date.now() - startedAt]
    );
    throw new ForbiddenError(
      'The model provider could not be reached, so no suggestion was produced. Nothing was changed — try again or pick a palette from the catalogue.'
    );
  } finally {
    clearTimeout(timeout);
  }
}

export { monogramFor };
