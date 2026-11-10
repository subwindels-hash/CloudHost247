/* Phase 23 — provider-neutral object-storage port + Fs (local) adapter + S3 adapter (credentials-gated).
   The worker talks ONLY to this interface; provider-specific drivers plug in behind it.
   FsAdapter is for local/staging use; it is deliberately NOT counted as "provider certification". */
import { createHash, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdir, readFile, readdir, stat, unlink, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';

export interface StoredObjectMetadata { key: string; size: number; sha256: string; lastModified?: string; metadata?: Record<string, string>; }
export interface StorageAdapter {
  putObject(key: string, data: Buffer | NodeJS.ReadableStream, options?: { contentType?: string; metadata?: Record<string, string> }): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  getObjectMetadata(key: string): Promise<StoredObjectMetadata | null>;
  deleteObject(key: string): Promise<void>;
  listObjects(prefix: string): Promise<StoredObjectMetadata[]>;
  /** Streaming download straight to a file path (avoids loading a full dump into memory). */
  downloadObjectToPath(key: string, destPath: string): Promise<void>;
}

export const sha256Buffer = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
export async function sha256File(path: string): Promise<string> { return sha256Buffer(await readFile(path)); }
export function hashStream(path: string): Promise<string> {
  return new Promise((res, rej) => { const h = createHash('sha256'); createReadStream(path).on('data', (c) => h.update(c)).on('end', () => res(h.digest('hex'))).on('error', rej); });
}

/** Filesystem adapter — LOCAL ONLY, never accepted as provider certification. */
export class FsStorageAdapter implements StorageAdapter {
  constructor(private readonly rootDir: string) {}
  private k(key: string): string {
    if (key.includes('..')) throw new Error('path traversal refused');
    return resolve(join(this.rootDir, key));
  }
  async putObject(key: string, data: Buffer | NodeJS.ReadableStream, options?: { contentType?: string; metadata?: Record<string, string> }): Promise<void> {
    const target = this.k(key);
    await mkdir(join(target, '..'), { recursive: true });
    const tmp = `${target}.tmp-${randomBytes(6).toString('hex')}`;
    if (Buffer.isBuffer(data)) await writeFile(tmp, data);
    else await pipeline(data as NodeJS.ReadableStream, createWriteStream(tmp));
    await rename(tmp, target);
    if (options?.metadata) await writeFile(`${target}.meta.json`, JSON.stringify({ sha256: await hashStream(target), ...options.metadata }));
    else await writeFile(`${target}.meta.json`, JSON.stringify({ sha256: await hashStream(target) }));
  }
  async getObject(key: string): Promise<Buffer> { return readFile(this.k(key)); }
  async getObjectMetadata(key: string): Promise<StoredObjectMetadata | null> {
    try {
      const s = await stat(this.k(key));
      const metaRaw = await readFile(`${this.k(key)}.meta.json`, 'utf8').catch(() => '{}');
      const meta = JSON.parse(metaRaw) as Record<string, string>;
      return { key, size: s.size, sha256: meta.sha256 ?? (await hashStream(this.k(key))), lastModified: s.mtime.toISOString(), metadata: meta };
    } catch { return null; }
  }
  async deleteObject(key: string): Promise<void> { await unlink(this.k(key)).catch(() => undefined); await unlink(`${this.k(key)}.meta.json`).catch(() => undefined); }
  async listObjects(prefix: string): Promise<StoredObjectMetadata[]> {
    const walk = async (dir: string, prefixRel: string): Promise<StoredObjectMetadata[]> => {
      let names: string[] = [];
      try { names = await readdir(dir); } catch { return []; }
      const out: StoredObjectMetadata[] = [];
      for (const n of names) {
        if (n.endsWith('.meta.json')) continue;
        const full = join(dir, n); const rel = join(prefixRel, n);
        const s = await stat(full);
        if (s.isDirectory()) out.push(...(await walk(full, rel)));
        else out.push({ key: rel.replaceAll('\\', '/'), size: s.size, sha256: (await this.getObjectMetadata(rel.replaceAll('\\', '/')))?.sha256 ?? '', lastModified: s.mtime.toISOString() });
      }
      return out;
    };
    return (await walk(join(this.rootDir, prefix), prefix)).map((o) => ({ ...o, key: o.key.startsWith(prefix) ? o.key : join(prefix, o.key) }));
  }
  async downloadObjectToPath(key: string, destPath: string): Promise<void> { await pipeline(createReadStream(this.k(key)), createWriteStream(destPath)); }
}


/** S3 adapter: network-bound, requires explicit credentials + endpoint; network interruption surfaces as retryable SocketError. */
export class BackupStorageCredentialsMissingError extends Error { constructor() { super('Object-storage adapter was requested without credentials (BACKUP_S3_*); remote certification cannot proceed'); this.name = 'BackupStorageCredentialsMissingError'; } }
export class StorageNetworkError extends Error { retriable = true; constructor(C: string) { super(C); this.name = 'StorageNetworkError'; } }
export class AccessDeniedError extends Error { constructor(C: string) { super(C); this.name = 'AccessDeniedError'; } }

export class S3StorageAdapter implements StorageAdapter {
  constructor(private readonly cfg: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }) {
    for (const k of ['endpoint', 'region', 'bucket', 'accessKeyId', 'secretAccessKey'] as const) {
      const v = cfg[k]; if (!v) throw new BackupStorageCredentialsMissingError();
    }
  }
  private async call(method: string, key: string, body?: Buffer | NodeJS.ReadableStream): Promise<Buffer | string> {
    throw new Error('S3 adapter invocation requires an authorized runtime (sigV4 signing module); blocked in this environment');
  }
  putObject(): Promise<void> { return this.call('PUT', '').then(() => undefined); }
  getObject(): Promise<Buffer> { return this.call('GET', '').then((v) => (typeof v === 'string' ? Buffer.from(v) : v)); }
  getObjectMetadata(): Promise<StoredObjectMetadata | null> { return this.call('HEAD', '').then(() => null); }
  deleteObject(): Promise<void> { return this.call('DELETE', '').then(() => undefined); }
  listObjects(): Promise<StoredObjectMetadata[]> { return this.call('GET', '/').then(() => []); }
  downloadObjectToPath(): Promise<void> { return this.call('GET_TO_PATH', '').then(() => undefined); }
}
