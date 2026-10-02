/** Agent registry + model router persistence. */
import type { Queryable } from '../../db/types';
import type { AgentRow, ModelConfigRow } from '../types';

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function normalizeAgent(row: AgentRow): AgentRow {
  return {
    ...row,
    permissions: stringArray(row.permissions),
    tools: stringArray(row.tools),
    task_types: stringArray(row.task_types),
  };
}

export async function listAgents(db: Queryable, opts: { category?: string; boardOnly?: boolean } = {}): Promise<AgentRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.category) {
    params.push(opts.category);
    conditions.push(`category = $${params.length}`);
  }
  if (opts.boardOnly) conditions.push('board_seat IS NOT NULL');
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query<AgentRow>(
    `SELECT * FROM ai_agents ${where} ORDER BY category, board_seat NULLS LAST, name`,
    params
  );
  return rows.map(normalizeAgent);
}

export async function getAgentBySlug(db: Queryable, slug: string): Promise<AgentRow | null> {
  const { rows } = await db.query<AgentRow>(`SELECT * FROM ai_agents WHERE slug = $1`, [slug]);
  return rows[0] ? normalizeAgent(rows[0]) : null;
}

export async function getAgentById(db: Queryable, id: string): Promise<AgentRow | null> {
  const { rows } = await db.query<AgentRow>(`SELECT * FROM ai_agents WHERE id = $1`, [id]);
  return rows[0] ? normalizeAgent(rows[0]) : null;
}

export async function setAgentEnabled(db: Queryable, slug: string, enabled: boolean): Promise<AgentRow | null> {
  const { rows } = await db.query<AgentRow>(
    `UPDATE ai_agents SET enabled = $2, status = CASE WHEN $2 THEN 'active' ELSE 'disabled' END, updated_at = now()
     WHERE slug = $1 RETURNING *`,
    [slug, enabled]
  );
  return rows[0] ? normalizeAgent(rows[0]) : null;
}

export async function insertAgentVersion(
  db: Queryable,
  agentId: string,
  version: number,
  config: Record<string, unknown>,
  createdBy: string | null,
  notes: string | null
): Promise<void> {
  await db.query(
    `INSERT INTO ai_agent_versions (agent_id, version, config, created_by, change_notes)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (agent_id, version) DO NOTHING`,
    [agentId, version, JSON.stringify(config), createdBy, notes]
  );
}

export async function listAgentVersions(db: Queryable, agentId: string): Promise<Array<Record<string, unknown>>> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM ai_agent_versions WHERE agent_id = $1 ORDER BY version DESC LIMIT 25`,
    [agentId]
  );
  return rows;
}

// ---------------------------------------------------------------- model router configs

export async function listModelConfigs(db: Queryable): Promise<ModelConfigRow[]> {
  const { rows } = await db.query<ModelConfigRow>(`SELECT * FROM ai_model_configs ORDER BY engine`);
  return rows;
}

export async function getModelConfig(db: Queryable, engine: string): Promise<ModelConfigRow | null> {
  const { rows } = await db.query<ModelConfigRow>(`SELECT * FROM ai_model_configs WHERE engine = $1`, [engine]);
  return rows[0] ?? null;
}

export async function upsertModelConfig(
  db: Queryable,
  input: { engine: string; provider?: string | null; model?: string | null; endpoint?: string | null; enabled: boolean; notes?: string | null }
): Promise<ModelConfigRow> {
  const { rows } = await db.query<ModelConfigRow>(
    `INSERT INTO ai_model_configs (engine, provider, model, endpoint, enabled, notes)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (engine) DO UPDATE SET
       provider = EXCLUDED.provider, model = EXCLUDED.model, endpoint = EXCLUDED.endpoint,
       enabled = EXCLUDED.enabled, notes = EXCLUDED.notes, updated_at = now()
     RETURNING *`,
    [input.engine, input.provider ?? null, input.model ?? null, input.endpoint ?? null, input.enabled, input.notes ?? null]
  );
  if (!rows[0]) throw new Error('ai_model_configs: upsert returned no row');
  return rows[0];
}
