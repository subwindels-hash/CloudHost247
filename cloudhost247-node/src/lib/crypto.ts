/**
 * Phase 6 — encryption at rest for server credentials and application secrets (spec §6, §16).
 *
 * Envelope format: `v<keyVersion>:<base64 iv>:<base64 tag>:<base64 ciphertext>`
 *
 * - AES-256-GCM: authenticated, so ciphertext tampering fails closed at decrypt time rather than
 *   silently decrypting attacker-chosen plaintext.
 * - Key versions: CREDENTIAL_ENCRYPTION_KEYS maps version → 32-byte key. Version 1 may also be
 *   supplied via CREDENTIAL_ENCRYPTION_KEY (single-key convenience). New writes always use the
 *   highest configured version; reads decrypt with the version recorded in the envelope, so
 *   rotation is: add the new version → re-save secrets opportunistically (rotateCredential) →
 *   eventually remove the old version. `currentKeyVersion()` is the source of truth for both.
 *
 * This is deliberately a small, dependency-free module (node:crypto only) with a hard rule:
 * nothing outside this file knows the envelope format.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface EncryptionKeyRing {
  /** version number → raw 32-byte key material. */
  keys: Map<number, Buffer>;
}

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super(
      'CREDENTIAL_ENCRYPTION_KEYS (or CREDENTIAL_ENCRYPTION_KEY) must be configured before secrets can be stored'
    );
    this.name = 'MissingEncryptionKeyError';
  }
}

export class DecryptionError extends Error {
  constructor(message = 'Unable to decrypt stored secret — wrong key version or tampered ciphertext') {
    super(message);
    this.name = 'DecryptionError';
  }
}

function parseKeyMaterial(raw: string): Buffer {
  // Accept hex (64 chars) or base64 (44 chars) — both encode exactly 32 bytes.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const b64 = Buffer.from(raw, 'base64');
  if (b64.length === 32) return b64;
  throw new Error('Encryption key material must be 32 bytes, hex- or base64-encoded');
}

/**
 * Builds the key ring from environment strings. Accepted shapes:
 *   CREDENTIAL_ENCRYPTION_KEY=hex64                       → ring {1: key}
 *   CREDENTIAL_ENCRYPTION_KEYS=1:hex64,2:hex64            → full versioned ring
 * Either may be present; if both are, CREDENTIAL_ENCRYPTION_KEYS wins (and may include version 1).
 */
export function buildKeyRing(singleKey?: string, versionedKeys?: string): EncryptionKeyRing {
  const keys = new Map<number, Buffer>();
  if (versionedKeys) {
    for (const part of versionedKeys.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const sep = trimmed.indexOf(':');
      if (sep <= 0) throw new Error(`CREDENTIAL_ENCRYPTION_KEYS entry "${trimmed}" must be "<version>:<key>"`);
      const version = Number.parseInt(trimmed.slice(0, sep), 10);
      if (!Number.isInteger(version) || version < 1 || version > 999) {
        throw new Error(`CREDENTIAL_ENCRYPTION_KEYS version must be an integer 1..999 (got "${trimmed.slice(0, sep)}")`);
      }
      keys.set(version, parseKeyMaterial(trimmed.slice(sep + 1)));
    }
  } else if (singleKey) {
    keys.set(1, parseKeyMaterial(singleKey));
  }
  if (keys.size === 0) throw new MissingEncryptionKeyError();
  return { keys };
}

export function currentKeyVersion(ring: EncryptionKeyRing): number {
  return Math.max(...ring.keys.keys());
}

/** Encrypts plaintext with the ring's newest key. Returns the versioned envelope string. */
export function encryptSecret(ring: EncryptionKeyRing, plaintext: string): string {
  const version = currentKeyVersion(ring);
  const key = ring.keys.get(version);
  if (!key) throw new MissingEncryptionKeyError();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${version}:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/** Decrypts a versioned envelope. Throws DecryptionError on any mismatch/tamper. */
export function decryptSecret(ring: EncryptionKeyRing, envelope: string): string {
  const match = /^v(\d{1,3}):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/.exec(envelope);
  const versionPart = match?.[1];
  const ivPart = match?.[2];
  const tagPart = match?.[3];
  const dataPart = match?.[4];
  if (!versionPart || !ivPart || !tagPart || !dataPart) throw new DecryptionError('Malformed secret envelope');
  const version = Number.parseInt(versionPart, 10);
  const key = ring.keys.get(version);
  if (!key) throw new DecryptionError(`No key configured for envelope version ${version}`);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new DecryptionError();
  }
}

/** True when the envelope decrypts under the ring's *newest* version (i.e. needs no rotation). */
export function isEnvelopeCurrent(ring: EncryptionKeyRing, envelope: string): boolean {
  const match = /^v(\d{1,3}):/.exec(envelope);
  const version = match?.[1];
  return !!version && Number.parseInt(version, 10) === currentKeyVersion(ring);
}

/** Re-encrypts an envelope under the newest key (no-op when already current). */
export function rotateEnvelope(ring: EncryptionKeyRing, envelope: string): string {
  if (isEnvelopeCurrent(ring, envelope)) return envelope;
  return encryptSecret(ring, decryptSecret(ring, envelope));
}

/**
 * Generates a strong secret for manifest-required env values (e.g. N8N_ENCRYPTION_KEY,
 * NEXTCLOUD_ADMIN_PASSWORD). 32 random bytes, base64url — no dictionary words, no patterns.
 */
export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Constant-time string comparison for token verification paths. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Deterministic short id used in container project names (never a security boundary). */
export function shortId(seed: string, length = 8): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, length);
}
