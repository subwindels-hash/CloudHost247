/**
 * Regenerates docs/tools/TOOLS_CATALOG.md from the code catalogue.
 *
 * Run from the repository root (see package.json "catalog:docs"):
 *   npx tsx scripts/generate-tools-catalog-doc.ts > docs/tools/TOOLS_CATALOG.md
 *
 * The catalogue is the source of truth for which tools exist, so this document is generated rather
 * than hand-maintained — a hand-written list is exactly how documentation starts lying.
 */
import { TOOL_CATALOG, CATEGORY_LABELS, NON_RUNNABLE_TOOL_SLUGS } from '../src/tools/catalog';
import { missingHandlers } from '../src/tools/handlers';

const lines: string[] = [];
lines.push('# Tools Center — full catalogue', '');
lines.push(`Generated from \`src/tools/catalog.ts\` (${TOOL_CATALOG.length} tools). This table is the authoritative list: if a tool is not here it does not exist, and if a tool is here it has a page at its route.`, '');
lines.push('Columns:', '');
lines.push('- **Route** — the SPA page (and therefore the human-readable URL).', '- **API** — the endpoint the page calls. Everything is under `/api/tools/...`; `/api/v1/...` mirrors it.', '- **Auth** — `no` means the tool runs for a signed-out visitor subject to the anonymous rate limit; `yes` means a session is required.', '- **Provider** — the external service the tool needs. When it is not configured the tool answers `CONFIGURATION_REQUIRED` instead of guessing.', '');
const byCategory = new Map<string, typeof TOOL_CATALOG>();
for (const tool of TOOL_CATALOG) {
  const bucket = byCategory.get(tool.category) ?? [];
  bucket.push(tool);
  byCategory.set(tool.category, bucket);
}
for (const [slug, label] of Object.entries(CATEGORY_LABELS)) {
  const tools = byCategory.get(slug) ?? [];
  lines.push(`## ${label} (${tools.length})`, '');
  lines.push('| Tool | Route | API | Auth | Provider | What it does |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const tool of tools.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`| **${tool.name}** | \`${tool.path}\` | \`${tool.apiPath}\` | ${tool.authRequired ? 'yes' : 'no'} | ${tool.providerKind ?? '—'} | ${tool.summary.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
}
lines.push('## Non-runnable pages', '');
lines.push('These are Tools Center pages rather than executable endpoints. Calling them through the API returns `404` with an explanation, which is deliberate: they are user-interface routes over data the API exposes at other endpoints.', '');
for (const slug of NON_RUNNABLE_TOOL_SLUGS) lines.push(`- \`${slug}\``);
lines.push('');
const missing = missingHandlers();
lines.push('## Coverage check', '');
lines.push(missing.length === 0 ? 'Every runnable tool in the catalogue has a registered server-side handler (asserted by `tests/integration/tools-api.test.ts`).' : `**Missing handlers:** ${missing.join(', ')}`);
lines.push('');
console.log(lines.join('\n'));
