/**
 * Phase 6 — process-wide encryption key ring accessor (src/lib/crypto.ts is the primitive).
 *
 * The ring is built once from env and cached; tests can inject one with setKeyRingForTesting.
 * A missing ring throws MissingEncryptionKeyError only at the moment a secret is actually
 * encrypted/decrypted, so deployments without secrets work with no key configured.
 */
import { buildKeyRing, type EncryptionKeyRing } from './crypto';
import { getEnv, resetEnvCache } from '../config/env';

let cachedRing: EncryptionKeyRing | null = null;
let cachedForEnv: string | null = null;

export function getKeyRing(): EncryptionKeyRing {
  const material = `${process.env.CREDENTIAL_ENCRYPTION_KEYS ?? ''}|${process.env.CREDENTIAL_ENCRYPTION_KEY ?? ''}`;
  if (cachedRing && cachedForEnv === material) return cachedRing;
  const env = getEnv();
  const ring = buildKeyRing(env.CREDENTIAL_ENCRYPTION_KEY, env.CREDENTIAL_ENCRYPTION_KEYS);
  cachedRing = ring;
  cachedForEnv = material;
  return ring;
}

export function setKeyRingForTesting(ring: EncryptionKeyRing | null): void {
  cachedRing = ring;
  cachedForEnv = null;
  resetEnvCache();
}
