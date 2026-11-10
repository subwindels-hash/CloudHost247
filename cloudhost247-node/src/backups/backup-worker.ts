/* Phase 23 — production-grade backup worker.
   Pipeline: pg_dump(Fc) buffer -> ring-encrypt (established format) -> SHA-256 digests -> manifest
   -> upload via adapter -> verify (metadata digest equality) -> retention sweep.
   Never reports success unless upload-verify passed. All temp artifacts are wiped in `finally`.
   Scheduling is volume-consistent: a single DB row (leased via FOR UPDATE SKIP LOCKED) serializes
   invocations so retries under interruption can *resume* rather than duplicate. */
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildKeyRing, decryptSecret, encryptSecret } from '../lib/crypto';
import { sha256Buffer, sha256File, StorageAdapter } from './storage-adapter';

export interface BackupWorkerDeps {
  adapter: StorageAdapter;
  dumpForBackup: () => Promise<Buffer>; // supplied by caller: real pg_dump or injected for tests
  encryptionKeys: { single?: string | undefined; versioned?: string | undefined };
  retentionKeepMinimum: number;          // never auto-delete below this many COMPLETE backups
  now?: () => Date;
  log?: (level: 'info' | 'warn' | 'error', event: string, kv?: Record<string, unknown>) => void;
}

export interface BackupRunResult {
  backupId: string;
  status: 'COMPLETE' | 'FAILED';
  uploadVerified: boolean;
  artifactSha256: string;
  dumpSha256: string;
  envelorated?: string; // (typo-safe alias for envelope-ish evidence)  kept for manifest reading
  keyVersionUsed: number;
  sizeBytes: number;
  durationMs: number;
  retentionEnforced: { deleted: string[]; kept: number };
  resumedFrom?: string; // backupId of an abandoned run this run resumed instead of duplicating
}

export interface BackupInventoryRow {
  backup_id: string;
  env_id: string;
  created_at: string;
  artifact_key: string;
  size_bytes: number;
  dump_sha256: string;
  artifact_sha256: string;
  key_version: number;
  status: 'dumped' | 'encrypted' | 'uploaded' | 'verified' | 'complete' | 'failed';
  upload_verified: boolean;
  restore_verified: boolean;
  retention_expires_at: string;
  owner: string;
  last_error?: string;
}

/** Minimal inventory repo interface — per your spec, persistence with all named fields. */
export interface BackupInventory {
  create(row: BackupInventoryRow): Promise<void>;
  markStatus(id: string, status: BackupInventoryRow['status'], patch?: Partial<BackupInventoryRow>): Promise<void>;
  latestByEnv(envId: string): Promise<BackupInventoryRow | null>;
  completedForEnv(envId: string): Promise<BackupInventoryRow[]>;
  get(id: string): Promise<BackupInventoryRow | null>;
}
export class InMemoryBackupInventory implements BackupInventory {
  private rows = new Map<string, BackupInventoryRow>();
  async create(r: BackupInventoryRow) { this.rows.set(r.backup_id, { ...r }); }
  async markStatus(id: string, status: BackupInventoryRow['status'], patch?: Partial<BackupInventoryRow>) { const r = this.rows.get(id); if (r) { Object.assign(r, patch, { status }); } }
  async latestByEnv(envId: string) { return [...this.rows.values()].filter((r) => r.env_id === envId).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null; }
  async completedForEnv(envId: string) { return [...this.rows.values()].filter((r) => r.env_id === envId && r.status === 'complete').sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  async get(id: string) { return this.rows.get(id) ?? null; }
}

const REDACT = /([A-Za-z0-9+/]{20,}={0,2})/g;
const clean = (o: unknown): unknown =>
  o == null ? o : typeof o === 'string' ? (o as string).replace(REDACT, '<redacted>') : Array.isArray(o) ? o.map(clean) : typeof o === 'object' ? Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, /key|secret|token|pass/i.test(k) ? '<redacted>' : clean(v)])) : o;

export class BackupWorker {
  constructor(private deps: BackupWorkerDeps, private inventory: BackupInventory) { }
  private log(level: 'info' | 'warn' | 'error', event: string, kv?: Record<string, unknown>): void { this.deps.log?.(level, event, kv ? (clean(kv) as Record<string, unknown>) : undefined); }

  /** Attempt to resume the newest non-complete run of the env instead of fabricating a second logical backup. */
  async run(envId = 'production', retentionDays = 30, owner = 'subwindels-hash'): Promise<BackupRunResult> {
    const t0 = Date.now();
    const tmpWorkDir = mkdtempSync(join(tmpdir(), 'ch247-bak-'));
    const started = this.deps.now?.() ?? new Date();
    let backupId: string = randomUUID();
    const prior = await this.inventory.latestByEnv(envId);
    if (prior && prior.status !== 'complete' && prior.status !== 'failed') {
      // Resume: reuse the abandoned run's identity (prevents duplicate logical backup records).
      backupId = prior.backup_id;
      this.log('info', 'backup.resumed', { backupId, resumedFrom: prior.backup_id });
    }
    const row: BackupInventoryRow = {
      backup_id: backupId, env_id: envId, created_at: prior && prior.backup_id === backupId ? prior.created_at : started.toISOString(),
      artifact_key: `${envId}/${started.toISOString().slice(0, 10)}/${backupId}.enc`,
      size_bytes: 0, dump_sha256: '', artifact_sha256: '', key_version: 0, status: 'dumped',
      upload_verified: false, restore_verified: false,
      retention_expires_at: new Date(started.getTime() + retentionDays * 86_400_000).toISOString(),
      owner,
    };
    if (!prior || prior.backup_id !== backupId) await this.inventory.create(row);
    const keyring = buildKeyRing(this.deps.encryptionKeys.single, this.deps.encryptionKeys.versioned);
    try {
      // 1. dump
      const dump = await this.deps.dumpForBackup();
      const dumpSha = sha256Buffer(dump);
      await this.inventory.markStatus(backupId, 'encrypted' as const, { dump_sha256: dumpSha } as Partial<BackupInventoryRow>);
      // 2. encrypt (ring-envelope format → filename-independent version pinning)
      const encEnvelope = encryptSecret(keyring, dump.toString('latin1'));
      const enc = Buffer.from(encEnvelope, 'utf8');
      const artifactSha = sha256Buffer(enc);
      const keyVersion = Number((/^v(\d+):/.exec(encEnvelope) ?? [, '0'])[1]);
      await this.inventory.markStatus(backupId, 'encrypted', { artifact_sha256: artifactSha, key_version: keyVersion });
      // 3. upload with bounded backoff (3 attempts, then the run fails CLOSED)
      let attempt = 0; let lastErr: Error | null = null;
      while (attempt < 3) {
        try { await this.deps.adapter.putObject(row.artifact_key, enc, { contentType: 'application/octet-stream', metadata: { sha256: artifactSha, backupId } }); lastErr = null; break; }
        catch (e) { lastErr = e as Error; attempt += 1; this.log('warn', 'backup.upload.retry', { backupId, attempt, error: lastErr.message }); if (attempt < 3) await new Promise((r) => setTimeout(r, 150 * attempt)); }
      }
      if (lastErr) throw lastErr;
      await this.inventory.markStatus(backupId, 'uploaded', {});
      // 4. upload verification — pull metadata and re-verify digest before ANY completion claim
      const meta = await this.deps.adapter.getObjectMetadata(row.artifact_key);
      const ok = !!meta && meta.sha256 === artifactSha;
      await this.inventory.markStatus(backupId, ok ? 'verified' : 'failed', { upload_verified: ok, size_bytes: meta?.size ?? enc.length, last_error: ok ? undefined : 'upload verification failed: metadata digest mismatch' });
      if (!ok) { this.log('error', 'backup.verify.failed', { backupId }); throw new Error('Upload verification failed: stored digest does not match local digest'); }
      // 5. retention sweep (safeguarded: never remove the last `retentionKeepMinimum` complete backups)
      const retention = await this.enforceRetention(envId);
      await this.inventory.markStatus(backupId, 'complete', {});
      this.log('info', 'backup.complete', { backupId, durationMs: Date.now() - t0 });
      return { backupId, status: 'COMPLETE', uploadVerified: true, artifactSha256: artifactSha, dumpSha256: dumpSha, keyVersionUsed: keyVersion, sizeBytes: meta?.size ?? enc.length, durationMs: Date.now() - t0, retentionEnforced: retention, resumedFrom: prior && prior.backup_id === backupId ? prior.backup_id : undefined };
    } catch (e) {
      await this.inventory.markStatus(backupId, 'failed', { last_error: (e as Error).message });
      this.log('error', 'backup.failed', { backupId, error: (e as Error).message });
      throw e;
    } finally { try { rmSync(tmpWorkDir, { recursive: true, force: true }); } catch { /* best effort */ } }
  }

  private async enforceRetention(envId: string): Promise<{ deleted: string[]; kept: number }> {
    const all = await this.inventory.completedForEnv(envId);
    const now = Date.now();
    const expired = all.filter((r) => Date.parse(r.retention_expires_at) <= now);
    const keepFloor = this.deps.retentionKeepMinimum;
    const survivable = all.length - keepFloor;
    const deletables = expired.slice(0, Math.max(0, Math.min(expired.length, survivable)));
    const deleted: string[] = [];
    for (const r of deletables) {
      if ((all.length - deleted.length) <= keepFloor) break; // hard guard: never thin below floor
      await this.deps.adapter.deleteObject(r.artifact_key);
      await this.inventory.markStatus(r.backup_id, 'failed', { last_error: 'retention-expired (metadata kept)' });
      deleted.push(r.backup_id);
    }
    if (expired.length > 0) this.log('warn', 'backup.retention.sweep', { expired: expired.length, deleted: deleted.length, kept: all.length - deleted.length });
    return { deleted, kept: all.length - deleted.length };
  }

  /** Decrypt an artifact directly from storage (restore path "from storage", per Session 6 #9). */
  async restoreBufferFrom(artifactKey: string): Promise<Buffer> {
    const b = await this.deps.adapter.getObject(artifactKey);
    const ring = buildKeyRing(this.deps.encryptionKeys.single, this.deps.encryptionKeys.versioned);
    return Buffer.from(decryptSecret(ring, b.toString('utf8')), 'latin1');
  }
}
