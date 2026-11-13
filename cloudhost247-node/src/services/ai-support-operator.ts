import type { TrustTrace } from '../ai-website/source-trust';
import { knowledgeFailureMessage, type KnowledgeFailure } from '../ai-website/knowledge-trust';
import type { Queryable } from '../db/types';
import { listKnowledgeEntries, type SupportKnowledgeEntry } from '../ai/knowledge';
import { composeAnswer, type AnswerLink, type AnswerEvidence } from '../ai-website/answer-composer';
import { resolveLiveFacts, type LiveFacts } from '../ai-website/live-facts';
import { retrieveKnowledge } from '../ai-website/retrieval';
import { understandQuery } from '../ai-website/query-understanding';
import { resolveRoute } from '../ai-website/website-discovery';

/**
 * CloudHost247 support decision layer.
 *
 * Two knowledge layers cooperate, in this order, and neither replaces the other:
 *
 *   1. **Guard rails and reviewed procedures** (`ai/knowledge.ts`). These are short, human-reviewed
 *      operating instructions — how to refresh a security PIN, what happens on a restore request —
 *      where the exact wording matters and a marketing page would be the wrong answer.
 *   2. **The whole public website** (`ai-website/`). Every page, tool, document, policy, product,
 *      FAQ and announcement, retrieved with synonyms, abbreviations, typo tolerance and reranking,
 *      answered with verified links and live catalogue prices.
 *
 * The guard rails run first and keep their veto: an explicit human request, a security incident, a
 * refund, a complaint, a server incident or any account-specific question is escalated before
 * retrieval is consulted. Only when the reviewed layer has nothing specific does the website
 * knowledge layer answer — which is what turns "twenty FAQs" into "the entire site".
 *
 * `decideSupportResponse` keeps its original signature and its original behaviour for every case the
 * reviewed layer already handled, so existing callers and tests remain valid; it simply has far more
 * it can now answer.
 */

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
  /** Safe operational category, distinct from unanswered content. */
  knowledgeFailure?: KnowledgeFailure;
  trustTrace?: TrustTrace;
  kind: 'ANSWER' | 'ESCALATE' | 'NEWSLETTER' | 'CLARIFY';
  body: string;
  intent: string;
  confidence: number;
  sources: string[];
  reason?: EscalationReason;
  /** Verified internal links the assistant is offering. Never contains an unverified URL. */
  links?: AnswerLink[];
  /** The knowledge the answer is based on, for the admin console and for feedback. */
  evidence?: AnswerEvidence[];
  /** Which engine phrased the final answer. Honest, never optimistic. */
  engine?: 'reviewed' | 'retrieval' | 'retrieval+model';
  /** The corpus the answer came from. */
  origin?: 'reviewed' | 'website';
  /** Suggested next questions, built from what was retrieved. */
  followUps?: string[];
}

export interface OperatorContext {
  /** Recent transcript turns. Used for pronoun/deictic follow-ups only. */
  previousMessages?: Array<{ author_type: string; body: string }>;
  /** Where the visitor is standing, so suggestions do not point at the current page. */
  currentPath?: string | null;
  /** Customer's locale, when the widget knows it. */
  locale?: string | null;
  /** False when answering on behalf of a human agent (skips model phrasing latency). */
  allowModel?: boolean;
  /** Pre-computed live facts (tests, or a caller that already read the catalogue). */
  facts?: LiveFacts | null;
}

const HUMAN_REQUEST = /(?:\b(?:human|real person|live person|live agent|support agent|support representative|representative)\b)|(?:\b(?:connect|transfer|route)\b.{0,36}\b(?:human|agent|person|support|representative)\b)|(?:\b(?:speak|talk|chat)\b.{0,24}\b(?:human|someone|person|agent|support|representative)\b)|(?:\b(?:let me|i need|can i)\b.{0,24}\b(?:speak|talk|chat)\b.{0,24}\b(?:agent|human|person|support)\b)/i;
const NEWSLETTER_REQUEST = /\b(?:newsletter|mailing list|subscribe me|subscribe to|service announcements|updates and offers)\b/i;
const NEWSLETTER_CONFIRMATION = /^(?:yes|yeah|yep|sure|okay|ok|i agree|please do|sign me up|do it)[!. ]*$/i;
const ACCOUNT_REQUEST = /\b(?:my|our)\s+(?:account|invoice|payment|order|refund|renewal|subscription|server|vps)\b|\b(?:payment status|server status|account status|why (?:was|is) my)\b|\b(?:my|our)\s+(?:password|credentials?|api key|secret|token)\b|\b(?:what(?:'s| is)|send|give|tell me|show me|reveal)\b.{0,24}\b(?:password|credentials?|api key|secret|token)\b/i;
const SECURITY_REQUEST = /\b(?:hacked|hack|breach|compromised|stolen password|security incident|account takeover|abuse report)\b/i;
const REFUND_REQUEST = /\b(?:refund|chargeback|money back|cancel\s+(?:my\s+)?payment)\b/i;
const COMPLAINT_REQUEST = /\b(?:complaint|complain|lawyer|legal action|sue|fraud)\b/i;
const BILLING_REQUEST = /\b(?:billing|invoice|renewal|renew|payment method|pay invoice|payment)\b/i;
const SERVER_INCIDENT = /\b(?:server|vps|instance)\b.{0,30}\b(?:down|offline|unreachable|broken|not working|failed)\b/i;
const ACCOUNT_ACTION = /\b(?:transfer|delete|cancel|renew)\s+my\s+|\b(?:can you|please|i need you to)\s+(?:update|change|add|remove|delete|configure)\s+my\b/i;
const PRICE_REQUEST = /\b(?:price|pricing|cost|how much|fee|fees|cheapest|cheap|affordable|budget|plan|plans)\b/i;
const LOST_ACCESS = /\b(?:cannot|can't|unable to|forgot|lost)\b.{0,40}\b(?:log ?in|sign ?in|access (?:my )?account|password|account)\b|\b(?:locked out|account locked)\b/i;

const noAnswer = (intent: string, reason: EscalationReason, body: string, confidence = 0.1): OperatorDecision => ({
  kind: 'ESCALATE',
  body,
  intent,
  confidence,
  sources: [],
  reason,
});

/** Catalogue product names, used only to cite what the reviewed answer refers to. */
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

function sourceFor(entry: SupportKnowledgeEntry, names: string[]): string[] {
  return [entry.source, ...names.slice(0, 3).map((name) => `Catalog: ${name}`)];
}

/**
 * The reviewed layer's own answer, including the links its wording references. The links are
 * resolved against the site registry, so a reviewed entry can only ever point at a real page.
 */
async function reviewedAnswer(entry: SupportKnowledgeEntry, names: string[]): Promise<OperatorDecision> {
  const links: AnswerLink[] = [];
  for (const candidate of entry.links ?? []) {
    const url = resolveRoute(candidate);
    if (url) links.push({ label: url, url, kind: 'route' });
  }
  return {
    kind: 'ANSWER',
    body: entry.answer,
    intent: entry.intent,
    confidence: Math.min(0.98, 0.78 + (entry.weight ?? 0) / 100),
    sources: sourceFor(entry, names),
    engine: 'reviewed',
    origin: 'reviewed',
    links,
  };
}

/**
 * The support decision layer. Intentionally conservative: explicit human requests,
 * customer-specific requests, security issues and complaints never fall through to a generic answer.
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
  if (ACCOUNT_REQUEST.test(text) && !LOST_ACCESS.test(text)) {
    const reason: EscalationReason = BILLING_REQUEST.test(text) ? 'BILLING_SUPPORT_REQUIRED' : 'ACCOUNT_SPECIFIC_REQUEST';
    return noAnswer(
      'account_specific',
      reason,
      'I cannot safely determine account-specific information from a general chat response. I can transfer this conversation to CloudHost247 Support.',
      0.98
    );
  }

  // "I can't log in" is a support procedure, not an unanswerable question. Answer the published
  // recovery route, then offer a human — the two are not the same thing.
  if (LOST_ACCESS.test(text)) {
    const loginUrl = resolveRoute('/forgot-password');
    const helpUrl = resolveRoute('/help');
    return {
      kind: 'ANSWER',
      body: [
        'You can recover access yourself from the sign-in page: choose “Forgot password”, enter the email address on your CloudHost247 account, and follow the reset link that arrives by email. If you have two-factor or a passkey enrolled, the reset page will ask for that second factor as well.',
        'If the reset email does not arrive, check the spam folder first, then ask me for a human and I will pass this conversation to CloudHost247 Support — they can verify the account and help you back in.',
      ].join('\n\n'),
      intent: 'account_recovery',
      confidence: 0.8,
      sources: ['CloudHost247 account recovery procedure'],
      engine: 'reviewed',
      origin: 'reviewed',
      links: [
        ...(loginUrl ? [{ label: 'Reset your password', url: loginUrl, kind: 'route' }] : []),
        ...(helpUrl ? [{ label: 'Help centre', url: helpUrl, kind: 'route' }] : []),
      ],
      followUps: ['How do I enable two-factor authentication?', 'I still cannot sign in'],
    };
  }

  const previousCustomer = context.previousMessages?.find((item) => item.author_type === 'CUSTOMER')?.body ?? '';
  const previousAi = context.previousMessages?.find((item) => item.author_type === 'AI')?.body ?? '';

  // 1. Reviewed operating procedures.
  //
  // The reviewed layer is the *procedure* layer: "which page do I use to change a DNS record",
  // "what happens to a restore request". It is deliberately narrow, and its answers are written for
  // an account-context scenario. So it wins in three situations only:
  //
  //   • the entry carries operational intent (`intent` ends in `_management`, `_troubleshooting`,
  //     `support`, `account`, `phone`, …) — i.e. it describes a workflow, not a product;
  //   • the customer's question is itself a procedural/how-to question about that workflow.
  //
  // Everywhere else the website layer answers, because a question like "what is the cheapest
  // hosting" or "can I host WordPress" is answered better by the published page than by a reviewed
  // paragraph that was written to avoid inventing anything. When the reviewed layer does win, the
  // website layer is still asked for the *verified links* so the procedural answer can offer the
  // same clickable destinations instead of describing a page the customer must find.
  const understanding = understandQuery(text);
  const proceduralQuestion = /\b(?:how (?:do|can|does)|where (?:can|do|is)|what (?:is|are) the (?:process|steps)|steps?|guide|set ?up|configure|change|update|add|remove|transfer|restore|recover|reset|renew|cancel)\b/i.test(text);
  const reviewedEntry = await (async () => {
    const { retrieveKnowledge: retrieveReviewed } = await import('../ai/knowledge');
    const retrievalText = text.length < 32 && previousCustomer ? `${previousCustomer} ${text}` : text;
    const entry = retrieveReviewed(retrievalText);
    if (!entry) return null;
    // A price is always a catalogue question, never a reviewed paragraph.
    if (/\b(?:how much|price|pricing|cost|cheapest|cheap|fee|fees)\b/i.test(text)) return null;
    // Reviewed entries are procedures ("how do I refresh my security PIN", "what happens on a
    // restore request"). They answer procedural questions, and operational workflows even when the
    // phrasing is not procedural. They do not answer questions about what an offering *is* — those
    // are answered by the published page, in the product's own words.
    if (proceduralQuestion) return entry;
    const operational = /(?:_management|_troubleshooting|_support|^support|^account|_services|phone_services|rdp|proxy|smm|mrz_developer_tool)$/.test(entry.intent);
    if (operational && understanding.entities.length === 0) return entry;
    return null;
  })();
  const facts = context.facts !== undefined
    ? context.facts
    : PRICE_REQUEST.test(text) || understanding.intent === 'pricing'
      ? await resolveLiveFacts(db)
      : await resolveLiveFacts(db, { productSlugs: [] });

  const retrieval = await retrieveKnowledge(db, text, {
    previousCustomerMessage: previousCustomer || null,
    limit: 24,
    pageLimit: 4,
  });

  if (retrieval.verificationFailure) {
    return {
      ...noAnswer('knowledge_unavailable', 'TECHNICAL_SUPPORT_REQUIRED', knowledgeFailureMessage(retrieval.verificationFailure), 0),
      knowledgeFailure: retrieval.verificationFailure, trustTrace: retrieval.trustTrace, engine: 'retrieval', origin: 'website',
    };
  }

  if (reviewedEntry) {
    const names = await catalogNames(db);
    const reviewed = await reviewedAnswer(reviewedEntry, names);
    // Merge the verified destinations the website layer found, so the procedural answer is
    // actionable. Only routes the retrieval actually surfaced are added — never a guess.
    const existing = new Set((reviewed.links ?? []).map((link) => link.url));
    for (const page of retrieval.pages.slice(0, 3)) {
      const url = resolveRoute(page.url);
      if (url && !existing.has(url) && (reviewed.links?.length ?? 0) < 3) {
        reviewed.links = [...(reviewed.links ?? []), { label: page.title.split(' — ')[0] ?? page.title, url, kind: page.kind }];
        existing.add(url);
      }
    }
    return { ...reviewed, trustTrace: retrieval.trustTrace };
  }

  const composed = await composeAnswer(text, retrieval.understanding, {
    retrieval,
    facts,
    resolveRoute,
    currentPath: context.currentPath ?? null,
    allowModel: context.allowModel !== false,
    previousTopic: previousAi || null,
  });

  if (composed.kind === 'ESCALATE') {
    return {
      kind: 'ESCALATE',
      body: composed.body,
      intent: composed.intent,
      confidence: composed.confidence,
      sources: [],
      reason: composed.escalateReason ?? 'AI_UNABLE_TO_ANSWER',
      engine: composed.engine,
      origin: 'website', trustTrace: retrieval.trustTrace,
    };
  }
  if (composed.kind === 'CLARIFY') {
    return {
      kind: 'CLARIFY',
      body: composed.body,
      intent: composed.intent,
      confidence: composed.confidence,
      sources: [],
      engine: composed.engine,
      origin: 'website', trustTrace: retrieval.trustTrace,
    };
  }

  const { suggestFollowUps } = await import('../ai-website/answer-composer');
  return {
    kind: 'ANSWER',
    body: composed.body,
    intent: composed.intent,
    confidence: composed.confidence,
    sources: composed.evidence.map((item) => item.title || item.url),
    links: composed.links,
    evidence: composed.evidence,
    engine: composed.engine,
    origin: 'website', trustTrace: retrieval.trustTrace,
    followUps: suggestFollowUps(retrieval.understanding, retrieval, { resolveRoute, currentPath: context.currentPath ?? null }),
  };
}

/** Used by the admin knowledge view; the UI cannot silently mutate this reviewed source. */
export function listSupportKnowledge(): SupportKnowledgeEntry[] {
  return listKnowledgeEntries();
}
