import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  READINESS_STATES,
  assessReadiness,
  looksLikePlaceholder,
  probeTooling,
  readinessRouteTarget,
  renderReadinessReport,
  type ReadinessInput,
} from '../../src/whmcs/readiness';

/**
 * Staging access readiness (C1.8).
 *
 * The command exists so the operator learns *why* discovery would stop before trying it. These tests pin the two
 * things that make its output usable in a ticket: it names variables without revealing them, and it distinguishes
 * "not configured" from "configured but wrong" from "no route" instead of collapsing everything into "failed".
 */

const SECRET = 'sup3r-secret-value-that-must-never-appear';
const IDENTIFIER = 'cloudhost247-readonly';

const GOOD_ENV = {
  WHMCS_BASE_URL: 'https://billing.staging.example.com',
  WHMCS_API_IDENTIFIER: IDENTIFIER,
  WHMCS_API_SECRET: SECRET,
} as NodeJS.ProcessEnv;

function input(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    env: { ...GOOD_ENV },
    secretsChannel: 'environment',
    route: { state: 'ok', host: 'billing.staging.example.com', port: 443 },
    tooling: {
      registerPath: '../config/whmcs/service-register.csv',
      registerPresent: true,
      mapPath: 'config/whmcs/product-map.json',
      mapState: 'valid',
      mapFingerprint: 'a'.repeat(64),
      mapHasSnapshot: false,
    },
    ...overrides,
  };
}

function byId(report: ReturnType<typeof assessReadiness>, id: string) {
  const check = report.checks.find((candidate) => candidate.id === id);
  if (!check) throw new Error(`no check ${id}`);
  return check;
}

describe('assessReadiness', () => {
  it('reports ready when configuration, channel, route, identity and tooling are all satisfied', () => {
    const report = assessReadiness(input());
    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.summary.READY).toBe(6);
    expect(byId(report, 'config.url').state).toBe('READY');
    expect(byId(report, 'install.identity').state).toBe('READY');
  });

  it('never puts a credential value in the report', () => {
    const report = assessReadiness(input());
    const serialised = JSON.stringify(report) + renderReadinessReport(report);
    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain(IDENTIFIER);
    expect(serialised).toContain('values not read');
  });

  it('distinguishes MISSING configuration from an INVALID one', () => {
    const missing = assessReadiness(input({ env: {} as NodeJS.ProcessEnv, secretsChannel: 'none' }));
    expect(byId(missing, 'config.variables').state).toBe('MISSING');
    expect(byId(missing, 'config.url').state).toBe('MISSING');
    expect(byId(missing, 'secrets.channel').state).toBe('MISSING');
    expect(byId(missing, 'network.route').state).toBe('NOT CHECKED');
    expect(missing.ready).toBe(false);

    const invalid = assessReadiness(input({ env: { ...GOOD_ENV, WHMCS_BASE_URL: 'http://billing.example.com' } }));
    expect(byId(invalid, 'config.url').state).toBe('INVALID');
    expect(byId(invalid, 'config.url').detail).toContain('https');
    expect(invalid.blockers.join(' ')).toContain('Install URL: INVALID');
  });

  it('accepts loopback over http, and says why it is allowed', () => {
    const report = assessReadiness(input({ env: { ...GOOD_ENV, WHMCS_BASE_URL: 'http://127.0.0.1:8080' } }));
    expect(byId(report, 'config.url').state).toBe('READY');
    expect(byId(report, 'config.url').detail).toContain('loopback');
  });

  it('flags a placeholder secret as INVALID rather than ready', () => {
    const report = assessReadiness(input({ env: { ...GOOD_ENV, WHMCS_API_SECRET: 'changeme' } }));
    expect(byId(report, 'secrets.channel').state).toBe('INVALID');
    expect(byId(report, 'secrets.channel').detail).toContain('placeholder');
    expect(report.ready).toBe(false);
  });

  it('reports a dotenv file as an acceptable staging channel', () => {
    const report = assessReadiness(input({ secretsChannel: 'dotenv-file' }));
    expect(byId(report, 'secrets.channel').state).toBe('READY');
    expect(byId(report, 'secrets.channel').detail).toContain('dotenv');
  });

  it('separates UNREACHABLE from MISSING, and never guesses at the cause', () => {
    const report = assessReadiness(
      input({ route: { state: 'unreachable', host: 'billing.staging.example.com', port: 443, reason: 'ECONNREFUSED' } }),
    );
    expect(byId(report, 'network.route').state).toBe('UNREACHABLE');
    expect(byId(report, 'network.route').detail).toContain('ECONNREFUSED');
    expect(report.ready).toBe(false);

    const skipped = assessReadiness(input({ route: { state: 'skipped', reason: 'no valid install URL to probe' } }));
    expect(byId(skipped, 'network.route').state).toBe('NOT CHECKED');
    // NOT CHECKED is honest, not a pass: it never counts as a blocker but never counts as READY either.
    expect(byId(skipped, 'network.route').state).not.toBe('READY');
  });

  it('marks the identity INVALID when the committed map came from a different installation', () => {
    const report = assessReadiness(
      input({
        tooling: {
          registerPath: 'x',
          registerPresent: true,
          mapPath: 'config/whmcs/product-map.json',
          mapState: 'valid',
          mapFingerprint: 'b'.repeat(64),
          mapHasSnapshot: true,
        },
      }),
    );
    expect(byId(report, 'install.identity').state).toBe('INVALID');
    expect(byId(report, 'install.identity').detail).toContain('different installation');
  });

  it('does not compare fingerprints against the empty placeholder map', () => {
    const report = assessReadiness(
      input({
        tooling: {
          registerPath: 'x',
          registerPresent: true,
          mapPath: 'm',
          mapState: 'valid',
          mapFingerprint: 'b'.repeat(64),
          mapHasSnapshot: false,
        },
      }),
    );
    expect(byId(report, 'install.identity').state).toBe('READY');
  });

  it('treats a checksum-invalid map as INVALID tooling, not as absent', () => {
    const report = assessReadiness(
      input({
        tooling: {
          registerPath: 'x',
          registerPresent: true,
          mapPath: 'config/whmcs/product-map.json',
          mapState: 'invalid',
          mapFingerprint: null,
          mapHasSnapshot: false,
        },
      }),
    );
    expect(byId(report, 'tooling.discovery').state).toBe('INVALID');
    expect(byId(report, 'tooling.discovery').detail).toContain('do not hand edit');

    const noRegister = assessReadiness(
      input({ tooling: { registerPath: 'nope.csv', registerPresent: false, mapPath: 'm', mapState: 'absent', mapFingerprint: null, mapHasSnapshot: false } }),
    );
    expect(byId(noRegister, 'tooling.discovery').state).toBe('MISSING');
  });

  it('always reports every one of the five states in its summary', () => {
    const report = assessReadiness(input());
    expect(Object.keys(report.summary)).toEqual([...READINESS_STATES]);
    const total = Object.values(report.summary).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(report.checks.length);
  });
});

describe('C1.9 review findings', () => {
  it('attributes a credential failure to the credential check, not to the URL', () => {
    const report = assessReadiness(input({ env: { ...GOOD_ENV, WHMCS_API_SECRET: 'short' } }));
    expect(byId(report, 'secrets.channel').state).toBe('INVALID');
    expect(byId(report, 'secrets.channel').detail).toContain('at least');
    // The URL and the installation identity are still assessable: one bad variable must not hide the others.
    expect(byId(report, 'config.url').state).toBe('READY');
    expect(byId(report, 'install.identity').state).toBe('READY');
  });

  it('attributes a URL failure to the URL check, leaving the credential channel assessable', () => {
    const report = assessReadiness(input({ env: { ...GOOD_ENV, WHMCS_BASE_URL: 'http://billing.example.com' } }));
    expect(byId(report, 'config.url').state).toBe('INVALID');
    expect(byId(report, 'config.url').detail).toContain('https');
    expect(byId(report, 'secrets.channel').state).toBe('READY');
    expect(byId(report, 'install.identity').state).toBe('MISSING');
  });

  it('resolves a route target only from a valid URL, and never throws', () => {
    expect(readinessRouteTarget({ ...GOOD_ENV } as NodeJS.ProcessEnv)).toMatchObject({
      host: 'billing.staging.example.com',
      port: 443,
    });
    expect(readinessRouteTarget({ ...GOOD_ENV, WHMCS_BASE_URL: 'http://127.0.0.1:8080' } as NodeJS.ProcessEnv)).toMatchObject({
      host: '127.0.0.1',
      port: 8080,
    });
    // A short secret must not cost the URL its route probe.
    expect(readinessRouteTarget({ ...GOOD_ENV, WHMCS_API_SECRET: 'short' } as NodeJS.ProcessEnv)).toMatchObject({ port: 443 });
    expect(readinessRouteTarget({ ...GOOD_ENV, WHMCS_BASE_URL: 'http://billing.example.com' } as NodeJS.ProcessEnv)).toBeNull();
    expect(readinessRouteTarget({} as NodeJS.ProcessEnv)).toBeNull();
    expect(readinessRouteTarget({ ...GOOD_ENV, WHMCS_BASE_URL: 'not-a-url' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('has no HTTP client, so it cannot issue an authenticated request even by accident', () => {
    const source = readFileSync(new URL('../../src/whmcs/readiness.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from '\.[^']*client'/);
    expect(source).not.toMatch(/from '\.[^']*transport'/);
    expect(source).not.toMatch(/\b(fetch|axios|http\.request|https\.request)\s*\(/);
    expect(source).not.toMatch(/includes\/api\.php/);
  });
});

describe('looksLikePlaceholder', () => {
  it('recognises the values people leave behind', () => {
    for (const value of ['', 'changeme', 'CHANGE-ME', 'your-secret', 'xxx', 'aaaaaa', '<secret>', 'placeholder']) {
      expect(looksLikePlaceholder(value)).toBe(true);
    }
    expect(looksLikePlaceholder(SECRET)).toBe(false);
  });
});

describe('probeTooling', () => {
  it('reads the committed map and register from the repository', () => {
    const tooling = probeTooling({
      registerPath: path.resolve(process.cwd(), '..', 'config', 'whmcs', 'service-register.csv'),
      mapPath: path.resolve(process.cwd(), 'config', 'whmcs', 'product-map.json'),
    });
    expect(tooling.registerPresent).toBe(true);
    expect(tooling.mapState).toBe('valid');
    expect(tooling.mapFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(tooling.mapHasSnapshot).toBe(false);
  });

  it('reports a tampered map as invalid rather than reading it anyway', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'whmcs-readiness-'));
    const tampered = path.join(dir, 'product-map.json');
    copyFileSync(path.resolve(process.cwd(), 'config', 'whmcs', 'product-map.json'), tampered);
    const original = JSON.parse(require('node:fs').readFileSync(tampered, 'utf8'));
    original.services = { 'hosting-vps': { productId: 12 } };
    writeFileSync(tampered, JSON.stringify(original));

    const tooling = probeTooling({ registerPath: path.resolve(process.cwd(), '..', 'config', 'whmcs', 'service-register.csv'), mapPath: tampered });
    expect(tooling.mapState).toBe('invalid');
  });

  it('reports an absent map without failing', () => {
    const tooling = probeTooling({ registerPath: 'nope.csv', mapPath: path.join(tmpdir(), 'does-not-exist.json') });
    expect(tooling.mapState).toBe('absent');
    expect(tooling.registerPresent).toBe(false);
  });
});
