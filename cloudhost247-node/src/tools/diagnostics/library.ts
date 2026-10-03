/**
 * Tools Center — history, favorites and saved reports (spec §56, §57, §77).
 *
 * A thin service layer over `src/tools/core/history.ts`: it joins stored rows to the code catalogue
 * so the UI can show names, categories and routes, and it renders exports from stored JSON. Nothing
 * here stores a tool result twice — `tool_history` holds the compact summary, `tool_reports` holds
 * the full payload the user chose to save.
 */
import type { Queryable } from '../../db/types';
import { TOOL_CATALOG, type ToolCategorySlug } from '../catalog';
import {
  clearHistory,
  deleteReport,
  getReport,
  listFavorites,
  listHistory,
  listReports,
  recentlyUsed,
  saveReport,
} from '../core/history';
import { invalidInput, ToolError } from '../core/errors';

export interface HistoryItem {
  id: string;
  toolSlug: string;
  toolName: string;
  category: ToolCategorySlug | null;
  route: string;
  target: string | null;
  status: string;
  summary: unknown;
  createdAt: string;
}

export interface FavoriteItem {
  id: string;
  toolSlug: string;
  toolName: string;
  category: ToolCategorySlug | null;
  route: string;
  createdAt: string;
  /** True when the stored slug no longer exists in the catalogue (renamed or removed tool). */
  stale: boolean;
}

export interface ReportItem {
  id: string;
  toolSlug: string;
  toolName: string;
  target: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const TOOL_BY_SLUG = new Map<string, (typeof TOOL_CATALOG)[number]>(TOOL_CATALOG.map((tool) => [tool.slug, tool] as const));

function describe(slug: string): { toolName: string; category: ToolCategorySlug | null; route: string } {
  const tool = TOOL_BY_SLUG.get(slug);
  return {
    toolName: tool?.name ?? slug,
    category: tool?.category ?? null,
    route: tool?.path ?? `/tools/${slug}`,
  };
}

export async function historyView(
  db: Queryable,
  userId: string,
  options: { limit?: number; offset?: number; toolSlug?: string } = {}
): Promise<{ entries: HistoryItem[]; total: number }> {
  const result = await listHistory(db, userId, { limit: options.limit, offset: options.offset, toolSlug: options.toolSlug });
  return {
    total: result.total,
    entries: result.entries.map((row) => ({ ...describe(row.tool_slug), id: row.id, toolSlug: row.tool_slug, target: row.target, status: row.status, summary: row.summary, createdAt: row.created_at })),
  };
}

export async function favoritesView(db: Queryable, userId: string): Promise<FavoriteItem[]> {
  const rows = await listFavorites(db, userId);
  return rows.map((row) => {
    const tool = TOOL_BY_SLUG.get(row.tool_slug);
    return {
      ...describe(row.tool_slug),
      id: row.id,
      toolSlug: row.tool_slug,
      createdAt: row.created_at,
      stale: !tool,
    };
  });
}

export async function reportsView(db: Queryable, userId: string, options: { limit?: number; offset?: number; toolSlug?: string } = {}): Promise<{ reports: ReportItem[]; total: number }> {
  const result = await listReports(db, userId, { limit: options.limit, offset: options.offset, toolSlug: options.toolSlug });
  return {
    total: result.total,
    reports: result.reports.map((row) => ({ id: row.id, toolSlug: row.tool_slug, toolName: row.tool_name, target: row.target, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at })),
  };
}

export async function saveReportView(db: Queryable, userId: string, input: { toolSlug: string; target: string; status: string; result: unknown }): Promise<ReportItem> {
  const tool = TOOL_BY_SLUG.get(input.toolSlug);
  if (!tool) throw invalidInput(`"${input.toolSlug}" is not a known tool, so its result cannot be saved.`);
  const row = await saveReport(db, {
    userId,
    toolSlug: input.toolSlug,
    toolName: tool.name,
    target: input.target,
    status: input.status,
    result: input.result,
  });
  return { id: row.id, toolSlug: row.tool_slug, toolName: row.tool_name, target: row.target, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function reportExport(
  db: Queryable,
  userId: string,
  reportId: string,
  format: 'json' | 'csv' | 'markdown'
): Promise<{ filename: string; contentType: string; body: string }> {
  const report = await getReport(db, userId, reportId);
  if (!report) throw new ToolError('NOT_FOUND', 'That saved report does not exist (or belongs to another account).');
  const safeTarget = report.target.replace(/[^a-z0-9.-]+/gi, '_').slice(0, 80) || 'report';
  // `pg` returns timestamptz columns as Date objects, while some drivers hand back ISO strings —
  // normalise both instead of assuming one shape (this used to crash the CSV export at runtime).
  const rawCreatedAt: unknown = report.created_at;
  const createdAt = rawCreatedAt instanceof Date ? rawCreatedAt.toISOString() : String(rawCreatedAt ?? '');
  const base = `cloudhost247-${report.tool_slug}-${safeTarget}-${createdAt.slice(0, 10) || 'report'}`;

  if (format === 'json') {
    return { filename: `${base}.json`, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ tool: report.tool_slug, toolName: report.tool_name, target: report.target, status: report.status, savedAt: report.created_at, result: report.result }, null, 2) };
  }
  if (format === 'csv') {
    return { filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8', body: flattenToCsv(report.result as Record<string, unknown>) };
  }
  if (format === 'markdown') {
    return { filename: `${base}.md`, contentType: 'text/markdown; charset=utf-8', body: renderMarkdown(report) };
  }
  throw invalidInput('Supported export formats are json, csv and markdown. PDF and PNG are produced by your browser\'s print dialog from the report page.');
}

/** Flattens a result object into a two-column CSV (path, value), which survives any shape. */
export function flattenToCsv(value: unknown, prefix = ''): string {
  const rows: Array<[string, string]> = [];
  const escape = (text: string): string => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
  const visit = (entry: unknown, path: string): void => {
    if (entry === null || entry === undefined) {
      rows.push([path || '(root)', '']);
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (typeof entry === 'object') {
      for (const [key, item] of Object.entries(entry as Record<string, unknown>)) visit(item, path ? `${path}.${key}` : key);
      return;
    }
    rows.push([path || '(root)', String(entry)]);
  };
  visit(value, prefix);
  return ['field,value', ...rows.map(([field, text]) => `${escape(field)},${escape(text)}`)].join('\n');
}

function renderMarkdown(report: { tool_slug: string; tool_name: string; target: string; status: string; created_at: string; result: unknown }): string {
  const lines = [
    `# ${report.tool_name} — ${report.target}`,
    '',
    `- Tool: \`${report.tool_slug}\``,
    `- Status: ${report.status}`,
    `- Saved: ${report.created_at}`,
    '- Source: CloudHost247 Tools Center',
    '',
    '## Result',
    '',
    '```json',
    JSON.stringify(report.result, null, 2),
    '```',
    '',
    '_This report contains the tool result as it was when it was saved. Re-running the tool may produce a different result._',
  ];
  return lines.join('\n');
}

/** Builds a plain-text summary suitable for attaching to a support ticket. */
export function reportTicketText(report: { tool_name: string; target: string; status: string; created_at: string; result: unknown }): string {
  const result = report.result as Record<string, unknown>;
  const summary = typeof result.summary === 'string' ? result.summary : null;
  const warnings = Array.isArray(result.warnings) ? (result.warnings as unknown[]).filter((entry): entry is string => typeof entry === 'string') : [];
  return [
    `CloudHost247 tool report: ${report.tool_name}`,
    `Target: ${report.target}`,
    `Status: ${report.status}`,
    `Saved: ${report.created_at}`,
    summary ? `Summary: ${summary}` : null,
    warnings.length > 0 ? `Warnings:\n- ${warnings.slice(0, 10).join('\n- ')}` : null,
    '',
    'The full result is attached to this ticket as JSON.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

export async function clearHistoryView(db: Queryable, userId: string, entryId?: string): Promise<number> {
  return clearHistory(db, userId, entryId);
}

export async function deleteReportView(db: Queryable, userId: string, reportId: string): Promise<boolean> {
  return deleteReport(db, userId, reportId);
}

export async function recentlyUsedTools(db: Queryable, userId: string, limit = 6): Promise<Array<{ toolSlug: string; toolName: string; route: string; lastUsedAt: string; runs: number }>> {
  const rows = await recentlyUsed(db, userId, limit);
  return rows.map((row) => ({ ...describe(row.toolSlug), toolSlug: row.toolSlug, lastUsedAt: row.lastUsedAt, runs: row.runs }));
}
