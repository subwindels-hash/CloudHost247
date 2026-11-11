/** Endpoint construction shared by the existing model adapters; never selects a provider/model. */
export function providerEndpoint(baseUrl: string, style: 'openai' | 'anthropic'): string {
  const url = new URL(baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Model endpoint must be an HTTP(S) API root without credentials, query or fragment');
  }
  const base = baseUrl.replace(/\/+$/, '');
  // Anthropic operators commonly configure either the origin or an API root ending in /v1.
  // Preserve gateway path prefixes; do not rewrite an OpenAI-compatible API root.
  return style === 'anthropic'
    ? `${base}${url.pathname.replace(/\/+$/, '').endsWith('/v1') ? '' : '/v1'}/messages`
    : `${base}/chat/completions`;
}
