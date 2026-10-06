/**
 * AI generation engine registry.
 *
 * Resolves an engine key to a provider, and never invents one. The `rules` engine always resolves
 * (it needs nothing); the external engines resolve only when their credentials are present in the
 * environment, so the API can report precisely why a model engine is unavailable — and the platform
 * can never quietly answer with the built-in generator when a model was requested.
 */
import type { Env } from '../../config/env';
import { AiProviderError, type AiEngine, type SiteGenerationProvider } from './types';
import { rulesProvider } from './rules-provider';
import { createLlmProvider } from './llm-provider';

export const DEFAULT_ENGINE: AiEngine = 'rules';

/** Engines a customer may ask for, in the order the UI offers them. */
export function listEngines(env: Env): Array<{ engine: AiEngine; label: string; configured: boolean; reason: string | null }> {
  return [rulesProvider, ...externalProviders(env)].map((provider) => {
    const state = provider.isConfigured();
    return { engine: provider.engine, label: provider.label, configured: state.configured, reason: state.reason };
  });
}

function externalProviders(env: Env): SiteGenerationProvider[] {
  return [
    createLlmProvider({
      apiStyle: env.AI_LLM_API_STYLE === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl: env.AI_LLM_BASE_URL ?? null,
      apiKey: env.AI_LLM_API_KEY ?? null,
      model: env.AI_LLM_MODEL ?? null,
      timeoutMs: env.AI_LLM_TIMEOUT_MS,
    }),
  ];
}

/** The configured state of every engine, for the customer-facing engine picker. */
export function resolveProvider(env: Env, engine: string): SiteGenerationProvider {
  if (engine === 'rules') return rulesProvider;
  const provider = externalProviders(env).find((candidate) => candidate.engine === engine || candidate.engine === 'llm');
  if (!provider) {
    throw new AiProviderError('CONFIGURATION_REQUIRED', `No generator is registered for engine "${engine}"`);
  }
  const state = provider.isConfigured();
  if (!state.configured) {
    throw new AiProviderError('CONFIGURATION_REQUIRED', state.reason ?? 'The requested generator is not configured');
  }
  return provider;
}
