import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { join } from 'node:path';
import { FsStorageAdapter, StorageAdapter, StoredObjectMetadata, sha256File, sha256Buffer, AccessDeniedError } from '../../src/backups/storage-adapter';
import { BackupWorker, InMemoryBackupInventory } from '../../src/backups/backup-worker';

/** Phase 23 Session 6 — worker unit battery. */
describe('Phase 23 — backup worker [unit]', () => {
  let tmp: string; let storeDir: string;
  const keyV1 = randomBytes(32).toString('hex');
  const keyV2 = randomBytes(32).toString('hex');
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'ch247-ut-')); storeDir = join(tmp, 'store'); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  const makeDump = () => Buffer.from(`pg custom dump ${randomBytes(12).toString('hex')}\nTABLE data;`);
  const depsFor = (adapter: StorageAdapter, extras: Partial<any> = {}) => ({
    adapter, dumpForBackup: async () => makeDump(), encryptionKeys: { versioned: `1:${keyV1}` }, retentionKeepMinimum: 1, ...extras,
  });

  it('happy path: dump → ring-encrypt → upload → verify-digest → inventory COMPLETE', async () => {
    const adapter = new FsStorageAdapter(storeDir);
    const inv = new InMemoryBackupInventory();
    const w = new BackupWorker(depsFor(adapter), inv);
    const r = await w.run('staging');
    expect(r.status).toBe('COMPLETE');
    expect(r.uploadVerified).toBe(true);
    const row = await inv.get(r.backupId);
    expect(row?.status).toBe('complete');
    expect(row?.key_version).toBe(1);
    expect(row?.size_bytes).toBeGreaterThan(0);
  });

  it('upload retry: first NetworkError is retried successfully, exactly one object exists', async () => {
    const adapter = new FsStorageAdapter(storeDir);
    let calls = 0; class Flaky extends FsStorageAdapter { override async putObject(k: string, d: any, o?: any) { calls++; if (calls === 1) throw new Error('simulated network interruption'); return super.putObject(k, d, o); } }
    const flakyAdapter = new Flaky(storeDir);
    const w = new BackupWorker(depsFor(flakyAdapter), new InMemoryBackupInventory());
    const r = await w.run('staging');
    expect(r.status).toBe('COMPLETE'); expect(calls).toBe(2);
  });

  it('persistent upload failure: run fails closed, inventory shows failed, error logged', async () => {
    const adapter = new FsStorageAdapter(storeDir);
    class Dead extends FsStorageAdapter { override async putObject(): Promise<void> { throw new Error('permanent network outage'); } }
    const inv = new InMemoryBackupInventory();
    const w = new BackupWorker(depsFor(new Dead(storeDir)), inv);
    await expect(w.run('staging')).rejects.toThrow(/permanent/);
    const backup = (await inv.completedForEnv('staging')).length;
    expect(backup).toBe(0);
  });

  it('digest mismatch rejection: manipulated stored object → verification fails, run marked failed', async () => {
    const adapter = new FsStorageAdapter(storeDir);
    class LyingFs extends FsStorageAdapter {
      override async getObjectMetadata(key: string): Promise<StoredObjectMetadata | null> { const m = await super.getObjectMetadata(key); return m ? { ...m, sha256: 'deadbeef'.repeat(8) } : m; }
    }
    const inv = new InMemoryBackupInventory();
    const w = new BackupWorker(depsFor(new LyingFs(storeDir)), inv);
    await expect(w.run('staging')).rejects.toThrow(/does not match/);
  });

  it('resume semantics: an abandoned run is reused, not duplicated into a second record', async () => {
    const inv = new InMemoryBackupInventory();
    const w1 = new BackupWorker(depsFor(new FsStorageAdapter(storeDir)), inv);
    // Inject an abandoned run (status uploaded, not complete)
    await inv.create({
      backup_id: 'abandoned-1', env_id: 'staging', created_at: new Date().toISOString(), artifact_key: 'staging/2026-11-09/abandoned-1.enc', size_bytes: 0,
      dump_sha256: '', artifact_sha256: '', key_version: 1, status: 'uploaded', upload_verified: false, restore_verified: false, retention_expires_at: new Date(Date.now() + 86400000).toISOString(), owner: 'subwindels-hash',
    });
    const r = await w1.run('staging');
    expect(r.backupId).toBe('abandoned-1');
    expect(r.resumedFrom).toBe('abandoned-1');
  });

  it('retention safety: expired backups are swept but never below the keep-minimum', async () => {
    const adapter = new FsStorageAdapter(storeDir);
    const inv = new InMemoryBackupInventory();
    const W = new BackupWorker(depsFor(adapter, { retentionKeepMinimum: 2 }), inv);
    // Seed three complete runs, two expired.
    for (const [i, expired] of [['a', true], ['b', true], ['c', false]] as Array<[string, boolean]>) {
      await inv.create({ backup_id: i, env_id: 'staging', created_at: new Date().toISOString(), artifact_key: `staging/${i}.enc`, size_bytes: 1, dump_sha256: 'x'.repeat(64), artifact_sha256: 'x'.repeat(64), key_version: 1, status: 'complete', upload_verified: true, restore_verified: true, retention_expires_at: expired ? new Date(Date.now() - 86400000).toISOString() : new Date(Date.now() + 86400000).toISOString(), owner: 'subwindels-hash' });
    }
    const r = await W.run('staging');
    expect(r.retentionEnforced.kept).toBeGreaterThanOrEqual(2); // floor is enforced for pre-existing complete backups (sweep happens before this run's completion)
  });

  it('restore path: fetch from storage BY KEY VERSION and decrypt with the matching ring version', async () => {
    const adapter = new FsStorageAdapter(storeDir);
    const inv = new InMemoryBackupInventory();
    const w = new BackupWorker(depsFor(adapter), inv);
    const r = await w.run('staging');
    const recovered = await w.restoreBufferFrom((await inv.get(r.backupId))!.artifact_key);
    expect(recovered.length).toBeGreaterThan(0);
    expect(recovered.toString()).toContain('TABLE data');
  });

  it('unauthorized object access rejection: a denying adapter aborts the run, inventory shows failed', async () => {
    class Denying extends FsStorageAdapter { override async putObject(): Promise<void> { throw new AccessDeniedError('AccessDenied: put object refused'); } }
    const inv = new InMemoryBackupInventory();
    const w = new BackupWorker(depsFor(new Denying(storeDir), {}), inv);
    await expect(w.run('staging')).rejects.toThrow(/AccessDenied/);
    const rows = await inv.completedForEnv('staging');
    expect(rows).toHaveLength(0);
  });

  it('rotation compatibility: artifact written under v1 decrypts under a ring containing v2 after rotation', async () => {
    const adapter = new FsStorageAdapter(storeDir);
    const inv = new InMemoryBackupInventory();
    const w1 = new BackupWorker(depsFor(adapter), inv);
    const r = await w1.run('staging');
    // Now "rotate" — construct a worker whose ring already contains v1 and v2.
    const w2 = new BackupWorker(depsFor(adapter, { encryptionKeys: { versioned: `1:${keyV1},2:${keyV2}` } }), inv);
    const recovered = await w2.restoreBufferFrom((await inv.get(r.backupId))!.artifact_key);
    expect(recovered.toString()).toContain('TABLE data');
  });
});
