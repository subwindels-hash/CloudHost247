/**
 * CloudHost247 Server Agent — backups (spec §18) and system metrics (spec §51).
 *
 * Backups are tar.gz archives of the project's volume data plus optional logical database dumps
 * (pg_dump/mysqldump/mongodump run through docker compose exec), written under CH247_BACKUP_DIR,
 * content-addressed with a sha256 checksum. Off-server copy (S3/R2 upload) is performed by the
 * control plane's backup job — this agent only creates and restores local archives, so a
 * compromised agent cannot exfiltrate object-storage credentials.
 *
 * The archive is created 0600 **before** tar runs (see the comment in runBackup): it contains the
 * project's .env by design, so a world-readable archive would hand every application secret to any
 * local user on the host.
 */
import { execFile } from 'node:child_process';
import { createReadStream, readFileSync } from 'node:fs';
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { projectDir, assertProjectName, runComposeWithOutput } from './docker.js';

const exec = promisify(execFile);

/** Lowercase sha256 hex digest — the only shape accepted as an expected checksum. */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** Logical dump engines, tried in order against each candidate service (see dumpDatabases). */
const DUMP_ENGINES = [
  { name: 'postgres', command: ['pg_dumpall', '-U', 'postgres'], extension: 'sql' },
  { name: 'mysql', command: ['mysqldump', '--all-databases', '-uroot'], extension: 'sql' },
  { name: 'mariadb', command: ['mariadb-dump', '--all-databases', '-uroot'], extension: 'sql' },
  // mongodump writes a BSON archive, not text: it is captured as a buffer and written byte-for-byte
  // (decoding it as utf8 would corrupt every document).
  { name: 'mongodb', command: ['mongodump', '--archive'], extension: 'archive', binary: true },
];

/**
 * sha256 of a file, streamed.
 *
 * Streaming rather than `readFile` + hash: a customer database backup can be gigabytes, and buffering
 * it whole to hash it would throw the agent process away on exactly the deployments that most need a
 * backup to succeed. The digest is identical either way.
 */
async function sha256OfFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export async function runBackup(appsDir, backupDir, project, { includeVolumes, includeDatabases }) {
  assertProjectName(project);
  const dir = projectDir(appsDir, project);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = path.join(backupDir, `${project}-${stamp}.tar.gz`);
  await mkdir(backupDir, { recursive: true });

  // 1. Logical database dumps into the project's volumes dir (captured by the volume tar).
  const databaseDump = includeDatabases
    ? await dumpDatabases(appsDir, project, dir).catch((err) => ({
        engine: null,
        service: null,
        file: null,
        reason: `dump attempt failed: ${String(err?.message ?? err).slice(0, 200)}`,
      }))
    : { engine: null, service: null, file: null, reason: 'not requested' };

  // 2. Archive the deployment directory (compose + .env + volumes/).
  // Note: .env is included deliberately — restoring must be self-contained. tar creates the output
  // file from the process umask (0644 for the usual umask 022), so the file is created 0600 here
  // first: tar truncates the existing file and keeps its mode, leaving no window in which the
  // archive — and therefore every secret in .env — is readable by another local user.
  await writeFile(archivePath, '', { mode: 0o600 });
  await exec('tar', ['-czf', archivePath, '-C', dir, '.']);
  await chmod(archivePath, 0o600);
  const info = await stat(archivePath);
  const checksum = await sha256OfFile(archivePath);
  return {
    archivePath,
    sizeBytes: info.size,
    checksum,
    /**
     * What the archive actually holds, reported to the control plane so a backup that was asked for
     * a database dump and produced none cannot look identical to one that produced it.
     *
     * `volumes: true` is not a guess: the project directory (compose.yaml, .env and volumes/) is
     * always archived. The `includeVolumes` flag is accepted for compatibility but deliberately does
     * not narrow the archive — the database dump is written inside volumes/, and a restore of an
     * archive missing it would silently bring back an app with no data.
     */
    includes: { volumes: true, databases: databaseDump.engine },
    databaseDump,
  };
}

/**
 * Streams a logical dump of the project's database service into the project directory so the volume
 * tar captures it.
 *
 * Two things this deliberately does NOT do, both of which were defects:
 *
 *  - It does not assume the database service is called `db`. Service names are free-form slugs in the
 *    manifest schema (`/^[a-z0-9_-]{1,40}$/`, only `app` is required), so a project whose database is
 *    named `postgres` or `db_main` was dumped by nobody: every engine was executed against a service
 *    that does not exist, and the failure was discarded. The real service list is read from Compose
 *    and each candidate is probed, so the engine is identified by what actually runs, not by name.
 *  - It does not silently return nothing. The outcome — including the reason no dump was produced and
 *    the services and engines that were tried — is returned to the caller and reported in the backup
 *    result. A database service running an engine with no logical dump here (e.g. `redis`, which the
 *    manifest schema allows and which persists in the volume tar) is reported as such.
 */
async function dumpDatabases(appsDir, project, dir) {
  let services;
  try {
    const listed = await runComposeWithOutput(appsDir, project, ['config', '--services']);
    services = listed
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      // `app` is the customer-facing service; probing it for a database client only wastes a call.
      .filter((s) => s !== 'app');
  } catch (err) {
    return {
      engine: null,
      service: null,
      file: null,
      reason: `could not list compose services: ${String(err?.message ?? err).slice(0, 200)}`,
    };
  }
  if (services.length === 0) {
    return { engine: null, service: null, file: null, reason: 'project defines no service other than app' };
  }

  const attempted = [];
  for (const service of services) {
    for (const engine of DUMP_ENGINES) {
      let output;
      try {
        output = await runComposeWithOutput(appsDir, project, ['exec', '-T', service, ...engine.command], {
          encoding: engine.binary ? 'buffer' : undefined,
        });
      } catch (err) {
        attempted.push(`${service}:${engine.name} (${String(err?.message ?? err).split('\n')[0].slice(0, 80)})`);
        continue;
      }
      if (!output || output.length === 0) {
        attempted.push(`${service}:${engine.name} (empty output)`);
        continue;
      }
      const file = path.join(dir, 'volumes', `db-dump-${engine.name}.${engine.extension}`);
      await writeFile(file, output, { mode: 0o600 });
      return { engine: engine.name, service, file, bytes: output.length };
    }
  }
  return {
    engine: null,
    service: null,
    file: null,
    reason: 'no service produced a logical database dump',
    services,
    attempted,
  };
}

/**
 * @param {object} [options]
 * @param {string|undefined} [options.expectedChecksum] sha256 the control plane recorded when the
 *   archive was created. When supplied it must match the archive byte-for-byte or the restore is
 *   refused before a single file is written.
 */
export async function restoreBackup(appsDir, backupDir, project, archivePath, { expectedChecksum } = {}) {
  assertProjectName(project);
  // Path traversal guard: the archive must live inside the backup root.
  const resolvedRoot = path.resolve(backupDir);
  const resolvedArchive = path.resolve(archivePath);
  if (!resolvedArchive.startsWith(resolvedRoot + path.sep)) {
    throw new Error('restore path must be inside the agent backup directory');
  }
  const dir = projectDir(appsDir, project);

  /**
   * Integrity check before the tar verification pass, and before anything is written.
   *
   * The control plane stores the checksum the agent computed when the archive was created, so this is
   * what catches an archive that has been damaged since — a partial write, a full disk during the
   * backup, bit rot on the storage, a truncated copy. Gross damage also trips the `tar -t` pass below,
   * but damage that still decompresses (one flipped byte inside a member) does not, and would be
   * extracted over the live project without this.
   *
   * This is an integrity check, not authentication: the same agent computes the checksum at backup
   * time, so an agent that can rewrite the archive can rewrite the checksum with it. What it rules out
   * is silent corruption, not a hostile agent.
   */
  let checksumVerified = false;
  if (expectedChecksum !== undefined && expectedChecksum !== null) {
    if (typeof expectedChecksum !== 'string' || !SHA256_HEX_RE.test(expectedChecksum)) {
      throw new Error('expectedChecksum must be a lowercase sha256 hex digest');
    }
    const actual = await sha256OfFile(resolvedArchive);
    if (actual !== expectedChecksum) {
      throw new Error(
        `backup archive checksum mismatch: the control plane recorded ${expectedChecksum}, the archive on disk is ${actual}`
      );
    }
    checksumVerified = true;
  }

  // Verification pass BEFORE anything is written. `tar -xzf` on a truncated or corrupt archive
  // extracted whatever members it reached, exited 0, and the control plane recorded a successful
  // restore of a project that had been only partly replaced; on an empty archive it wrote nothing at
  // all and still reported success. Listing first turns all of those into an explicit failure.
  let listing;
  try {
    listing = await exec('tar', ['-tzf', resolvedArchive], { maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    throw new Error(`backup archive is not a readable gzip tar: ${String(err?.message ?? err).slice(0, 200)}`);
  }
  const members = listing.stdout.split('\n').filter((line) => line.trim().length > 0);
  if (members.length === 0) {
    throw new Error('backup archive is empty (no members) — refusing to restore over a live project');
  }
  // Absolute paths and `..` segments must be rejected here rather than relied on: GNU tar refuses
  // them on extract, but a restore that half-applies before hitting one is worse than a clean refusal.
  const unsafe = members.find((member) => member.startsWith('/') || member.split('/').includes('..'));
  if (unsafe) {
    throw new Error(`backup archive contains an unsafe member path: ${unsafe.slice(0, 120)}`);
  }

  await exec('tar', ['-xzf', resolvedArchive, '-C', dir]);
  // `checksumVerified` distinguishes "the archive was confirmed against the recorded digest" from
  // "nothing was available to check it against", so a caller can never read the absence of a check as
  // a passed one.
  return { restored: true, members: members.length, checksumVerified };
}

// --- System metrics (Linux /proc readers; null when unavailable) --------------------------------

function readProcFirst(file) {
  try {
    return readFileSync(`/proc/${file}`, 'utf8');
  } catch {
    return null;
  }
}

export async function systemReport() {
  const meminfo = readProcFirst('meminfo');
  let memoryUsedMb = null;
  let memoryTotalMb = null;
  if (meminfo) {
    const total = /^MemTotal:\s+(\d+) kB/m.exec(meminfo);
    const available = /^MemAvailable:\s+(\d+) kB/m.exec(meminfo);
    if (total && available) {
      memoryTotalMb = Math.round(Number(total[1]) / 1024);
      memoryUsedMb = Math.max(0, memoryTotalMb - Math.round(Number(available[1]) / 1024));
    }
  }
  const loadavg = readProcFirst('loadavg');
  let load1 = null;
  let load5 = null;
  let load15 = null;
  if (loadavg) {
    const parts = loadavg.split(/\s+/);
    load1 = Number.parseFloat(parts[0] ?? '');
    load5 = Number.parseFloat(parts[1] ?? '');
    load15 = Number.parseFloat(parts[2] ?? '');
  }
  const uptime = readProcFirst('uptime');
  const uptimeSeconds = uptime ? Math.round(Number.parseFloat(uptime.split(/\s+/)[0] ?? '0')) : null;

  // Disk usage of the apps dir's filesystem; container counts via docker CLI.
  let diskUsedMb = null;
  let diskTotalMb = null;
  try {
    const { stdout } = await exec('df', ['-Pm', '/opt']);
    const line = stdout.split('\n')[1]?.trim().split(/\s+/);
    if (line && line.length >= 4) {
      diskTotalMb = Number.parseInt(line[1], 10);
      diskUsedMb = Number.parseInt(line[2], 10);
    }
  } catch {
    // not Linux or df unavailable — reported as null, never fabricated
  }
  let dockerContainers = null;
  let dockerContainersHealthy = null;
  try {
    const { stdout } = await exec('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Status}}']);
    const lines = stdout.split('\n').filter(Boolean);
    dockerContainers = lines.length;
    dockerContainersHealthy = lines.filter((l) => /\(healthy\)/i.test(l)).length;
  } catch {
    // docker unreachable — control plane marks the agent degraded
  }
  // CPU % over a short window from /proc/stat.
  let cpuPercent = null;
  try {
    const read = () => {
      const parts = readProcFirst('stat')?.split('\n')[0].split(/\s+/).slice(1).map(Number);
      const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
      const total = parts.reduce((a, b) => a + b, 0);
      return { idle, total };
    };
    const first = read();
    await new Promise((r) => setTimeout(r, 200));
    const second = read();
    const totalDelta = second.total - first.total;
    const idleDelta = second.idle - first.idle;
    if (totalDelta > 0) cpuPercent = Math.round((1 - idleDelta / totalDelta) * 10000) / 100;
  } catch {
    // leave null
  }

  return {
    cpuPercent,
    load1,
    load5,
    load15,
    memoryUsedMb,
    memoryTotalMb,
    diskUsedMb,
    diskTotalMb,
    networkInBytes: null,
    networkOutBytes: null,
    uptimeSeconds,
    dockerContainers,
    dockerContainersHealthy,
  };
}
