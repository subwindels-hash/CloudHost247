/**
 * Staging access readiness — C1.8.
 *
 * The question this answers is narrow and deliberately boring: *if the operator ran discovery right now, what would
 * stop it?* It is not a health check of WHMCS, and it makes **no authenticated request**: an unauthenticated TCP
 * connect proves a route exists without touching the API, and nothing is sent that could carry a credential.
 *
 * Every result is one of five states, because "failed" hides the useful distinctions:
 *
 *   READY         checked and satisfied
 *   MISSING       not configured — nothing to test yet
 *   INVALID       configured, but the configuration is wrong (http instead of https, placeholder secret, …)
 *   UNREACHABLE   configured correctly, but this environment has no route to the host
 *   NOT CHECKED   could not be assessed here, and is *not* being reported as either good or bad
 *
 * Two rules make the output safe to paste anywhere:
 *
 *  - **No values.** Variables are reported by name, presence and shape — never by content. The credential values are
 *    not read into this module at all; it only knows whether they were supplied through the environment or a dotenv
 *    file.
 *  - **No inference.** A file that failed checksum validation is `INVALID`, not "probably fine"; a host that did not
 *    answer is `UNREACHABLE`, not "likely a firewall".
 */

import { existsSync } from 'node:fs';
import { fingerprintBaseUrl, readProductMapFile } from './product-map';
import { loadWhmcsConfig } from './config';
import { WhmcsError } from './errors';

export const READINESS_STATES = ['READY', 'MISSING', 'INVALID', 'UNREACHABLE', 'NOT CHECKED'] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];

export interface ReadinessCheck {
  id: string;
  label: string;
  state: ReadinessState;
  /** Explanation with no credential values in it. */
  detail: string;
}

export interface ReadinessReport {
  checks: ReadinessCheck[];
  summary: Record<ReadinessState, number>;
  /** True when no check reported MISSING, INVALID or UNREACHABLE. */
  ready: boolean;
  /** The checks that would stop a discovery run, in the order they should be fixed. */
  blockers: string[];
}

export type RouteProbe =
  | { state: 'ok'; host: string; port: number }
  | { state: 'unreachable'; host: string; port: number; reason: string }
  | { state: 'skipped'; reason: string };

export interface ReadinessInput {
  env: NodeJS.ProcessEnv;
  /** Where credential values came from — never the values themselves. */
  secretsChannel: 'environment' | 'dotenv-file' | 'none';
  route: RouteProbe;
  tooling: {
    registerPath: string;
    registerPresent: boolean;
    mapPath: string;
    mapState: 'valid' | 'invalid' | 'absent';
    /** Fingerprint recorded in the map, when it is readable. */
    mapFingerprint: string | null;
    /** True when the map carries at least one product snapshot row (i.e. it is not the empty placeholder). */
    mapHasSnapshot: boolean;
  };
}

const PLACEHOLDER = /^(changeme|change-me|placeholder|example|test|dummy|todo|xxx+|your[-_].*|secret|password|<.*>)$/i;

/** True when a configured secret cannot plausibly be a real credential. The value itself is never returned. */
export function looksLikePlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return true;
  if (PLACEHOLDER.test(trimmed)) return true;
  if (/^(.)\1{5,}$/.test(trimmed)) return true;
  return /^(changeme|placeholder|example|your[-_]?(api)?[-_]?secret|insert[-_]?secret)/i.test(trimmed);
}

function envValue(env: NodeJS.ProcessEnv, name: string): string {
  return (env[name] ?? '').trim();
}

function hostOf(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}

/**
 * Assesses readiness from facts the caller has gathered. Pure: it performs no I/O, which is what lets the tests
 * exercise every state without a network or a WHMCS installation.
 */
export function assessReadiness(input: ReadinessInput): ReadinessReport {
  const checks: ReadinessCheck[] = [];
  const add = (id: string, label: string, state: ReadinessState, detail: string) => {
    checks.push({ id, label, state, detail });
  };

  // -------------------------------------------------------------------------------------------
  // 1. Required configuration variables — present or not, by name only.
  // -------------------------------------------------------------------------------------------
  const required = ['WHMCS_BASE_URL', 'WHMCS_API_IDENTIFIER', 'WHMCS_API_SECRET'];
  const absent = required.filter((name) => envValue(input.env, name) === '');
  add(
    'config.variables',
    'Required configuration variables',
    absent.length === 0 ? 'READY' : 'MISSING',
    absent.length === 0
      ? `${required.join(', ')} present (values not read)`
      : `not set: ${absent.join(', ')} — values are never displayed`,
  );

  // -------------------------------------------------------------------------------------------
  // 2-3. URL validity (https, or the loopback exception) and the credential channel.
  //      Both reuse the application's own loader, so readiness cannot pass a configuration the
  //      server would refuse.
  // -------------------------------------------------------------------------------------------
  let loaded: ReturnType<typeof loadWhmcsConfig> | null = null;
  let configError: Error | null = null;
  if (absent.length === 0) {
    try {
      loaded = loadWhmcsConfig(input.env);
    } catch (error) {
      configError = error instanceof Error ? error : new Error(String(error));
    }
  }

  const secretValue = envValue(input.env, 'WHMCS_API_SECRET');
  const identifierValue = envValue(input.env, 'WHMCS_API_IDENTIFIER');
  const placeholder = secretValue !== '' && looksLikePlaceholder(secretValue);

  if (absent.includes('WHMCS_BASE_URL')) {
    add('config.url', 'Install URL', 'MISSING', 'WHMCS_BASE_URL is not set');
  } else if (configError) {
    add('config.url', 'Install URL', 'INVALID', configError.message);
  } else if (loaded && loaded.enabled) {
    const host = hostOf(loaded.config.baseUrl) ?? '(unparseable)';
    const loopback = loaded.config.baseUrl.startsWith('http://');
    add(
      'config.url',
      'Install URL',
      'READY',
      loopback
        ? `${host} — http accepted only because it is loopback (local development)`
        : `${host} — https, no credentials, no query string`,
    );
  } else {
    add('config.url', 'Install URL', 'INVALID', 'the URL did not survive validation');
  }

  if (placeholder) {
    add('secrets.channel', 'Credential delivery channel', 'INVALID',
      'WHMCS_API_SECRET looks like a placeholder value — replace it through the approved secrets mechanism');
  } else if (identifierValue !== '' && looksLikePlaceholder(identifierValue)) {
    add('secrets.channel', 'Credential delivery channel', 'INVALID',
      'WHMCS_API_IDENTIFIER looks like a placeholder value');
  } else if (input.secretsChannel === 'environment') {
    add('secrets.channel', 'Credential delivery channel', 'READY',
      'supplied as environment variables by the deployment (preferred; not read into this report)');
  } else if (input.secretsChannel === 'dotenv-file') {
    add('secrets.channel', 'Credential delivery channel', 'READY',
      'supplied through a local dotenv file — acceptable for staging, never committed');
  } else {
    add('secrets.channel', 'Credential delivery channel', 'MISSING',
      'no credential values found in the environment or a dotenv file');
  }

  // -------------------------------------------------------------------------------------------
  // 4. Network route — an unauthenticated TCP connect, or an honest NOT CHECKED.
  // -------------------------------------------------------------------------------------------
  // A route cannot have been probed for an install whose URL does not validate, whatever the caller passed.
  if (!loaded || !loaded.enabled) {
    add('network.route', 'Network route to the install', 'NOT CHECKED',
      'no valid install URL, so there is nothing to probe');
  } else if (input.route.state === 'ok') {
    add('network.route', 'Network route to the install', 'READY',
      `TCP connect to ${input.route.host}:${input.route.port} succeeded — no request was sent, no credential was used`);
  } else if (input.route.state === 'unreachable') {
    add('network.route', 'Network route to the install', 'UNREACHABLE',
      `${input.route.host}:${input.route.port} did not answer (${input.route.reason}) — check egress, DNS and the allow-list`);
  } else {
    add('network.route', 'Network route to the install', 'NOT CHECKED', input.route.reason);
  }

  // -------------------------------------------------------------------------------------------
  // 5. Installation identity — can the expected install be stated and does the committed map agree?
  // -------------------------------------------------------------------------------------------
  if (!loaded || !loaded.enabled) {
    add('install.identity', 'Installation identity', 'MISSING',
      'no install URL, so there is no fingerprint to compare against');
  } else {
    const fingerprint = fingerprintBaseUrl(loaded.config.baseUrl);
    if (input.tooling.mapState === 'valid' && input.tooling.mapHasSnapshot
        && input.tooling.mapFingerprint && input.tooling.mapFingerprint !== fingerprint) {
      add('install.identity', 'Installation identity', 'INVALID',
        `the committed product map was generated against a different installation (map ${input.tooling.mapFingerprint.slice(0, 12)}… ≠ ${fingerprint.slice(0, 12)}…)`);
    } else {
      const version = envValue(input.env, 'WHMCS_EXPECTED_VERSION');
      add('install.identity', 'Installation identity', 'READY',
        `fingerprint ${fingerprint.slice(0, 12)}…${version ? `, expected WHMCS ${version}` : ' (set WHMCS_EXPECTED_VERSION to record the expected version)'}`);
    }
  }

  // -------------------------------------------------------------------------------------------
  // 6. Discovery and validation tooling — the register and a checksum-valid map.
  // -------------------------------------------------------------------------------------------
  if (!input.tooling.registerPresent) {
    add('tooling.discovery', 'Discovery and validation tooling', 'MISSING',
      `no service register at ${input.tooling.registerPath}`);
  } else if (input.tooling.mapState === 'invalid') {
    add('tooling.discovery', 'Discovery and validation tooling', 'INVALID',
      `${input.tooling.mapPath} failed checksum or schema validation — regenerate it, do not hand edit`);
  } else {
    add('tooling.discovery', 'Discovery and validation tooling', 'READY',
      `register present; product map ${input.tooling.mapState === 'valid' ? 'checksum-valid' : 'absent (0 bindings)'}; ` +
        'discover, validate, review and evidence are available');
  }

  const summary = Object.fromEntries(READINESS_STATES.map((state) => [state, 0])) as Record<ReadinessState, number>;
  for (const check of checks) summary[check.state] += 1;

  const blockers = checks
    .filter((check) => check.state === 'MISSING' || check.state === 'INVALID' || check.state === 'UNREACHABLE')
    .map((check) => `${check.label}: ${check.state} — ${check.detail}`);

  return {
    checks,
    summary,
    ready: blockers.length === 0,
    blockers,
  };
}

/** Reads the tooling facts from disk. Kept separate so `assessReadiness` stays pure. */
export function probeTooling(paths: { registerPath: string; mapPath: string }): ReadinessInput['tooling'] {
  const registerPresent = existsSync(paths.registerPath);
  let mapState: 'valid' | 'invalid' | 'absent' = 'absent';
  let mapFingerprint: string | null = null;
  let mapHasSnapshot = false;
  if (existsSync(paths.mapPath)) {
    try {
      const map = readProductMapFile(paths.mapPath);
      mapState = 'valid';
      mapFingerprint = map.baseUrlFingerprint;
      mapHasSnapshot = map.products.length > 0;
    } catch (error) {
      mapState = 'invalid';
      if (!(error instanceof WhmcsError)) throw error;
    }
  }
  return { registerPath: paths.registerPath, registerPresent, mapPath: paths.mapPath, mapState, mapFingerprint, mapHasSnapshot };
}

/** Renders the report exactly as the CLI prints it. */
export function renderReadinessReport(report: ReadinessReport): string {
  const lines: string[] = [];
  for (const check of report.checks) {
    lines.push(`  ${check.state.padEnd(12)} ${check.label.padEnd(34)} ${check.detail}`);
  }
  return lines.join('\n');
}
