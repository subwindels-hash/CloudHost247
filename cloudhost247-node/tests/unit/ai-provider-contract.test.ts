import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerEndpoint } from '../../src/builders/ai/provider-endpoint';
import { resolveProvider } from '../../src/builders/ai/registry';
import type { Env } from '../../src/config/env';
import { createLlmProvider } from '../../src/builders/ai/llm-provider';

const config = { apiStyle: 'openai' as const, baseUrl: 'https://provider.example/v1', apiKey: 'fixture-key', model: 'fixture-model' };
const brief = { businessName: 'Example', description: 'A business description for a test website.' };
afterEach(() => vi.unstubAllGlobals());

describe('existing model adapters: endpoint contract', () => {
  it.each([
    ['https://provider.example', 'anthropic', 'https://provider.example/v1/messages'],
    ['https://provider.example/v1/', 'anthropic', 'https://provider.example/v1/messages'],
    ['https://provider.example/gateway/v1///', 'anthropic', 'https://provider.example/gateway/v1/messages'],
    ['https://provider.example/gateway', 'anthropic', 'https://provider.example/gateway/v1/messages'],
    ['https://provider.example/v1/', 'openai', 'https://provider.example/v1/chat/completions'],
  ] as const)('%s (%s)', (base, style, expected) => {
    expect(providerEndpoint(base, style)).toBe(expected);
  });
  it.each(['file:///tmp/model', 'https://user:secret@provider.example', 'https://provider.example?key=secret', 'https://provider.example/#secret', 'not-a-url'])('rejects invalid API root %s before fetch', async (baseUrl) => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const provider = createLlmProvider({ ...config, baseUrl });
    expect(provider.isConfigured().configured).toBe(false);
    await expect(provider.generate({ brief })).rejects.toMatchObject({ code: 'CONFIGURATION_REQUIRED', retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('website generation: safe provider failures', () => {
  it.each([
    [400, 'INVALID_REQUEST', false], [422, 'INVALID_REQUEST', false],
    [401, 'CONFIGURATION_REQUIRED', false], [403, 'CONFIGURATION_REQUIRED', false],
    [404, 'CONFIGURATION_REQUIRED', false], [413, 'REQUEST_TOO_LARGE', false],
    [429, 'RATE_LIMITED', true], [500, 'PROVIDER_ERROR', true], [503, 'PROVIDER_ERROR', true],
  ])('classifies HTTP %s without retaining response text or retrying', async (status, code, retryable) => {
    const fetcher = vi.fn().mockResolvedValue(new Response('private prompt credential-secret', { status: Number(status) }));
    vi.stubGlobal('fetch', fetcher);
    const error = await createLlmProvider(config).generate({ brief }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code, retryable, httpStatus: status });
    expect(String(error)).not.toMatch(/private prompt|credential-secret/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['{broken', 'null', '[]', '{}', '{"choices":{}}', '{"choices":[{"message":{"content":42}}]}'])('invalid transport response: %s', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    await expect(createLlmProvider(config).generate({ brief })).rejects.toMatchObject({ code: 'INVALID_RESPONSE', retryable: false });
  });
  it.each(['openai', 'anthropic'] as const)('parses a valid %s text response through section validation', async (apiStyle) => {
    const plan = JSON.stringify({ name: 'Example', pages: [{ title: 'Home', path: '/', sections: [
      { type: 'rich_text', props: { heading: 'Welcome', body: 'Example business information.', align: 'left' } },
    ] }] });
    const payload = apiStyle === 'openai'
      ? { id: 'fixture-reference', choices: [{ message: { content: plan } }] }
      : { id: 'fixture-reference', content: [{ type: 'text', text: plan }] };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal('fetch', fetcher);
    const onProviderReference = vi.fn();
    const result = await createLlmProvider({ ...config, apiStyle }).generate({ brief, onProviderReference });
    expect(result.pages[0]).toMatchObject({ title: 'Home', path: '/' });
    expect(onProviderReference).toHaveBeenCalledWith('fixture-reference');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not retain network exception text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private-url?key=secret')));
    await expect(createLlmProvider(config).generate({ brief })).rejects.toMatchObject({ code: 'PROVIDER_ERROR', message: 'Provider transport failed' });
  });
  it('recognizes timeout without retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    await expect(createLlmProvider(config).generate({ brief })).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
  });
  it('rejects missing credentials without outbound calls', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(createLlmProvider({ ...config, apiKey: null }).generate({ brief })).rejects.toMatchObject({ code: 'CONFIGURATION_REQUIRED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses the configured Anthropic model and versioned endpoint without fallback', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"content":[]}'));
    vi.stubGlobal('fetch', fetcher);
    await expect(createLlmProvider({ ...config, apiStyle: 'anthropic' }).generate({ brief })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://provider.example/v1/messages');
    expect(init.headers['x-api-key']).toBe('fixture-key');
    expect(init.headers.authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toMatchObject({ model: 'fixture-model', messages: [{ role: 'user' }] });
  });
});

describe('explicit engine selection', () => {
  const env = { AI_LLM_BASE_URL: config.baseUrl, AI_LLM_MODEL: config.model, AI_LLM_API_KEY: config.apiKey };
  it.each([['openai', 'anthropic'], ['anthropic', 'llm']] as const)('does not route %s configuration to requested %s engine', (style, requested) => {
    expect(() => resolveProvider({ ...env, AI_LLM_API_STYLE: style } as Env, requested))
      .toThrow(/No generator is registered/);
  });
  it.each([['openai', 'llm'], ['anthropic', 'anthropic']] as const)('resolves %s only when explicitly selected as %s', (style, requested) => {
    expect(resolveProvider({ ...env, AI_LLM_API_STYLE: style } as Env, requested).engine).toBe(requested);
  });
});
