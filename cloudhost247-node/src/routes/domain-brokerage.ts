import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { authenticate } from '../lib/require-auth';
import { requireRole } from '../lib/require-role';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { createNotification } from '../services/notification-service';

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

/**
 * Customer-facing broker notifications. Types are per-event (and the dedupe index is per
 * (user,type,resource)), so each meaningful update is delivered exactly once: an offer is one
 * resource, a status value is one type. Never throws — a notification failure must not roll
 * back the brokerage operation it describes.
 */
async function notifyCustomer(db: Queryable, userId: string, type: string, title: string, message: string, resourceType: string, resourceId: string) {
  await createNotification(db, { userId, type, title, message, resourceType, resourceId }).catch(() => undefined);
}

/** Spec §11 lifecycle (snake_case internally). Existing values are kept for compatibility. */
const BROKER_CASE_STATUSES = ['request_submitted','broker_assigned','under_review','contacting_seller','negotiation','offer_received','offer_accepted','payment_pending','transfer_pending','completed','rejected','cancelled'] as const;
const brokerStatusSchema = z.enum(BROKER_CASE_STATUSES);
const BROKER_STATUS_LABELS: Record<string, string> = {
  request_submitted: 'Submitted', broker_assigned: 'Broker assigned', under_review: 'Under review',
  contacting_seller: 'Contacting seller', negotiation: 'Negotiating', offer_received: 'Offer received',
  offer_accepted: 'Offer accepted', payment_pending: 'Payment pending', transfer_pending: 'Transfer pending',
  completed: 'Completed', rejected: 'Rejected', cancelled: 'Cancelled',
};

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
      await event(db, caseId, auth.userId, 'request_created'); await audit(db, caseId, auth.userId, 'case_created', { route: 'manual_broker_required' });
      await notifyCustomer(db, auth.userId, 'DOMAIN_BROKER_CASE_CREATED', 'Your domain broker request was received', `We received your acquisition request for ${input.domain} (${brokerageId}). A broker will review it and contact you through the case messages.`, 'domain_broker_case', caseId);
      reply.code(201); return { case: r.rows[0] };
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
  app.post<{ Params: { id: string } }>('/api/v1/admin/domain-brokerage/cases/:id/assign', async (req) => { const auth=await requireRole(req,env,db,STAFF); const caseId=parse(id,req.params.id), input=parse(assignmentSchema,req.body); const exists=await db.query<any>('SELECT id,user_id,domain,brokerage_id FROM domain_broker_cases WHERE id=$1',[caseId]); if(!exists.rows[0]) throw new NotFoundError('No brokerage case was found'); await db.query('UPDATE domain_broker_cases SET assigned_broker_id=$1,status=\'broker_assigned\',updated_at=now() WHERE id=$2',[input.brokerId,caseId]); await db.query('INSERT INTO domain_broker_assignments (id,case_id,broker_id,assigned_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',[randomUUID(),caseId,input.brokerId,auth.userId]); await event(db,caseId,auth.userId,'broker_assigned',{brokerId:input.brokerId}); await audit(db,caseId,auth.userId,'broker_assigned',{brokerId:input.brokerId});
    await notifyCustomer(db, exists.rows[0].user_id, 'DOMAIN_BROKER_CASE_BROKER_ASSIGNED', 'A broker was assigned to your request', `A broker has been assigned to your acquisition request for ${exists.rows[0].domain} (${exists.rows[0].brokerage_id}) and will begin the acquisition process.`, 'domain_broker_case', caseId);
    return { ok:true }; });
  app.get('/api/v1/admin/domain-brokerage/providers', async (req) => { await requireRole(req,env,db,['super_admin']); const r=await db.query<any>('SELECT id,provider_key,name,provider_type,status,environment,capabilities,last_health_check_at,last_error FROM domain_broker_providers ORDER BY name'); return { providers:r.rows }; });
  app.post('/api/v1/admin/domain-brokerage/providers', async (req) => { const auth=await requireRole(req,env,db,['super_admin']); const input=parse(providerSchema,req.body); const r=await db.query<any>("INSERT INTO domain_broker_providers (id,provider_key,name,provider_type,environment,capabilities) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,provider_key,name,provider_type,status,environment,capabilities",[randomUUID(),input.providerKey,input.name,input.providerType,input.environment,JSON.stringify(input.capabilities)]); await audit(db,null,auth.userId,'provider_configured',{providerKey:input.providerKey}); return { provider:r.rows[0] }; });
  app.get('/api/v1/admin/domain-brokerage/overview', async (req) => { await requireRole(req,env,db,STAFF); const r=await db.query<any>('SELECT status, count(*)::int AS count FROM domain_broker_cases GROUP BY status'); return { counts:Object.fromEntries(r.rows.map((x:any)=>[x.status,x.count])) }; });

  // -----------------------------------------------------------------------------------
  // Admin case management: full detail, status workflow, offers, notes, fees, transfer.
  // Every mutation writes broker events + audit rows and notifies the customer exactly once
  // per meaningful change (dedupe-safe notification types per status/offer/message).
  // -----------------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/v1/admin/domain-brokerage/cases/:id', async (req) => {
    await requireRole(req,env,db,STAFF); const caseId=parse(id,req.params.id);
    const c=await db.query<any>('SELECT c.*,u.email customer_email,p.name provider_name,b.email broker_email FROM domain_broker_cases c JOIN users u ON u.id=c.user_id LEFT JOIN domain_broker_providers p ON p.id=c.provider_id LEFT JOIN users b ON b.id=c.assigned_broker_id WHERE c.id=$1',[caseId]);
    if(!c.rows[0]) throw new NotFoundError('No brokerage case was found');
    const [offers,messages,events,docs,payment,transfer,assignments]=await Promise.all([
      db.query<any>('SELECT * FROM domain_broker_offers WHERE case_id=$1 ORDER BY created_at DESC',[caseId]),
      db.query<any>('SELECT m.id,m.author_id,m.visibility,m.body,m.created_at,u.email author_email FROM domain_broker_messages m LEFT JOIN users u ON u.id=m.author_id WHERE m.case_id=$1 ORDER BY m.created_at ASC',[caseId]),
      db.query<any>('SELECT event_type,result,metadata,created_at FROM domain_broker_events WHERE case_id=$1 ORDER BY created_at ASC',[caseId]),
      db.query<any>('SELECT id,name,visibility,created_at FROM domain_broker_documents WHERE case_id=$1 ORDER BY created_at ASC',[caseId]),
      db.query<any>('SELECT * FROM domain_broker_payments WHERE case_id=$1',[caseId]),
      db.query<any>('SELECT * FROM domain_broker_transfers WHERE case_id=$1',[caseId]),
      db.query<any>('SELECT a.broker_id,a.created_at,u.email broker_email FROM domain_broker_assignments a JOIN users u ON u.id=a.broker_id WHERE a.case_id=$1 ORDER BY a.created_at DESC',[caseId]),
    ]);
    return { case:c.rows[0], offers:offers.rows, messages:messages.rows, timeline:events.rows, documents:docs.rows, payment:payment.rows[0]??null, transfer:transfer.rows[0]??null, assignments:assignments.rows, statusLabels:BROKER_STATUS_LABELS };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/admin/domain-brokerage/cases/:id/status', async (req) => {
    const auth=await requireRole(req,env,db,STAFF); const caseId=parse(id,req.params.id);
    const input=parse(z.object({ status:brokerStatusSchema, note:z.string().max(1000).optional() }),req.body);
    const c=await db.query<any>('SELECT id,user_id,domain,brokerage_id,status FROM domain_broker_cases WHERE id=$1',[caseId]);
    if(!c.rows[0]) throw new NotFoundError('No brokerage case was found');
    if(c.rows[0].status===input.status) return { ok:true, status:input.status }; // no-op: no duplicate events/notifications
    const { rows:updated }=await db.query<any>('UPDATE domain_broker_cases SET status=$1,updated_at=now() WHERE id=$2 AND status=$3 RETURNING id',[input.status,caseId,c.rows[0].status]);
    if(!updated[0]) throw new ConflictError('The case status changed while you were updating it. Reload and try again.');
    if(input.note) await db.query('INSERT INTO domain_broker_messages (id,case_id,author_id,visibility,body) VALUES ($1,$2,$3,\'internal\',$4)',[randomUUID(),caseId,auth.userId,`Status ${c.rows[0].status} → ${input.status}: ${input.note}`]);
    await event(db,caseId,auth.userId,'status_changed',{from:c.rows[0].status,to:input.status});
    await audit(db,caseId,auth.userId,'case_status_updated',{from:c.rows[0].status,to:input.status});
    const label=BROKER_STATUS_LABELS[input.status]??input.status;
    await notifyCustomer(db,c.rows[0].user_id,`DOMAIN_BROKER_CASE_${input.status.toUpperCase()}`,'Broker request update',`Your acquisition request for ${c.rows[0].domain} (${c.rows[0].brokerage_id}) is now: ${label}.`,'domain_broker_case',caseId);
    return { ok:true, status:input.status };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/domain-brokerage/cases/:id/offers', async (req,reply) => {
    const auth=await requireRole(req,env,db,STAFF); const caseId=parse(id,req.params.id);
    const input=parse(z.object({ amount:money, currency:z.string().length(3).regex(/^[a-z]{3}$/i), senderType:z.enum(['broker','seller','provider']), recipientType:z.enum(['customer','broker','seller','provider']).default('customer'), expiresAt:z.string().datetime().optional(), providerReference:z.string().max(255).optional() }),req.body);
    const c=await db.query<any>('SELECT id,user_id,domain,brokerage_id,status FROM domain_broker_cases WHERE id=$1',[caseId]);
    if(!c.rows[0]) throw new NotFoundError('No brokerage case was found');
    if(['completed','rejected','cancelled'].includes(c.rows[0].status)) throw new ConflictError('Offers cannot be added to a closed case');
    const currency=input.currency.toUpperCase(); const offerId=randomUUID();
    // Only one offer may be actionable at a time: supersede any still-open offers before
    // presenting the new one, so a customer can never accept a stale offer by accident.
    await db.query("UPDATE domain_broker_offers SET status='superseded' WHERE case_id=$1 AND status='open'",[caseId]);
    const r=await db.query<any>('INSERT INTO domain_broker_offers (id,case_id,amount,currency,sender_type,recipient_type,expires_at,provider_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[offerId,caseId,input.amount,currency,input.senderType,input.recipientType,input.expiresAt??null,input.providerReference??null]);
    if(input.recipientType==='customer') await db.query("UPDATE domain_broker_cases SET current_offer=$1,status='offer_received',updated_at=now() WHERE id=$2",[input.amount,caseId]);
    await event(db,caseId,auth.userId,'offer_recorded',{offerId,amount:input.amount,currency,senderType:input.senderType});
    await audit(db,caseId,auth.userId,'offer_recorded',{offerId,senderType:input.senderType});
    if(input.recipientType==='customer') await notifyCustomer(db,c.rows[0].user_id,'DOMAIN_BROKER_OFFER_RECEIVED','Broker offer received',`An offer of ${input.amount} ${currency} was recorded for ${c.rows[0].domain} (${c.rows[0].brokerage_id}). Open the case to accept or reject it.`,'domain_broker_offer',offerId);
    reply.code(201); return { offer:r.rows[0] };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/domain-brokerage/cases/:id/messages', async (req,reply) => {
    const auth=await requireRole(req,env,db,STAFF); const caseId=parse(id,req.params.id);
    const input=parse(z.object({ body:z.string().min(1).max(10000), visibility:z.enum(['customer','internal']).default('internal') }),req.body);
    const c=await db.query<any>('SELECT id,user_id,domain,brokerage_id FROM domain_broker_cases WHERE id=$1',[caseId]);
    if(!c.rows[0]) throw new NotFoundError('No brokerage case was found');
    const messageId=randomUUID();
    const r=await db.query<any>('INSERT INTO domain_broker_messages (id,case_id,author_id,visibility,body) VALUES ($1,$2,$3,$4,$5) RETURNING id,visibility,body,created_at',[messageId,caseId,auth.userId,input.visibility,input.body]);
    await event(db,caseId,auth.userId,input.visibility==='internal'?'internal_note':'broker_message',{messageId});
    if(input.visibility==='customer') await notifyCustomer(db,c.rows[0].user_id,'DOMAIN_BROKER_MESSAGE','New message on your broker case',`Your broker posted an update on ${c.rows[0].domain} (${c.rows[0].brokerage_id}). Open the case to read it.`,'domain_broker_message',messageId);
    reply.code(201); return { message:r.rows[0] };
  });

  const paymentBody=z.object({ acquisitionAmount:money, brokerageFee:z.number().min(0).finite().default(0), transferFee:z.number().min(0).finite().default(0), paymentFee:z.number().min(0).finite().default(0), currency:z.string().length(3).regex(/^[a-z]{3}$/i), status:z.enum(['pending','initiated','authorized','paid','failed','refunded','cancelled']) });
  app.put<{ Params: { id: string } }>('/api/v1/admin/domain-brokerage/cases/:id/payment', async (req) => {
    const auth=await requireRole(req,env,db,STAFF); const caseId=parse(id,req.params.id);
    const input=parse(paymentBody,req.body);
    const c=await db.query<any>('SELECT id,user_id,domain,brokerage_id,payment_status FROM domain_broker_cases WHERE id=$1',[caseId]);
    if(!c.rows[0]) throw new NotFoundError('No brokerage case was found');
    // Total is computed server-side from the fee components; clients never supply it.
    const brokerageFee=input.brokerageFee??0, transferFee=input.transferFee??0, paymentFee=input.paymentFee??0;
    const total=Math.round((input.acquisitionAmount+brokerageFee+transferFee+paymentFee)*100)/100;
    const currency=input.currency.toUpperCase();
    const r=await db.query<any>(
      `INSERT INTO domain_broker_payments (id,case_id,acquisition_amount,brokerage_fee,transfer_fee,payment_fee,total_amount,currency,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (case_id) DO UPDATE SET acquisition_amount=$3,brokerage_fee=$4,transfer_fee=$5,payment_fee=$6,total_amount=$7,currency=$8,status=$9,updated_at=now()
       RETURNING *`,
      [randomUUID(),caseId,input.acquisitionAmount,brokerageFee,transferFee,paymentFee,total,currency,input.status]);
    if(c.rows[0].payment_status!==input.status) await db.query('UPDATE domain_broker_cases SET payment_status=$1,updated_at=now() WHERE id=$2',[input.status,caseId]);
    await event(db,caseId,auth.userId,'payment_updated',{status:input.status,total,currency});
    await audit(db,caseId,auth.userId,'payment_updated',{status:input.status,total});
    if(c.rows[0].payment_status!==input.status){
      const labels:Record<string,string>={ paid:'Payment received — the acquisition is being finalized', failed:'A payment on your broker case failed — please contact support', refunded:'A payment on your broker case was refunded', cancelled:'A payment on your broker case was cancelled', authorized:'A payment on your broker case was authorized', initiated:'A payment on your broker case was initiated', pending:'A payment on your broker case is pending' };
      await notifyCustomer(db,c.rows[0].user_id,`DOMAIN_BROKER_PAYMENT_${input.status.toUpperCase()}`,'Broker payment update',`${labels[input.status]??'Your broker case payment status changed'} (${c.rows[0].brokerage_id}: ${total.toFixed(2)} ${currency}).`,'domain_broker_case',caseId);
    }
    return { payment:r.rows[0] };
  });

  app.put<{ Params: { id: string } }>('/api/v1/admin/domain-brokerage/cases/:id/transfer', async (req) => {
    const auth=await requireRole(req,env,db,STAFF); const caseId=parse(id,req.params.id);
    const input=parse(z.object({ status:z.enum(['not_started','authorization_required','initiated','processing','verified','failed']), registrar:z.string().max(255).optional(), providerReference:z.string().max(255).optional(), failureReason:z.string().max(1000).optional() }),req.body);
    const c=await db.query<any>('SELECT id,user_id,domain,brokerage_id,transfer_status FROM domain_broker_cases WHERE id=$1',[caseId]);
    if(!c.rows[0]) throw new NotFoundError('No brokerage case was found');
    const initiatedNow=input.status==='initiated'||input.status==='processing';
    const completedNow=input.status==='verified';
    const r=await db.query<any>(
      `INSERT INTO domain_broker_transfers (id,case_id,status,registrar,provider_reference,failure_reason,initiated_at,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $7 THEN now() ELSE NULL END, CASE WHEN $8 THEN now() ELSE NULL END)
       ON CONFLICT (case_id) DO UPDATE SET status=$3,registrar=COALESCE($4,domain_broker_transfers.registrar),provider_reference=COALESCE($5,domain_broker_transfers.provider_reference),failure_reason=$6,initiated_at=CASE WHEN $7 AND domain_broker_transfers.initiated_at IS NULL THEN now() ELSE domain_broker_transfers.initiated_at END,completed_at=CASE WHEN $8 AND domain_broker_transfers.completed_at IS NULL THEN now() ELSE domain_broker_transfers.completed_at END,updated_at=now()
       RETURNING *`,
      [randomUUID(),caseId,input.status,input.registrar??null,input.providerReference??null,input.failureReason??null,initiatedNow,completedNow]);
    if(c.rows[0].transfer_status!==input.status) await db.query('UPDATE domain_broker_cases SET transfer_status=$1,updated_at=now() WHERE id=$2',[input.status,caseId]);
    await event(db,caseId,auth.userId,'transfer_updated',{status:input.status});
    await audit(db,caseId,auth.userId,'transfer_updated',{status:input.status});
    if(c.rows[0].transfer_status!==input.status){
      const labels:Record<string,string>={ authorization_required:'transfer authorization is required', initiated:'the domain transfer has been initiated', processing:'the domain transfer is processing at the registry', verified:'the domain transfer is verified and complete', failed:'the domain transfer failed — our team will follow up', not_started:'the domain transfer has not started' };
      await notifyCustomer(db,c.rows[0].user_id,`DOMAIN_BROKER_TRANSFER_${input.status.toUpperCase()}`,'Broker transfer update',`For ${c.rows[0].domain} (${c.rows[0].brokerage_id}), ${labels[input.status]??'the transfer status changed'}.`,'domain_broker_case',caseId);
    }
    return { transfer:r.rows[0] };
  });
}
