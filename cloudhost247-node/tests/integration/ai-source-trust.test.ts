import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { syncWebsiteKnowledge } from '../../src/ai-website/knowledge-sync';
import { retrieveKnowledge } from '../../src/ai-website/retrieval';
import { assessRetrievedSources, trustInventory } from '../../src/ai-website/source-trust';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';

const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/test', JWT_SECRET: 't'.repeat(40) });
describe('source trust on migrated SQL and real routes', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    await syncWebsiteKnowledge(db, { trigger: 'manual' });
  });
  afterEach(async () => { await db.close(); });
  async function token(role: 'staff' | 'admin' | 'customer') {
    const id = randomUUID(), email = `${id}@example.test`;
    await db.query(`INSERT INTO users (id,email,password_hash,full_name,role,status) VALUES ($1,$2,$3,'Test reviewer',$4,'active')`, [id,email,await hashPassword('Test-password-123'),role]);
    return signAuthToken(env, { sub: id, role, email });
  }
  it('compares peers outside the search result and keeps conflict trace private during handoff', async () => {
    const first = await retrieveKnowledge(db, 'What is VPS hosting?');
    expect(first.pages.length).toBeGreaterThan(0);
    const ids = [...new Set(first.chunks.map(c => c.sourceId))];
    await db.query(`UPDATE ai_knowledge_sources SET approval_status='approved', authority_tier=2,
      approved_fingerprint=fingerprint, verified_claims='{"test.vps.usd.monthly":"10"}'::jsonb WHERE id = ANY($1::uuid[])`, [ids]);
    const peer = await db.query<{ id: string }>(`SELECT id FROM ai_knowledge_sources WHERE sync_status='indexed' AND NOT (id = ANY($1::uuid[])) LIMIT 1`, [ids]);
    await db.query(`UPDATE ai_knowledge_sources SET approval_status='approved', authority_tier=2,
      approved_fingerprint=fingerprint, verified_claims='{"test.vps.usd.monthly":"20"}'::jsonb WHERE id=$1`, [peer.rows[0]!.id]);
    expect((await retrieveKnowledge(db, 'What is VPS hosting?')).verificationFailure).toBe('SOURCE_CONFLICT');
    const app = buildApp(env, { serveFrontend: false, pool: db });
    try {
      const created = (await app.inject({ method:'POST', url:'/api/v1/ai-support/conversations' })).json();
      const response = await app.inject({ method:'POST', url:`/api/v1/ai-support/conversations/${created.conversationId}/messages`, headers:{'x-ai-conversation-token':created.accessToken}, payload:{message:'What is VPS hosting?'} });
      expect(response.statusCode).toBe(200);
      expect(response.json().decision).toMatchObject({kind:'ESCALATE', knowledgeFailure:'SOURCE_CONFLICT', sources:[]});
      expect(response.json().decision.body).toContain('conflicting');
      expect(response.json().decision.trustTrace).toBeUndefined();
      expect(response.body).not.toContain(peer.rows[0]!.id);
      const audits = await db.query<{ metadata: any }>(`SELECT metadata FROM audit_logs WHERE action='AI_ESCALATION_TRIGGERED' AND resource_id=$1`, [created.conversationId]);
      expect(audits.rows[0]?.metadata.retrieval.outcome).toBe('conflict');
      expect(audits.rows[0]?.metadata.retrieval.conflicts[0].sourceIds).toContain(peer.rows[0]!.id);
      expect(JSON.stringify(audits.rows)).not.toContain('test.vps.usd.monthly');
      expect((await db.query<{ count: string }>('SELECT count(*)::text AS count FROM ai_support_unanswered_questions')).rows[0]?.count).toBe('0');
      expect((await trustInventory(db)).conflicting).toBeGreaterThan(0);
    } finally { await app.close(); }
  });
  it('detects stale evidence, revision invalidation and synchronization recovery', async () => {
    await db.query("UPDATE ai_knowledge_sources SET last_synced_at=now()-interval '8 days'");
    const stale = await retrieveKnowledge(db, 'What is VPS hosting?');
    expect(stale.verificationFailure).toBe('SOURCE_NOT_CURRENT');
    expect(stale.pages).toEqual([]);
    await syncWebsiteKnowledge(db, {trigger:'manual'});
    expect((await retrieveKnowledge(db, 'What is VPS hosting?')).verificationFailure).toBeUndefined();
    const source = await db.query<{id:string}>("SELECT id FROM ai_knowledge_sources WHERE sync_status='indexed' LIMIT 1");
    const id = source.rows[0]!.id;
    await db.query("UPDATE ai_knowledge_sources SET approval_status='approved', approved_fingerprint=repeat('b',64) WHERE id=$1",[id]);
    expect((await assessRetrievedSources(db,[id])).sources[0]?.freshness).toBe('revision_unapproved');
  });
  it('enforces dashboard and review RBAC, revision binding and safe audit records', async () => {
    const app = buildApp(env, {serveFrontend:false,pool:db});
    try {
      const url='/api/v1/admin/ai-support/knowledge/overview';
      expect((await app.inject({method:'GET',url})).statusCode).toBe(401);
      const customer = await token('customer'), staff = await token('staff'), admin = await token('admin');
      expect((await app.inject({method:'GET',url,headers:{authorization:`Bearer ${customer}`}})).statusCode).toBe(403);
      const overview=await app.inject({method:'GET',url,headers:{authorization:`Bearer ${staff}`}});
      expect(overview.statusCode).toBe(200); expect(overview.json().trust.healthy).toBeGreaterThan(0);
      const source=await db.query<{id:string;fingerprint:string}>("SELECT id,fingerprint FROM ai_knowledge_sources WHERE source_kind='faq' AND sync_status='indexed' LIMIT 1");
      const row=source.rows[0]!;
      const reviewUrl=`/api/v1/admin/ai-support/knowledge/sources/${row.id}/trust`;
      const payload={fingerprint:row.fingerprint,approval:'approved',authority:4,historical:false,validUntil:null,claims:{}};
      expect((await app.inject({method:'PATCH',url:reviewUrl,headers:{authorization:`Bearer ${staff}`},payload})).statusCode).toBe(403);
      expect((await app.inject({method:'PATCH',url:reviewUrl,headers:{authorization:`Bearer ${admin}`},payload:{...payload,fingerprint:'0'.repeat(64)}})).statusCode).toBe(400);
      const reviewed=await app.inject({method:'PATCH',url:reviewUrl,headers:{authorization:`Bearer ${admin}`},payload});
      expect(reviewed.statusCode).toBe(200);
      expect((await db.query<{approval_status:string}>('SELECT approval_status FROM ai_knowledge_sources WHERE id=$1',[row.id])).rows[0]?.approval_status).toBe('approved');
      expect((await db.query("SELECT id FROM audit_logs WHERE action='AI_KNOWLEDGE_TRUST_REVIEWED'")).rows.length).toBe(1);
    } finally { await app.close(); }
  });
});
