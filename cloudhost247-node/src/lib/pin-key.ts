/**
 * Small helper around the Security PIN key so route handlers can *check* configuration before they
 * do any work (and fail with an honest 503) instead of discovering the problem mid-transaction.
 *
 * The key itself is derived in src/services/security-pin-service.ts (`resolvePinKey`); this module
 * exists only to avoid importing the service into places that merely need to ask "is it set?".
 */
import { MissingPinKeyError, resolvePinKey } from '../services/security-pin-service';

/** The derived PIN key, or null when neither dedicated nor fallback key material is configured. */
export function pinKeyOrNull(source: NodeJS.ProcessEnv = process.env): Buffer | null {
  try {
    return resolvePinKey(source);
  } catch (error) {
    if (error instanceof MissingPinKeyError) return null;
    throw error;
  }
}

/** True when a Security PIN can be hashed/verified in this process. */
export function isPinKeyConfigured(source: NodeJS.ProcessEnv = process.env): boolean {
  return pinKeyOrNull(source) !== null;
}
