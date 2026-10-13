#!/usr/bin/env node
/**
 * GitHub workflow files must be parseable, because a workflow that does not parse does not fail
 * with a red check: GitHub cannot create a single job for it, so the run ends as a zero-second
 * failure with no jobs, no logs and no annotation on the commit. Every check inside it silently
 * stops existing while the branch looks merely "blocked on CI".
 *
 * That is exactly what happened here. `.github/workflows/content-hygiene.yml` carried the step name
 *
 *     - name: Legal text: regenerated JSON matches the committed sources
 *
 * and the second `: ` turned the step name into a nested mapping. GitHub refused to start the
 * workflow on every commit on every branch, including `main`, so the repo-wide malformed-bullet
 * scan and the legal-JSON byte comparison had not run at all. Nothing in the repository noticed,
 * because the only thing that could have noticed was the workflow that could not start.
 *
 * This checker therefore lives in two places that are not that workflow: the release gate (which is
 * not path-filtered) and the content-hygiene workflow itself. Both call it, so a future edit that
 * breaks any workflow file is reported as a normal, readable failure.
 *
 * It parses with the `yaml` package already declared by `cloudhost247-node` when that is installed
 * — that is a real parser and the authority on what GitHub will accept. When the dependency tree is
 * absent (the PHP release-candidate legs install only `server-agent`), it falls back to a narrow
 * structural rule that catches the plain-scalar-colon class this file was broken by, and says so in
 * its output rather than pretending it validated the file.
 *
 *     node scripts/check-workflow-yaml.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

/** Resolve `yaml` from the Node platform, which declares it, without requiring it there. */
function loadParser() {
  try {
    const require = createRequire(join(ROOT, 'cloudhost247-node', 'package.json'));
    return require('yaml');
  } catch {
    return null;
  }
}

const parser = loadParser();

/**
 * Fallback for a tree without the dependency: a `key: value` line whose value is a plain scalar
 * (not quoted, not a block indicator) and contains `: ` is the mapping-values error. Block-scalar
 * bodies are skipped, and comments are stripped the way YAML strips them, so `run: curl https://x`
 * and `sh -c 'echo a: b'` inside a quoted value do not produce noise.
 */
function structuralFindings(path, text) {
  const findings = [];
  const lines = text.split('\n');
  let blockIndent = null;
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (blockIndent !== null) {
      const indent = line.match(/^\s*/)[0].length;
      if (line.trim() === '' || indent >= blockIndent) return;
      blockIndent = null;
    }
    if (line.includes('\t')) {
      findings.push({ path, lineNumber, message: 'contains a tab character; YAML forbids tabs in indentation' });
      return;
    }
    const match = line.match(/^(\s*)(?:-\s+)?([A-Za-z_][\w.-]*):\s+(\S.*)$/);
    if (!match) return;
    const value = match[3].replace(/\s+#.*$/, '');
    if (/^[|>][+-]?\d*\s*$/.test(value)) {
      blockIndent = match[1].length + 1;
      return;
    }
    if (/^["']/.test(value)) return;
    if (value.includes(': ')) {
      findings.push({
        path,
        lineNumber,
        message: `plain value contains ": " (${JSON.stringify(value.slice(0, 60))}); quote it or remove the colon`,
      });
    }
  });
  return findings;
}

function parsedFindings(path, text) {
  const findings = [];
  let document;
  try {
    document = parser.parse(text);
  } catch (error) {
    const where = error?.linePos?.[0];
    findings.push({
      path,
      lineNumber: where?.line ?? 0,
      message: `does not parse: ${String(error.message).split('\n')[0]}`,
    });
    return findings;
  }
  const jobs = document?.jobs;
  if (!jobs || typeof jobs !== 'object' || Object.keys(jobs).length === 0) {
    findings.push({ path, lineNumber: 0, message: 'declares no jobs; GitHub would start nothing' });
    return findings;
  }
  for (const [name, job] of Object.entries(jobs)) {
    const steps = job?.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
      findings.push({ path, lineNumber: 0, message: `job "${name}" has no steps` });
      continue;
    }
    steps.forEach((step, index) => {
      if (!step?.uses && !step?.run) {
        findings.push({ path, lineNumber: 0, message: `job "${name}" step ${index + 1} has neither "uses" nor "run"` });
      }
    });
  }
  return findings;
}

const files = readdirSync(WORKFLOWS).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml')).sort();
if (files.length === 0) {
  console.error(`✖ no workflow files found under ${relative(ROOT, WORKFLOWS)}`);
  process.exit(1);
}

const findings = [];
for (const name of files) {
  const path = join(WORKFLOWS, name);
  const text = readFileSync(path, 'utf8');
  findings.push(...(parser ? parsedFindings(path, text) : structuralFindings(path, text)));
}

if (findings.length > 0) {
  console.error(`✖ ${findings.length} problem(s) in .github/workflows — GitHub would silently refuse to run them:`);
  for (const finding of findings) {
    const where = finding.lineNumber ? `:${finding.lineNumber}` : '';
    console.error(`   · ${relative(ROOT, finding.path)}${where} ${finding.message}`);
  }
  console.error('\nA workflow that does not parse produces a zero-second failed run with no jobs.');
  console.error('Its checks stop existing; fix the file rather than deleting the step.');
  process.exit(1);
}

console.log(
  parser
    ? `✓ ${files.length} workflow file(s) parse, each with jobs and steps`
    : `✓ ${files.length} workflow file(s) pass the structural check (the "yaml" package is not installed here, so this is not a full parse)`,
);
