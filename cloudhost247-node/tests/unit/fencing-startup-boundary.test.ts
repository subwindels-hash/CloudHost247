/**
 * Unit coverage for the start predicate in `tests/helpers/fencing/startup-boundary.ts`.
 *
 * ## What is being defended
 *
 * `attemptDirectStart` answers one question: *did this start route bring a server up?* The answer is
 * used as evidence that a fenced node was or was not prevented from serving, so an error in the
 * permissive direction makes the fencing claim weaker than it looks.
 *
 * The predicate originally read `status !== 1 && !/refus/.test(stderr)`, which treats every exit code
 * other than 1 as a successful start. An unrelated crash — a missing data directory, a port already in
 * use, exit 3 — was therefore reported as `started: true`, and a suite checking "the fenced node never
 * started" would have been satisfied by a process that never got far enough to read the fence ledger.
 *
 * The predicate is now closed: `started = !refused && (timedOut || status === 0)`. These cases pin all
 * three branches, and the third is the regression that motivated the change.
 *
 * ## Not an integration test
 *
 * No PostgreSQL, no Patroni, no cluster. The routes are tiny shell scripts that reproduce the exact
 * shapes `spawnSync` reports, so this runs everywhere — including on a machine with no database
 * binaries, which is precisely where the integration suite skips.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attemptDirectStart } from '../helpers/fencing/startup-boundary';

const ROOT = mkdtempSync(join(tmpdir(), 'ch247-p38-boundary-'));

/**
 * A stand-in start route.
 *
 * `attemptDirectStart` always passes postmaster arguments (`-D … -p … -c …`), so each script ignores
 * its arguments and reproduces only the outcome under test.
 */
function route(name: string, body: string): string {
  const path = join(ROOT, name);
  writeFileSync(path, `#!/bin/sh\n${body}`);
  chmodSync(path, 0o755);
  return path;
}

let refusalRoute: string;
let crashingRoute: string;
let longRunningRoute: string;
let silentRefusalRoute: string;

beforeAll(() => {
  mkdirSync(ROOT, { recursive: true });
  // What the fence shim does when a node's ledger says FENCED, REJOIN_PENDING or UNKNOWN.
  refusalRoute = route('refuse.sh', 'echo "refusing to start: fence state is UNKNOWN" >&2\nexit 1\n');
  // A start that fails for a reason that has nothing to do with fencing.
  crashingRoute = route('crash.sh', 'echo "could not open directory: No such file or directory" >&2\nexit 3\n');
  // A start that succeeds and keeps running: killed by the bounded spawn, which is the normal path for
  // a server that came up. The route here is simply "runs and does not exit".
  longRunningRoute = route('slow.sh', 'sleep 30\n');
  // A refusal is a decision, not an exit code: a shim that refuses and still exits 0 must not be read
  // as a start.
  silentRefusalRoute = route('silent-refusal.sh', 'echo "refusing to start" >&2\nexit 0\n');
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('attemptDirectStart fail-closed predicate', () => {
  it('reports started:false when the route refuses with a non-zero exit', () => {
    const attempt = attemptDirectStart({
      route: 'pgctl-start',
      binary: refusalRoute,
      dataDir: '/nonexistent',
      port: 6701,
    });

    expect(attempt.exitCode).toBe(1);
    expect(attempt.stderr).toMatch(/refusing to start/i);
    expect(attempt.started).toBe(false);
  });

  it('reports started:false when a refusal is accompanied by a zero exit', () => {
    // The refusal clause is checked before the exit code, so this cannot be read as a start.
    const attempt = attemptDirectStart({
      route: 'pgctl-start',
      binary: silentRefusalRoute,
      dataDir: '/nonexistent',
      port: 6701,
    });

    expect(attempt.exitCode).toBe(0);
    expect(attempt.started).toBe(false);
  });

  it('reports started:true when the process is still running at the timeout', () => {
    const attempt = attemptDirectStart({
      route: 'patroni-start',
      binary: longRunningRoute,
      dataDir: '/nonexistent',
      port: 6701,
      timeoutMs: 1_200,
    });

    // Killed by the bounded spawn: no exit status, and the timeout is the only evidence it ran.
    expect(attempt.exitCode).toBeNull();
    expect(attempt.started).toBe(true);
  }, 20_000);

  it('reports started:false for an unexpected non-zero exit (exit 3)', () => {
    // The regression. The previous predicate was `status !== 1 && !/refus/`, which reported this crash
    // as a successful start — a fenced node that died could have been counted as having come up.
    const attempt = attemptDirectStart({
      route: 'direct-real-binary',
      binary: crashingRoute,
      dataDir: '/nonexistent',
      port: 6701,
    });

    expect(attempt.exitCode).toBe(3);
    expect(attempt.stderr).toMatch(/No such file or directory/);
    expect(attempt.started).toBe(false);
  });
});
