const SENSITIVE_KEY = /authorization|cookie|password|passwd|secret|(?:^|[_-])token(?:$|[_-])|(?:access|refresh|bearer|auth)[_-]?token|(?:api|private|consumer|application)[_-]?key|user[_-]?data|cloud[_-]?init/i;
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 100;
const MAX_STRING_LENGTH = 4_096;

/**
 * Produces bounded, JSON-safe provider evidence suitable for an infrastructure job record.
 * Provider failures are intentionally retained for diagnosis, but credentials, cloud-init and
 * private key material must never reach database logs or admin API responses.
 */
export function sanitizeProviderResponse(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0,MAX_STRING_LENGTH)}…[truncated]` : value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name,message: sanitizeProviderResponse(value.message,depth + 1) };
  }
  if (Array.isArray(value)) {
    const result = value.slice(0,MAX_ARRAY_ITEMS).map((item) => sanitizeProviderResponse(item,depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) result.push(`[${value.length - MAX_ARRAY_ITEMS} more items]`);
    return result;
  }
  if (typeof value === 'object') {
    const result: Record<string,unknown> = {};
    const entries = Object.entries(value as Record<string,unknown>);
    for (const [key,item] of entries.slice(0,MAX_OBJECT_KEYS)) {
      result[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeProviderResponse(item,depth + 1);
    }
    if (entries.length > MAX_OBJECT_KEYS) result._truncated = `${entries.length - MAX_OBJECT_KEYS} more keys`;
    return result;
  }
  return String(value);
}

export function sanitizeProviderRecord(value: unknown): Record<string,unknown> | null {
  const sanitized = sanitizeProviderResponse(value);
  return sanitized !== null && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as Record<string,unknown>
    : null;
}
