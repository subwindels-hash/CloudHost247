/** Accept only local application paths for post-authentication navigation. */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, 'https://local.invalid');
    if (url.origin !== 'https://local.invalid' || ['/login', '/register'].includes(url.pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function authLink(path: '/login' | '/register', destination: string | null): string {
  return destination ? `${path}?next=${encodeURIComponent(destination)}` : path;
}
