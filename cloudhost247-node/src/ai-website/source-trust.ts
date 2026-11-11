import type { Queryable } from '../db/types';

/** Authority is assigned by an authorized reviewer, never inferred from a source title. */
export interface TrustSource {
  id: string;
  source_kind: string | null;
  fingerprint: string | null;
  approval_status: string;
  authority_tier: number;
  approved_fingerprint: string | null;
  last_synced_at: string | Date | null;
  source_modified_at: string | Date | null;
  valid_until: string | Date | null;
  historical: boolean;
  sync_status: string;
  status: string;
  excluded: boolean;
  verified_claims: Record<string, string>;
  chunk_count?: number;
  actual_chunks?: number;
}
export type Freshness = 'current' | 'stale' | 'unsynchronized' | 'historical' | 'rejected' | 'revision_unapproved';
export interface TrustTrace {
  retrieved: string[];
  selected: string[];
  sources: Array<{ id: string; authority: number; approval: string; freshness: Freshness }>;
  conflicts: Array<{ sourceIds: string[]; status: 'resolved_by_authority' | 'unresolved' }>;
  outcome: 'selected' | 'no_match' | 'stale' | 'conflict' | 'unavailable';
  escalationReason: string | null;
}
const stamp = (value: string | Date | null) => value === null ? NaN : new Date(value).getTime();
export function freshness(source: TrustSource, now = Date.now()): Freshness {
  if (source.approval_status === 'rejected') return 'rejected';
  if (source.historical) return 'historical';
  if (source.sync_status !== 'indexed' || source.excluded || source.status !== 'active') return 'unsynchronized';
  if (source.actual_chunks !== undefined && (Number(source.actual_chunks) === 0 || Number(source.actual_chunks) !== Number(source.chunk_count))) return 'unsynchronized';
  const synced = stamp(source.last_synced_at);
  const modified = stamp(source.source_modified_at);
  if (!Number.isFinite(synced) || (Number.isFinite(modified) && modified > synced)) return 'unsynchronized';
  if (now - synced > 7 * 86400000 || synced > now + 60000 || (source.valid_until && stamp(source.valid_until) <= now)) return 'stale';
  if (source.approval_status === 'approved' && (!source.fingerprint || source.approved_fingerprint !== source.fingerprint)) return 'revision_unapproved';
  return 'current';
}
export function authority(source: TrustSource): number {
  return source.approval_status === 'approved' && source.approved_fingerprint === source.fingerprint
    ? Number(source.authority_tier) : 6;
}

/** Only compare reviewer-normalized, scoped fact keys (including currency/term/region).
 * Equal-authority contradictions are NOT resolved by timestamps alone.
 * This is not a general natural-language contradiction detector.
 */
export function assessSources(sources: TrustSource[], retrieved: string[], now = Date.now()): TrustTrace {
  const byId = new Map(sources.map(s => [s.id, s]));
  const trace: TrustTrace = {
    retrieved: [...new Set(retrieved)], selected: [],
    sources: sources.map(s => ({ id: s.id, authority: authority(s), approval: s.approval_status, freshness: freshness(s, now) })),
    conflicts: [], outcome: 'no_match', escalationReason: null,
  };
  if (retrieved.some(id => !byId.has(id))) return { ...trace, outcome: 'unavailable', escalationReason: 'TRUST_METADATA_UNAVAILABLE' };
  const current = sources.filter(s => freshness(s, now) === 'current');
  const keys = new Set(retrieved.flatMap(id => Object.keys(byId.get(id)?.verified_claims ?? {})));
  const blocked = new Set<string>();
  for (const key of keys) {
    const records = sources.filter(s => Object.prototype.hasOwnProperty.call(s.verified_claims, key));
    const eligible = current.filter(s => records.includes(s) && authority(s) < 6);
    if (eligible.length === 0) continue;
    const best = Math.min(...eligible.map(authority));
    const strongest = eligible.filter(s => authority(s) === best);
    const values = new Set(strongest.map(s => s.verified_claims[key]));
    if (values.size > 1) {
      trace.conflicts.push({ sourceIds: strongest.map(s => s.id).sort(), status: 'unresolved' });
    } else {
      const value = strongest[0]!.verified_claims[key];
      const disagree = records.filter(s => s.verified_claims[key] !== value);
      if (disagree.length) {
        trace.conflicts.push({ sourceIds: [...new Set([...strongest, ...disagree].map(s => s.id))].sort(), status: 'resolved_by_authority' });
        for (const s of disagree) blocked.add(s.id);
      }
    }
  }
  if (trace.conflicts.some(c => c.status === 'unresolved')) return { ...trace, outcome: 'conflict', escalationReason: 'SOURCE_CONFLICT' };
  const eligible = current.filter(s => retrieved.includes(s.id) && !blocked.has(s.id));
  // An approved source cannot be overridden by an unreviewed/high-lexical-score FAQ.
  const best = eligible.length ? Math.min(...eligible.map(authority)) : 6;
  trace.selected = eligible.filter(s => authority(s) === best).sort((a,b) => a.id.localeCompare(b.id)).map(s => s.id);
  trace.outcome = trace.selected.length ? 'selected' : retrieved.length ? 'stale' : 'no_match';
  trace.escalationReason = trace.outcome === 'stale' ? 'SOURCE_NOT_CURRENT' : null;
  return trace;
}

export async function assessRetrievedSources(db: Queryable, ids: string[]): Promise<TrustTrace> {
  if (!ids.length) return assessSources([], []);
  const result = await db.query<TrustSource>(
    `SELECT id, source_kind, fingerprint, approval_status, authority_tier, approved_fingerprint,
            last_synced_at, source_modified_at, valid_until, historical, sync_status, status, excluded, verified_claims, chunk_count,
            (SELECT count(*) FROM ai_knowledge_chunks WHERE source_id = ai_knowledge_sources.id)::int AS actual_chunks
       FROM ai_knowledge_sources
      WHERE id = ANY($1::uuid[]) OR (status = 'active' AND excluded = false AND
        verified_claims ?| ARRAY(SELECT DISTINCT jsonb_object_keys(verified_claims)
          FROM ai_knowledge_sources WHERE id = ANY($1::uuid[])))`, [ids]);
  return assessSources(result.rows, ids);
}

/** Live inventory, not demo metrics; same freshness/authority rules as retrieval. */
export async function trustInventory(db: Queryable) {
  const { rows } = await db.query<TrustSource>(`SELECT id, source_kind, fingerprint, approval_status,
    authority_tier, approved_fingerprint, last_synced_at, source_modified_at, valid_until, historical,
    sync_status, status, excluded, verified_claims, chunk_count,
    (SELECT count(*) FROM ai_knowledge_chunks WHERE source_id = ai_knowledge_sources.id)::int AS actual_chunks FROM ai_knowledge_sources WHERE source_key IS NOT NULL`);
  const trace = assessSources(rows, rows.filter(s => s.status === 'active' && !s.excluded).map(s => s.id));
  return { sources: trace.sources, conflicts: trace.conflicts,
    healthy: trace.sources.filter(s => s.freshness === 'current').length,
    stale: trace.sources.filter(s => ['stale', 'historical', 'revision_unapproved'].includes(s.freshness)).length,
    unavailable: trace.sources.filter(s => ['unsynchronized', 'rejected'].includes(s.freshness)).length,
    conflicting: new Set(trace.conflicts.filter(c => c.status === 'unresolved').flatMap(c => c.sourceIds)).size };
}
