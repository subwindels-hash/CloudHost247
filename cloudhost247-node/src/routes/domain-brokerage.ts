import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { authenticate } from '../lib/require-auth';
import { requireRole } from '../lib/require-role';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';

const STAFF = ['admin', 'super_admin'] as const;
const domain = z.string().trim().toLowerCase().min(3).max(253).regex(/^(?=.{1,253}$)(?!-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/, 'A valid domain is required');
const id = z.string().uuid();
const money = z.number().positive().finite();
const createSchema = z.object({
  domain, customerName: z.string().min(1).max(255), contactInformation: z.string().min(1).max(1000),
  maxBudget: money, currency: z.string().length(3).regex(/^[a-z]{3}$/i), openingOffer: money.optional(),
  message: z.string().max(5000).optional(), negotiationInstructions: z.string().max(5000).optional(),
  deadline: z.string().datetime().optional(), termsAccepted: z.literal(true), idempotencyKey: z.string().min(8).max(128).optional(),
});
const offerSchema = z.object({ amount: money, currency: z.string().length(3).regex(/^[a-z]{3}$/i), recipientType: z.enum(['customer','broker','seller','provider']), expiresAt: z.string().datetime().optional() });
const messageSchema = z.object({ body: z.string().min(1).max(10000), visibility: z.enum(['customer','internal']).default('customer') });
const assignmentSchema = z.object({ brokerId: id });
const providerSchema = z.object({ providerKey: z.string().min(1).max(80), name: z.string().min(1).max(160), providerType: z.enum(['marketplace','broker','registrar','manual']), capabilities: z.record(z.boolean()).default({}), environment: z.enum(['sandbox','production']).default('production') });
function parse<T>(s: z.ZodType<T>, value: unknown): T { const r = s.safeParse(value); if (!r.success) throw new ValidationError(r.error.issues.map((i) => i.message).join(', ')); return r.data; }
function nextNumber(): string { return `BRK-${new Date().getUTCFullYear()}-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`; }
async function event(db: Queryable, caseId: string, actorId: string | null, type: string, metadata: Record<string, unknown> = {}) { await db.query('INSERT INTO domain_broker_events (id,case_id,actor_id,event_type,metadata,correlation_id) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), caseId, actorId, type, JSON.stringify(metadata), randomUUID()]); }
async function audit(db: Queryable, caseId: string | null, actorId: string | null, action: string, metadata: Record<string, unknown> = {}) { await db.query('INSERT INTO domain_broker_audit_logs (id,case_id,actor_id,action,metadata) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), caseId, actorId, action, JSON.stringify(metadata)]); }
async function ownCase(db: Queryable, userId: string, caseId: string) { const r = await db.query<any>('SELECT * FROM domain_broker_cases WHERE id=$1 AND user_id=$2', [caseId, userId]); if (!r.rows[0]) throw new NotFoundError('No brokerage case was found'); return r.rows[0]; }

export async function registerDomainBrokerageRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const db = overridePool ?? getPool(env);
  // This endpoint is deliberately honest: availability is supplied by the configured domain-search integration.
  app.get<{ Params: { domain: string } }>('/api/v1/domains/:domain/brokerage-status', async (req) => {
    const d = parse(domain, req.params.domain);
    const configured = await db.query<any>("SELECT capabilities,status FROM domain_broker_providers WHERE status='connected'");
    const canSearch = configured.rows.some((p) => p.capabilities?.domainAvailability === true || p.capabilities?.domainSearch === true);
    return { domain: d, status: canSearch ? 'unknown' : 'provider_unavailable', brokerThisDomain: false, message: canSearch ? 'Domain search result is not available from the configured provider.' : 'Domain provider temporarily unavailable. Please try again later.' };
  });
  app.post('/api/v1/account/domain-brokerage/cases', async (req, reply) => {
    const auth = await authenticate(req, env, db); const input = parse(createSchema, req.body); const currency = input.currency.toUpperCase();
    if (input.openingOffer && input.openingOffer > input.maxBudget) throw new ValidationError('Opening offer cannot exceed the confidential maximum budget');
    if (input.idempotencyKey) { const prior = await db.query<any>('SELECT * FROM domain_broker_cases WHERE user_id=$1 AND idempotency_key=$2', [auth.userId, input.idempotencyKey]); if (prior.rows[0]) return { case: prior.rows[0] }; }
    const caseId = randomUUID(); const brokerageId = nextNumber();
    try {
      const r = await db.query<any>(`INSERT INTO domain_broker_cases (id,brokerage_id,user_id,customer_name,contact_information,domain,domain_status,acquisition_route,max_budget,currency,opening_offer,deadline_at,negotiation_instructions,customer_message,terms_accepted_at,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,'registered','manual_broker_required',$7,$8,$9,$10,$11,$12,now(),$13) RETURNING *`, [caseId, brokerageId, auth.userId, input.customerName, input.contactInformation, input.domain, input.maxBudget, currency, input.openingOffer ?? null, input.deadline ?? null, input.negotiationInstructions ?? null, input.message ?? null, input.idempotencyKey ?? null]);
      await event(db, caseId, auth.userId, 'request_created'); await audit(db, caseId, auth.userId, 'case_created', { route: 'manual_broker_required' }); reply.code(201); return { case: r.rows[0] };
    } catch (e: any) { if (e?.code === '23505') throw new ConflictError('This brokerage request has already been submitted'); throw e; }
  });
  app.get('/api/v1/account/domain-brokerage/cases', async (req) => { const auth = await authenticate(req, env, db); const r = await db.query<any>('SELECT id,brokerage_id,domain,status,domain_status,acquisition_route,current_offer,currency,payment_status,transfer_status,assigned_broker_id,created_at,updated_at FROM domain_broker_cases WHERE user_id=$1 ORDER BY created_at DESC', [auth.userId]); return { cases: r.rows }; });
  app.get<{ Params: { id: string } }>('/api/v1/account/domain-brokerage/cases/:id', async (req) => { const auth = await authenticate(req, env, db); const caseId = parse(id, req.params.id); const c = await ownCase(db, auth.userId, caseId); const [offers, messages, events, docs, payment, transfer] = await Promise.all([db.query<any>('SELECT id,amount,currency,sender_type,recipient_type,status,expires_at,created_at FROM domain_broker_offers WHERE case_id=$1 ORDER BY created_at DESC',[caseId]), db.query<any>("SELECT id,author_id,body,created_at FROM domain_broker_messages WHERE case_id=$1 AND visibility='customer' ORDER BY created_at ASC",[caseId]), db.query<any>('SELECT event_type,result,metadata,created_at FROM domain_broker_events WHERE case_id=$1 ORDER BY created_at ASC',[caseId]), db.query<any>("SELECT id,name,visibility,created_at FROM domain_broker_documents WHERE case_id=$1 AND visibility='customer'",[caseId]), db.query<any>('SELECT * FROM domain_broker_payments WHERE case_id=$1',[caseId]), db.query<any>('SELECT * FROM domain_broker_transfers WHERE case_id=$1',[caseId])]); return { case: c, offers: offers.rows, messages: messages.rows, timeline: events.rows, documents: docs.rows, payment: payment.rows[0] ?? null, transfer: transfer.rows[0] ?? null }; });
  app.post<{ Params: { id: string } }>('/api/v1/account/domain-brokerage/cases/:id/offers', async (req) => { const auth = await authenticate(req, env, db); const caseId = parse(id, req.params.id); const c = await ownCase(db, auth.userId, caseId); const input = parse(offerSchema, req.body); if (input.amount > Number(c.max_budget)) throw new ValidationError('Offer exceeds your confidential maximum budget'); const r = await db.query<any>("INSERT INTO domain_broker_offers (id,case_id,amount,currency,sender_type,recipient_type,expires_at) VALUES ($1,$2,$3,$4,'customer',$5,$6) RETURNING *",[randomUUID(),caseId,input.amount,input.currency.toUpperCase(),input.recipientType,input.expiresAt ?? null]); await db.query("UPDATE domain_broker_cases SET current_offer=$1,status='negotiation',updated_at=now() WHERE id=$2",[input.amount,caseId]); await event(db,caseId,auth.userId,'customer_offer_submitted',{amount:input.amount,currency:input.currency.toUpperCase()}); return { offer:r.rows[0] }; });
  app.post<{ Params: { id: string } }>('/api/v1/account/domain-brokerage/cases/:id/messages', async (req) => { const auth = await authenticate(req, env, db); const caseId = parse(id, req.params.id); await ownCase(db, auth.userId, caseId); const input = parse(messageSchema, req.body); if (input.visibility === 'internal') throw new ValidationError('Customers cannot create internal notes'); const r = await db.query<any>('INSERT INTO domain_broker_messages (id,case_id,author_id,visibility,body) VALUES ($1,$2,$3,\'customer\',$4) RETURNING id,body,created_at',[randomUUID(),caseId,auth.userId,input.body]); await event(db,caseId,auth.userId,'customer_message'); return { message:r.rows[0] }; });

  app.post<{ Params: { id: string; offerId: string } }>('/api/v1/account/domain-brokerage/cases/:id/offers/:offerId/decision', async (req) => {
    const auth = await authenticate(req, env, db); const caseId = parse(id, req.params.id); const offerId = parse(id, req.params.offerId); await ownCase(db, auth.userId, caseId);
    const decision = z.object({ action: z.enum(['accept','reject']) }); const input = parse(decision, req.body);
    const offer = await db.query<any>("SELECT * FROM domain_broker_offers WHERE id=$1 AND case_id=$2 AND sender_type IN ('seller','provider') AND status='open'", [offerId, caseId]);
    if (!offer.rows[0]) throw new NotFoundError('No open seller offer was found');
    await db.query('UPDATE domain_broker_offers SET status=$1 WHERE id=$2 AND status=\'open\'', [input.action === 'accept' ? 'accepted' : 'rejected', offerId]);
    await db.query('UPDATE domain_broker_cases SET status=$1,updated_at=now() WHERE id=$2', [input.action === 'accept' ? 'offer_accepted' : 'negotiation', caseId]);
    await event(db, caseId, auth.userId, input.action === 'accept' ? 'customer_approved_offer' : 'customer_rejected_offer', { offerId });
    await audit(db, caseId, auth.userId, `offer_${input.action}`, { offerId }); return { ok: true, status: input.action === 'accept' ? 'offer_accepted' : 'negotiation' };
  });

  app.get('/api/v1/admin/domain-brokerage/cases', async (req) => { await requireRole(req,env,db,STAFF); const q = req.query as any; const page=Math.max(1,Number(q.page)||1), limit=Math.min(100,Math.max(1,Number(q.limit)||25)), params:any[]=[]; const where:string[]=[]; if(q.status){params.push(q.status);where.push(`c.status=$${params.length}`);} if(q.search){params.push(`%${String(q.search).slice(0,100)}%`);where.push(`(c.brokerage_id ILIKE $${params.length} OR c.domain ILIKE $${params.length})`);} params.push(limit,(page-1)*limit); const r=await db.query<any>(`SELECT c.*,u.email customer_email,p.name provider_name FROM domain_broker_cases c JOIN users u ON u.id=c.user_id LEFT JOIN domain_broker_providers p ON p.id=c.provider_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY c.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,params); return { cases:r.rows,page,limit }; });
  app.post<{ Params: { id: string } }>('/api/v1/admin/domain-brokerage/cases/:id/assign', async (req) => { const auth=await requireRole(req,env,db,STAFF); const caseId=parse(id,req.params.id), input=parse(assignmentSchema,req.body); const exists=await db.query<any>('SELECT id FROM domain_broker_cases WHERE id=$1',[caseId]); if(!exists.rows[0]) throw new NotFoundError('No brokerage case was found'); await db.query('UPDATE domain_broker_cases SET assigned_broker_id=$1,status=\'broker_assigned\',updated_at=now() WHERE id=$2',[input.brokerId,caseId]); await db.query('INSERT INTO domain_broker_assignments (id,case_id,broker_id,assigned_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',[randomUUID(),caseId,input.brokerId,auth.userId]); await event(db,caseId,auth.userId,'broker_assigned',{brokerId:input.brokerId}); await audit(db,caseId,auth.userId,'broker_assigned',{brokerId:input.brokerId}); return { ok:true }; });
  app.get('/api/v1/admin/domain-brokerage/providers', async (req) => { await requireRole(req,env,db,['super_admin']); const r=await db.query<any>('SELECT id,provider_key,name,provider_type,status,environment,capabilities,last_health_check_at,last_error FROM domain_broker_providers ORDER BY name'); return { providers:r.rows }; });
  app.post('/api/v1/admin/domain-brokerage/providers', async (req) => { const auth=await requireRole(req,env,db,['super_admin']); const input=parse(providerSchema,req.body); const r=await db.query<any>("INSERT INTO domain_broker_providers (id,provider_key,name,provider_type,environment,capabilities) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,provider_key,name,provider_type,status,environment,capabilities",[randomUUID(),input.providerKey,input.name,input.providerType,input.environment,JSON.stringify(input.capabilities)]); await audit(db,null,auth.userId,'provider_configured',{providerKey:input.providerKey}); return { provider:r.rows[0] }; });
  app.get('/api/v1/admin/domain-brokerage/overview', async (req) => { await requireRole(req,env,db,STAFF); const r=await db.query<any>('SELECT status, count(*)::int AS count FROM domain_broker_cases GROUP BY status'); return { counts:Object.fromEntries(r.rows.map((x:any)=>[x.status,x.count])) }; });
}
