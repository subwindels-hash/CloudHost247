import type { Queryable } from '../db/types';
import { listKnowledgeEntries, retrieveKnowledge, type SupportKnowledgeEntry } from '../ai/knowledge';

export type EscalationReason =
  | 'USER_REQUESTED_HUMAN'
  | 'AI_UNABLE_TO_ANSWER'
  | 'ACCOUNT_SPECIFIC_REQUEST'
  | 'BILLING_SUPPORT_REQUIRED'
  | 'TECHNICAL_SUPPORT_REQUIRED'
  | 'SERVER_SUPPORT_REQUIRED'
  | 'COMPLAINT'
  | 'REFUND_REQUEST'
  | 'SECURITY_RELATED'
  | 'OTHER';

export interface OperatorDecision {
  kind: 'ANSWER' | 'ESCALATE' | 'NEWSLETTER';
  body: string;
  intent: string;
  confidence: number;
  sources: string[];
  reason?: EscalationReason;
}

export interface OperatorContext {
  /** Kept intentionally small: the operator stores the full transcript, but only needs recent
   * author labels for a deterministic follow-up hint. */
  previousMessages?: Array<{ author_type: string; body: string }>;
}

const HUMAN_REQUEST = /(?:\b(?:human|real person|live person|live agent|support agent|support representative|representative)\b)|(?:\b(?:connect|transfer|route)\b.{0,36}\b(?:human|agent|person|support|representative)\b)|(?:\b(?:speak|talk|chat)\b.{0,24}\b(?:human|someone|person|agent|support|representative)\b)|(?:\b(?:let me|i need|can i)\b.{0,24}\b(?:speak|talk|chat)\b.{0,24}\b(?:agent|human|person|support)\b)/i;
const NEWSLETTER_REQUEST = /\b(?:newsletter|mailing list|subscribe me|subscribe to|service announcements|updates and offers)\b/i;
const NEWSLETTER_CONFIRMATION = /^(?:yes|yeah|yep|sure|okay|ok|i agree|please do|sign me up|do it)[!. ]*$/i;
const ACCOUNT_REQUEST = /\b(?:my|our)\s+(?:account|invoice|payment|order|refund|renewal|subscription|server|vps)\b|\b(?:payment status|server status|account status|why (?:was|is) my)\b|\b(?:password|credential|api key|secret|token)\b/i;
const SECURITY_REQUEST = /\b(?:hacked|hack|breach|compromised|stolen password|security incident|account takeover|abuse report)\b/i;
const REFUND_REQUEST = /\b(?:refund|chargeback|money back|cancel\s+(?:my\s+)?payment)\b/i;
const COMPLAINT_REQUEST = /\b(?:complaint|complain|lawyer|legal action|sue|fraud)\b/i;
const BILLING_REQUEST = /\b(?:billing|invoice|renewal|renew|payment method|pay invoice|payment)\b/i;
const SERVER_INCIDENT = /\b(?:server|vps|instance)\b.{0,30}\b(?:down|offline|unreachable|broken|not working|failed)\b/i;
const ACCOUNT_ACTION = /\b(?:transfer|delete|cancel|renew)\s+my\s+|\b(?:can you|please|i need you to)\s+(?:update|change|add|remove|delete|configure)\s+my\b/i;
const PRICE_REQUEST = /\b(?:price|pricing|cost|how much|fee|fees)\b/i;

const noAnswer = (intent: string, reason: EscalationReason, body: string, confidence = 0.1): OperatorDecision => ({
  kind: 'ESCALATE',
  body,
  intent,
  confidence,
  sources: [],
  reason,
});

async function catalogNames(db: Queryable): Promise<string[]> {
  try {
    const result = await db.query<{ name: string }>(
      `SELECT name FROM products WHERE status='active' AND visibility='public' ORDER BY display_order ASC, name ASC LIMIT 100`
    );
    return result.rows.map((row) => row.name).filter(Boolean);
  } catch {
    // The knowledge answer is still valid when the optional catalog read model is unavailable. We
    // simply omit catalog citations instead of inventing a product or hiding a known workflow.
    return [];
  }
}

async function publishedPrices(db: Queryable, requestText: string): Promise<string[]> {
  try {
    const productTerms = ['domain', 'hosting', 'wordpress', 'cpanel', 'vps', 'cloud', 'dedicated', 'rdp', 'email', 'smtp', 'ssl', 'proxy', 'smm', 'sms', 'otp'];
    const requestedTerms = productTerms.filter((term) => requestText.toLocaleLowerCase().includes(term));
    const productFilter = requestedTerms.length > 0
      ? `AND (${requestedTerms.map((_, index) => `lower(p.name) LIKE $${index + 1}`).join(' OR ')})`
      : '';
    const result = await db.query<{
      product_name: string;
      plan_name: string;
      amount: string;
      currency: string;
      billing_period: string;
      setup_fee: string | null;
    }>(
      `SELECT p.name AS product_name, pl.name AS plan_name, pp.amount::text, pp.currency,
              pp.billing_period, pp.setup_fee::text
         FROM products p
         JOIN product_plans pl ON pl.product_id = p.id AND pl.status = 'active'
         JOIN plan_pricing pp ON pp.plan_id = pl.id AND pp.effective_status = 'published'
        WHERE p.status = 'active' AND p.visibility = 'public'
          ${productFilter}
        ORDER BY p.display_order ASC, pl.display_order ASC, pl.name ASC
        LIMIT 20`,
      requestedTerms.map((term) => `%${term}%`)
    );
    return result.rows.map((row) => {
      const setup = row.setup_fee && Number(row.setup_fee) > 0 ? ` plus ${row.currency} ${row.setup_fee} setup` : '';
      return `${row.product_name} — ${row.plan_name}: ${row.currency} ${row.amount} ${row.billing_period}${setup}`;
    });
  } catch {
    return [];
  }
}

function priceDecision(prices: string[]): OperatorDecision {
  if (prices.length === 0) {
    return noAnswer(
      'pricing',
      'AI_UNABLE_TO_ANSWER',
      'I could not find published pricing in the CloudHost247 catalog for that request. I will not guess a price. CloudHost247 Support can confirm the correct product and price.',
      0.05
    );
  }
  return {
    kind: 'ANSWER',
    body: `The current published CloudHost247 catalog shows:\n\n${prices.slice(0, 8).map((price) => `• ${price}`).join('\n')}\n\nPrices and availability can change; the live product page is the source of truth.`,
    intent: 'pricing',
    confidence: 0.96,
    sources: ['CloudHost247 published product catalog'],
  };
}

function sourceFor(entry: SupportKnowledgeEntry, names: string[]): string[] {
  return [entry.source, ...names.slice(0, 3).map((name) => `Catalog: ${name}`)];
}

/**
 * The support decision layer. It is intentionally conservative: explicit human requests,
 * customer-specific requests, and unsupported questions never fall through to a generic answer.
 */
export async function decideSupportResponse(
  db: Queryable,
  message: string,
  context: OperatorContext = {}
): Promise<OperatorDecision> {
  const text = message.trim();
  if (!text) return noAnswer('empty', 'AI_UNABLE_TO_ANSWER', 'Please send a question or ask for CloudHost247 Support.', 0);

  if (HUMAN_REQUEST.test(text)) {
    return noAnswer('human_request', 'USER_REQUESTED_HUMAN', 'I’ll check whether a CloudHost247 support representative is available.', 1);
  }
  if (SECURITY_REQUEST.test(text)) {
    return noAnswer('security', 'SECURITY_RELATED', 'Security-related requests need a human support representative. I will preserve this conversation and escalate it.', 1);
  }
  if (REFUND_REQUEST.test(text)) {
    return noAnswer('refund', 'REFUND_REQUEST', 'Refund decisions require CloudHost247 Support. I will preserve this conversation and connect it to the support queue.', 1);
  }
  if (COMPLAINT_REQUEST.test(text)) {
    return noAnswer('complaint', 'COMPLAINT', 'I’m sorry this needs attention. I will preserve this conversation and connect it to CloudHost247 Support.', 1);
  }
  const newsletterWasOffered = context.previousMessages?.some(
    (item) => item.author_type === 'AI' && /newsletter|subscribe to CloudHost247/i.test(item.body)
  );
  if (NEWSLETTER_REQUEST.test(text) || (newsletterWasOffered && NEWSLETTER_CONFIRMATION.test(text))) {
    return {
      kind: 'NEWSLETTER',
      body: 'Would you like to subscribe to CloudHost247 updates, offers and service announcements? Newsletter subscription is separate from a support request. Please provide your full name and email in the subscription form.',
      intent: 'newsletter',
      confidence: 1,
      sources: ['CloudHost247 newsletter subscription workflow'],
    };
  }
  if (SERVER_INCIDENT.test(text)) {
    return noAnswer(
      'server_incident',
      /\bmy\b/i.test(text) ? 'ACCOUNT_SPECIFIC_REQUEST' : 'SERVER_SUPPORT_REQUIRED',
      'I cannot verify a customer server’s live status from general chat. I will preserve this conversation and connect you to CloudHost247 Support.',
      0.99
    );
  }
  if (ACCOUNT_ACTION.test(text)) {
    return noAnswer(
      'account_action',
      'ACCOUNT_SPECIFIC_REQUEST',
      'I can explain the general CloudHost247 workflow, but I cannot make or confirm an account-specific change from chat. I will transfer this conversation to CloudHost247 Support.',
      0.99
    );
  }
  if (ACCOUNT_REQUEST.test(text)) {
    const reason: EscalationReason = BILLING_REQUEST.test(text) ? 'BILLING_SUPPORT_REQUIRED' : 'ACCOUNT_SPECIFIC_REQUEST';
    return noAnswer(
      'account_specific',
      reason,
      'I cannot safely determine account-specific information from a general chat response. I can transfer this conversation to CloudHost247 Support.',
      0.98
    );
  }
  if (PRICE_REQUEST.test(text)) return priceDecision(await publishedPrices(db, text));

  // A short follow-up such as “and WordPress?” can use the immediately preceding customer
  // message for retrieval. The complete transcript is still stored; this only preserves a small,
  // deterministic amount of context and never calls an external model.
  const previousCustomer = context.previousMessages?.find((item) => item.author_type === 'CUSTOMER')?.body ?? '';
  const retrievalText = text.length < 32 && previousCustomer ? `${previousCustomer} ${text}` : text;
  const entry = retrieveKnowledge(retrievalText);
  if (entry) {
    const names = await catalogNames(db);
    return {
      kind: 'ANSWER',
      body: entry.answer,
      intent: entry.intent,
      confidence: Math.min(0.98, 0.78 + (entry.weight ?? 0) / 100),
      sources: sourceFor(entry, names),
    };
  }

  return noAnswer(
    'unknown',
    'AI_UNABLE_TO_ANSWER',
    "I don’t have enough verified CloudHost247 information to answer that accurately. I can transfer this conversation to CloudHost247 Support.",
    0.15
  );
}

/** Used by the admin knowledge view; the UI cannot silently mutate this reviewed source. */
export function listSupportKnowledge(): SupportKnowledgeEntry[] {
  return listKnowledgeEntries();
}
