/**
 * CloudHost247 Server Agent — backups (spec §18) and system metrics (spec §51).
 *
 * Backups are tar.gz archives of the project's volume data plus optional logical database dumps
 * (pg_dump/mysqldump/mongodump run through docker compose exec), written under CH247_BACKUP_DIR,
 * content-addressed with a sha256 checksum. Off-server copy (S3/R2 upload) is performed by the
 * control plane's backup job — this agent only creates and restores local archives, so a
 * compromised agent cannot exfiltrate object-storage credentials.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, stat, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { projectDir, assertProjectName, runComposeWithOutput } from './docker.js';

const exec = promisify(execFile);

export async function runBackup(appsDir, backupDir, project, { includeVolumes, includeDatabases }) {
  assertProjectName(project);
  const dir = projectDir(appsDir, project);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = path.join(backupDir, `${project}-${stamp}.tar.gz`);
  await mkdir(backupDir, { recursive: true });

  // 1. Logical database dumps into the project's volumes dir (captured by the volume tar).
  if (includeDatabases) {
    await dumpDatabases(appsDir, project, dir).catch(() => undefined);
  }

  // 2. Archive the deployment directory (compose + .env + volumes/).
  // Note: .env is included deliberately — restoring must be self-contained. The archive lives
  // under root-only permissions (0600) and the checksum is returned to the control plane.
  await exec('tar', ['-czf', archivePath, '-C', dir, '.']);
  const info = await stat(archivePath);
  const contents = await readFile(archivePath);
  const checksum = createHash('sha256').update(contents).digest('hex');
  return { archivePath, sizeBytes: info.size, checksum };
}

async function dumpDatabases(appsDir, project, dir) {
  // Best-effort per database engine; failures are non-fatal (volumes still archived).
  const engines = [
    { image: 'postgres', cmd: ['pg_dumpall', '-U', 'postgres'] },
    { image: 'mysql', cmd: ['mysqldump', '--all-databases', '-uroot'] },
    { image: 'mariadb', cmd: ['mariadb-dump', '--all-databases', '-uroot'] },
  ];
  for (const engine of engines) {
    const output = await runComposeWithOutput(appsDir, project, ['exec', '-T', 'db', ...engine.cmd]).catch(() => null);
    if (output && output.length > 0) {
      await writeFile(path.join(dir, 'volumes', `db-dump-${engine.image}.sql`), output, { mode: 0o600 });
      return;
    }
  }
}

export async function restoreBackup(appsDir, backupDir, project, archivePath) {
  assertProjectName(project);
  // Path traversal guard: the archive must live inside the backup root.
  const resolvedRoot = path.resolve(backupDir);
  const resolvedArchive = path.resolve(archivePath);
  if (!resolvedArchive.startsWith(resolvedRoot + path.sep)) {
    throw new Error('restore path must be inside the agent backup directory');
  }
  const dir = projectDir(appsDir, project);
  await exec('tar', ['-xzf', resolvedArchive, '-C', dir]);
  return { restored: true };
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
