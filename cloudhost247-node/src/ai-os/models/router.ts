/**
 * Model Router (spec §28).
 *
 * Selects the engine for a run. The native `deterministic` engine executes registered,
 * reviewable handlers against real data — the default for every seeded agent because it can
 * never fabricate. External engines exist in ai_model_configs but are seeded disabled; routing
 * to one that is not explicitly enabled and configured fails CLOSED with CONFIGURATION_REQUIRED
 * (spec §37) instead of silently degrading or simulating output.
 *
 * Cost/latency/risk trade-offs (small model for classification, larger for reasoning — §28) are
 * expressed through ai_model_configs.config metadata when external engines are configured; the
 * router never invents a fallback chain the operator did not define.
 */
import type { Queryable } from '../../db/types';
import type { AgentRow } from '../types';
import { getModelConfig } from '../repositories/registry-repo';

export interface ModelResolution {
  engine: string;
  model: string;
  tier: string;
}

export class ModelResolutionError extends Error {
  readonly code = 'CONFIGURATION_REQUIRED';
  constructor(message: string) {
    super(message);
    this.name = 'ModelResolutionError';
  }
}

export async function resolveModelForAgent(db: Queryable, agent: AgentRow): Promise<ModelResolution> {
  const engine = agent.engine || 'deterministic';
  const config = await getModelConfig(db, engine);

  if (engine === 'deterministic') {
    // The native engine is a first-class engine with a seeded enabled row; if someone disabled
    // it, that is a platform misconfiguration, not a reason to substitute anything else.
    if (!config || !config.enabled) {
      throw new ModelResolutionError(
        'The native deterministic engine is disabled in ai_model_configs. Re-enable it (Admin → AI → Settings) — no substitute engine will be assumed.'
      );
    }
    return { engine: 'deterministic', model: 'cloudhost247-native', tier: 'native' };
  }

  // External engines: fail closed unless explicitly enabled AND carrying a concrete model/endpoint.
  if (!config) {
    throw new ModelResolutionError(
      `Model engine '${engine}' has no configuration row (Admin → AI → Settings → Model engines). CONFIGURATION_REQUIRED.`
    );
  }
  if (!config.enabled) {
    throw new ModelResolutionError(
      `Model engine '${engine}' is disabled. Enable it explicitly after configuring provider/model/endpoint — the platform will not fall back to a different engine silently. CONFIGURATION_REQUIRED.`
    );
  }
  if (!config.model && !config.endpoint) {
    throw new ModelResolutionError(
      `Model engine '${engine}' is enabled but has no model or endpoint configured. CONFIGURATION_REQUIRED.`
    );
  }
  return { engine: config.engine, model: config.model ?? 'external-endpoint', tier: config.engine };
}
