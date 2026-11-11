/**
 * Regenerates the rule-seed block of `database/migrations/0101_create_fraud_sentinel.sql` from the
 * reviewed catalogue in `src/fraud-sentinel/rules/catalogue.ts`.
 *
 * Why this exists: the migration seeds the 40 default rules as literal INSERT rows, and
 * `tests/integration/fraud-sentinel-migration.test.ts` asserts those rows are equivalent to the
 * catalogue field by field — a drift there means the dashboard documents one rule while the engine
 * scores another. So an operator who edits a weight, a description or a parameter in the catalogue gets
 * a loud, correct test failure, and this script is the fix: one command instead of hand-editing forty
 * multi-line INSERT rows and their quoting.
 *
 * It rewrites ONLY the block between `INSERT INTO fraud_sentinel_rules` and its terminating
 * `ON CONFLICT (code) DO NOTHING;`. Nothing else in the migration — not the DDL, not the indexes, not
 * the settings seed, not the reviewed rollback script in the header — is touched.
 *
 * The seed is deterministic: rule ids are derived from the catalogue position
 * (`11111111-0000-4000-8000-0000000000NN`), so re-running against an unchanged catalogue is a no-op
 * that produces a byte-identical file. Reordering the catalogue therefore changes ids, which is why
 * rules are appended, never inserted in the middle.
 *
 * Usage:
 *   npx tsx scripts/fraud-sentinel-seed.ts            # rewrite the seed block
 *   npx tsx scripts/fraud-sentinel-seed.ts --check    # exit 1 if the file differs, write nothing
 *
 * After writing, re-run the migration suite:
 *   ./node_modules/.bin/vitest run tests/integration/fraud-sentinel-migration.test.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { RULE_CATALOGUE } from '../src/fraud-sentinel/rules/catalogue';

const MIGRATION = 'database/migrations/0101_create_fraud_sentinel.sql';
const START_MARKER = 'INSERT INTO fraud_sentinel_rules';
const END_MARKER = 'ON CONFLICT (code) DO NOTHING;';

/** Deterministic uuid per catalogue position, so the seed is stable and re-runnable. */
function ruleId(index: number): string {
  return `11111111-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

/** SQL single-quoted literal. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildSeed(): string {
  const header = [
    START_MARKER,
    '  (id, code, name, description, category, family, version, enabled, weight, severity, parameters, recommendation, data_sources, applies_to)',
    'VALUES',
  ];
  const rows = RULE_CATALOGUE.map((rule, index) =>
    [
      `  (${quote(ruleId(index))}, ${quote(rule.code)},`,
      `   ${quote(rule.name)},`,
      `   ${quote(rule.description)},`,
      `   ${quote(rule.category)}, ${quote(rule.family)}, ${rule.version}, ${rule.enabled}, ${rule.weight}, ${quote(rule.severity)},`,
      `   ${quote(JSON.stringify(rule.parameters))}::jsonb,`,
      `   ${quote(rule.recommendation)},`,
      `   ${quote(JSON.stringify(rule.dataSources))}::jsonb, ${quote(JSON.stringify(rule.appliesTo))}::jsonb)`,
    ].join('\n')
  );
  return [...header, rows.join(',\n\n'), END_MARKER].join('\n');
}

function main(): void {
  const checkOnly = process.argv.includes('--check');
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf(START_MARKER);
  const end = sql.indexOf(END_MARKER, start);
  if (start < 0 || end < 0) {
    throw new Error(`seed block not found in ${MIGRATION}: expected "${START_MARKER}" … "${END_MARKER}"`);
  }

  const next = `${sql.slice(0, start)}${buildSeed()}${sql.slice(end + END_MARKER.length)}`;
  if (next === sql) {
    console.log(`seed block already matches the catalogue (${RULE_CATALOGUE.length} rules)`);
    return;
  }
  if (checkOnly) {
    console.error(
      `${MIGRATION} is out of date with src/fraud-sentinel/rules/catalogue.ts.\n` +
        'Run: npx tsx scripts/fraud-sentinel-seed.ts'
    );
    process.exitCode = 1;
    return;
  }
  writeFileSync(MIGRATION, next, 'utf8');
  console.log(`rewrote seed block: ${RULE_CATALOGUE.length} rules`);
}

main();
