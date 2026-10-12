import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanText, scanRepository } from '../../../scripts/check-malformed-bullets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const SCRIPT = resolve(REPO_ROOT, 'scripts', 'check-malformed-bullets.mjs');

/**
 * Repository-wide content hygiene. The U+F0B7 bullet and the replacement character must never be
 * committed in text; mojibake must not be either. The planted samples prove the detector works, so a
 * clean scan cannot be a silent false negative.
 */
describe('repository text hygiene', () => {
  it('finds no U+F0B7 bullets, replacement characters or mojibake in the repository', () => {
    const { filesScanned, findings } = scanRepository(REPO_ROOT);
    expect(filesScanned).toBeGreaterThan(1000);
    expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
  });

  it('the command-line entry point exits 0 on a clean repository', () => {
    const output = execFileSync('node', [SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(output).toMatch(/0 finding\(s\)/);
  });

  it('detects a PDF symbol-font bullet', () => {
    const findings = scanText('Includes:\uF0B7 Web Hosting');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe('malformed-bullet');
    expect(findings[0]?.column).toBe(10);
  });

  it('detects a replacement character and a UTF-8-as-Windows-1252 sequence', () => {
    expect(scanText('caf\uFFFD').map((f: { rule: string }) => f.rule)).toEqual(['replacement-character']);
    expect(scanText('caf\u00C3\u00A9').map((f: { rule: string }) => f.rule)).toEqual(['mojibake']);
  });

  it('reports the line number of each finding', () => {
    const findings = scanText('ok\nok\nbad\uF0B7');
    expect(findings[0]?.line).toBe(3);
  });

  it('does not flag ordinary accented text or real list markup', () => {
    expect(scanText('Café résumé — “quotes” • <ul><li>item</li></ul>')).toEqual([]);
  });

  it('relaxes only the replacement and mojibake rules for vendored code, never the bullet rule', () => {
    expect(scanText('x\uFFFD', { vendorRelaxed: true })).toEqual([]);
    expect(scanText('x\uF0B7', { vendorRelaxed: true })).toHaveLength(1);
  });
});
