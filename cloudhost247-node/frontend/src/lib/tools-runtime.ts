/** The WHMCS adapter supplies paths, never credentials or invented tool data. */
export function toolsHost() {
  const node =
    typeof document === 'undefined'
      ? null
      : document.getElementById('ch247-tools-root');
  return {
    embedded: Boolean(node),
    webRoot: node?.dataset.webRoot ?? '',
    platform: node?.dataset.platform ?? '',
    apiBase: node?.dataset.apiBase ?? '',
  };
}
export function toolsApiPath(path: string): string {
  const host = toolsHost();
  const base = host.embedded
    ? host.apiBase
    : import.meta.env.BASE_URL.replace(/\/$/, '');
  if (base && !/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(base))
    throw new Error('Invalid tools API mount.');
  return base + path;
}
