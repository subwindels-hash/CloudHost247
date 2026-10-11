/**
 * Business Tools API — the directory and a server-side run of the same engines the SPA uses.
 *
 *   GET  /api/tools/business-tools              the 21-tool directory, with category counts
 *   GET  /api/tools/business-tools/:slug        one tool's metadata and form schema
 *   POST /api/tools/business-tools/:slug/run    run a tool and return its structured result
 *
 * Why this exists when the SPA already computes everything client-side:
 *
 *  • The engines are the same module in both runtimes, so the API is the executable proof that they
 *    are pure — a compute function that needed the DOM or the clock would not run here.
 *  • It gives integrators and the platform's own tests a JSON contract without a browser.
 *  • It keeps `src/tools/catalog.ts` honest: the catalogue publishes an `apiPath` for every entry,
 *    and an apiPath that resolves to nothing is exactly the drift the catalogue exists to prevent.
 *
 * Privacy: nothing here is persisted. There is no database handle, no cache, no history target and
 * no request-body logging — a payroll submission is processed in memory for the one request and
 * forgotten, the same commitment the MRZ module makes. `NON_PERSISTABLE_TOOL_SLUGS` in the
 * catalogue covers the MRZ tool; the Business Tools routes simply never write anywhere.
 *
 * Body size is capped because these tools accept documents (contracts, CVs, org charts) rather than
 * single values, and an unbounded body on a public route is a memory-exhaustion vector.
 */

import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { HttpError } from '../lib/errors';
import {
  BUSINESS_TOOLS,
  BUSINESS_TOOLS_ROOT,
  BUSINESS_TOOLS_TOTAL,
  findBusinessTool,
  searchBusinessTools,
} from '../tools/business/registry';
import {
  BUSINESS_TOOL_CATEGORIES,
  BUSINESS_TOOL_CATEGORY_LABELS,
} from '../tools/business/types';
import type { BusinessTool, BusinessToolCategory, BusinessToolInput } from '../tools/business/types';

/**
 * Largest accepted submission, in characters of the serialised body.
 *
 * Generators take whole documents (contracts, CVs, org charts) rather than single values, so this
 * is generous — but it is finite, and it is enforced here rather than left to the platform default,
 * because an unbounded body on a public, unauthenticated route is a memory-exhaustion vector.
 */
const MAX_BODY_BYTES = 256 * 1024;

/** Reject an over-long submission before any engine sees it. */
function assertBodyWithinLimit(body: Record<string, unknown>): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(body);
  } catch {
    throw new HttpError(400, 'The request body could not be serialised.', 'INVALID_INPUT');
  }
  if (serialized.length > MAX_BODY_BYTES) {
    throw new HttpError(
      413,
      `Submissions are limited to ${MAX_BODY_BYTES} characters; this one is ${serialized.length}. Split the document into sections.`,
      'PAYLOAD_TOO_LARGE'
    );
  }
}

/** Everything about a tool that is safe and useful to publish. The compute function is not. */
function publicTool(tool: BusinessTool) {
  return {
    slug: tool.slug,
    name: tool.name,
    category: tool.category,
    categoryLabel: BUSINESS_TOOL_CATEGORY_LABELS[tool.category],
    summary: tool.summary,
    description: tool.description,
    icon: tool.icon,
    path: tool.path,
    apiPath: `/api/tools/business-tools/${tool.slug}`,
    units: tool.units,
    keywords: tool.keywords,
    printable: Boolean(tool.printable),
    jurisdiction: tool.jurisdiction ?? null,
    fields: tool.fields,
  };
}

function categoryCounts(): Record<BusinessToolCategory, number> {
  const counts: Record<BusinessToolCategory, number> = { calculators: 0, generators: 0, comparisons: 0 };
  for (const tool of BUSINESS_TOOLS) {
    counts[tool.category] = counts[tool.category] + 1;
  }
  return counts;
}

/**
 * Keep only primitive field values.
 *
 * The engines coerce with `toText` / `toNumber` / `toBoolean`, so an unexpected shape degrades to an
 * empty or zero value rather than throwing. Dropping anything that is not a string, number or
 * boolean first means a nested object or an array cannot reach an engine at all — and a JSON body
 * carrying `__proto__` cannot smuggle a key into one either.
 */
function coerceInput(body: Record<string, unknown>): BusinessToolInput {
  const values: BusinessToolInput = {};
  for (const key of Object.keys(body)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const value = body[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      values[key] = value;
    }
  }
  return values;
}

export async function registerBusinessToolsRoutes(
  instance: FastifyInstance,
  _env: Env,
  // Unused: these routes touch no database. The signature matches the other tool modules so
  // `buildApp` can register them the same way, and the absence of a pool handle is the structural
  // guarantee that a submission cannot be persisted.
  _pool?: Queryable
): Promise<void> {
  instance.get('/api/tools/business-tools', async (request) => {
    const query = (request.query ?? {}) as { q?: string; category?: string };
    const search = typeof query.q === 'string' ? query.q : '';
    const category = typeof query.category === 'string' ? query.category : 'all';

    const known = [...BUSINESS_TOOL_CATEGORIES, 'all'] as string[];
    if (!known.includes(category)) {
      throw new HttpError(
        400,
        `Unknown category "${category}". Use one of: ${known.join(', ')}.`,
        'UNKNOWN_CATEGORY'
      );
    }

    const scoped = searchBusinessTools(search, category === 'all' ? undefined : (category as BusinessToolCategory));
    const counts = categoryCounts();
    return {
      section: 'Business Tools',
      root: BUSINESS_TOOLS_ROOT,
      total: BUSINESS_TOOLS_TOTAL,
      counts,
      categories: BUSINESS_TOOL_CATEGORIES.map((slug: BusinessToolCategory) => ({
        slug,
        label: BUSINESS_TOOL_CATEGORY_LABELS[slug],
        count: counts[slug],
      })),
      query: { q: search, category },
      showing: scoped.length,
      tools: scoped.map(publicTool),
      privacy: {
        computesClientSide: true,
        persistsInput: false,
        persistsResult: false,
        transmitsToThirdParties: false,
      },
    };
  });

  instance.get('/api/tools/business-tools/:slug', async (request) => {
    const { slug } = request.params as { slug: string };
    const tool = findBusinessTool(slug);
    if (!tool) {
      throw new HttpError(
        404,
        `No Business Tool is registered at "${slug}". The section has ${BUSINESS_TOOLS_TOTAL} tools; see /api/tools/business-tools.`,
        'TOOL_NOT_FOUND'
      );
    }
    return { tool: publicTool(tool) };
  });

  instance.post('/api/tools/business-tools/:slug/run', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const tool = findBusinessTool(slug);
    if (!tool) {
      throw new HttpError(404, `No Business Tool is registered at "${slug}".`, 'TOOL_NOT_FOUND');
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'Submit a JSON object of field values keyed by field name.', 'INVALID_INPUT');
    }
    assertBodyWithinLimit(body);

    const outcome = tool.compute(coerceInput(body));
    reply.header('Cache-Control', 'no-store');
    if (!outcome.ok) {
      // A validation failure is the caller's input, not a server fault: 422 with the field errors,
      // so an integrator can point at the offending field exactly as the workspace does.
      reply.code(422);
      return {
        ok: false,
        tool: tool.slug,
        error: outcome.error.message,
        fieldErrors: outcome.error.fieldErrors ?? [],
        jurisdiction: tool.jurisdiction ?? null,
      };
    }
    return { ok: true, tool: tool.slug, result: outcome.result };
  });
}
