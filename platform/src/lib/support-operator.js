/**
 * The support operator — a deterministic decision layer for the CloudHost247 support widget.
 *
 * Ported from `cloudhost247-node/src/ai/knowledge.ts` plus
 * `cloudhost247-node/src/services/ai-support-operator.ts`. The audited build has **no language model
 * behind this either**: it retrieves from a small, reviewable catalogue of CloudHost247-specific
 * answers, and everything it cannot answer is escalated to a human rather than improvised. This is
 * the completion of `platform/src/domains/ai-support.js`, which was deferred as "LLM inference
 * (human agents reply manually)" and replied with a canned string in the meantime.
 *
 * The important property is the shape of the refusal, not the shape of the answer. The ladder in
 * `decideSupportResponse` checks the reasons a conversation *must* reach a human — an explicit human
 * request, a security incident, a refund, a complaint, an account-specific fact, a server that is
 * down — before it will retrieve anything at all. Account-specific questions are deliberately **not**
 * answered here: the support widget has no verified view of a customer's records, so claiming one
 * would be a fabrication even with a model attached. Those go to the queue, where the transcript
 * arrives with the conversation.
 *
 * Where an answer *is* produced, it is one of:
 *   · a reviewed catalogue answer (code-owned; the admin UI cannot silently mutate it), or
 *   · a published price read from the live catalog rows, or
 *   · the newsletter offer, which is a form request rather than a claim.
 * Each carries `intent`, `confidence` and `sources` so the trail is inspectable after the fact, and
 * each is labelled `engine: 'deterministic-retrieval'` — never "AI wrote this".
 */
'use strict';

/**
 * The reviewed knowledge catalogue.
 *
 * Every answer is tied to a real CloudHost247 surface, and every one of them states plainly what it
 * cannot confirm. That last part is not padding: it is the difference between documentation and a
 * guess, and it is why the entries below never promise a price, a status or a completion time.
 */
const KNOWLEDGE_ENTRIES = Object.freeze([
  {
    id: 'domain-dns-management',
    intent: 'domain_dns',
    title: 'Domains and DNS',
    keywords: ['domain', 'dns', 'nameserver', 'name server', 'a record', 'mx record', 'cname', 'txt record'],
    answer: 'You can manage domains and DNS from the CloudHost247 dashboard. Open Domains, select the domain, then use its DNS section to add or update records. DNS changes can take time to propagate, so allow for that before retrying. Use only the record values supplied by the service you are connecting.',
    source: 'CloudHost247 domain and DNS management workflow',
    weight: 20,
  },
  {
    id: 'domain-registration',
    intent: 'domain_registration',
    title: 'Domain registration and transfer',
    keywords: ['register a domain', 'domain registration', 'buy a domain', 'new domain', 'domain transfer', 'transfer a domain', 'auth code', 'epp code'],
    answer: 'CloudHost247 has a domain service area: you can search availability, and registrations and transfers are queued against the registrar the platform is configured with. Availability comes from a live registry or registrar lookup — this reply deliberately does not include a registrar result, a transfer status or a price, because those must come from the live lookup rather than from chat. Human support can help with a domain-specific request.',
    source: 'CloudHost247 domain service catalog and registrar integration',
    weight: 24,
  },
  {
    id: 'hosting-catalog',
    intent: 'hosting',
    title: 'Hosting products',
    keywords: ['web hosting', 'wordpress hosting', 'wordpress', 'cpanel', 'plesk', 'control panel', 'hosting plan', 'website deployment'],
    answer: 'CloudHost247 provides hosting products through its live service catalog, including web hosting, WordPress hosting, and control-panel based hosting where configured. Current plans, published prices and features are shown on the relevant CloudHost247 product page; an unpublished or unavailable plan is never quoted here.',
    source: 'CloudHost247 hosting catalog and product pages',
    weight: 18,
  },
  {
    id: 'cloud-vps-dedicated',
    intent: 'servers',
    title: 'Cloud, VPS and dedicated servers',
    keywords: ['vps', 'cloud server', 'cloud hosting', 'dedicated server', 'server hosting', 'virtual private server'],
    answer: 'CloudHost247 server products are managed from the server dashboard. The provider, region, operating system, control panel and available actions depend on the exact configured product. This chat can explain the dashboard workflow, but it cannot claim that a server is available, healthy, restored or provisioned without verified account or provider data.',
    source: 'CloudHost247 server catalog and server management workflow',
    weight: 20,
  },
  {
    id: 'server-management',
    intent: 'server_management',
    title: 'Server management',
    keywords: ['reinstall', 'reboot', 'restart server', 'shutdown', 'console', 'snapshot', 'firewall rule', 'server dashboard'],
    answer: 'Supported server actions are shown by the CloudHost247 server dashboard for the configured provider. Reinstalling an operating system is destructive and requires explicit confirmation. This chat cannot report a customer server status or promise an operation completion time without verified live data.',
    source: 'CloudHost247 server operations and provisioning rules',
    weight: 24,
  },
  {
    id: 'rdp',
    intent: 'rdp',
    title: 'RDP',
    keywords: ['rdp', 'remote desktop', 'windows remote desktop'],
    answer: 'RDP is a CloudHost247 service area. Current availability, plan details, credentials and connection information are account-specific or catalog-controlled. Support can help with a specific RDP service; this chat will not invent a server address, password, plan or availability.',
    source: 'CloudHost247 RDP service module',
    weight: 24,
  },
  {
    id: 'email-smtp',
    intent: 'email',
    title: 'Business email and SMTP',
    keywords: ['business email', 'email hosting', 'mailbox', 'smtp', 'smtp hosting', 'mail delivery'],
    answer: 'CloudHost247 email and SMTP services are listed in the CloudHost247 service catalog. For mailbox access, delivery, credentials or account-specific sending problems, the request is transferred to support rather than guessed at.',
    source: 'CloudHost247 email hosting and SMTP service modules',
    weight: 22,
  },
  {
    id: 'ssl',
    intent: 'ssl',
    title: 'SSL certificates',
    keywords: ['ssl', 'ssl certificate', 'tls', 'https', 'certificate'],
    answer: 'SSL certificates and their status are managed from the SSL area of the CloudHost247 dashboard. Certificate availability and validation depend on the selected service and domain configuration. This chat cannot confirm that a certificate has been issued without verified account data.',
    source: 'CloudHost247 SSL management workflow',
    weight: 20,
  },
  {
    id: 'billing-renewals',
    intent: 'billing',
    title: 'Billing and renewals',
    keywords: ['billing', 'invoice', 'renewal', 'renew', 'payment method', 'pay invoice', 'subscription'],
    answer: 'Invoices, payments and renewal details are in the authenticated CloudHost247 Billing area, and an account held by a signed-in customer can also be checked by the Cloud Assistant there. This chat cannot infer an individual payment, balance, renewal, refund or suspension status, so account-specific billing questions are transferred to support.',
    source: 'CloudHost247 billing and invoice workflow',
    weight: 18,
  },
  {
    id: 'support-tickets',
    intent: 'support',
    title: 'Support tickets',
    keywords: ['support ticket', 'ticket', 'help desk', 'contact support', 'support portal'],
    answer: 'Signed-in customers can open and track support tickets from the CloudHost247 Support area. This conversation can also be transferred to the support queue, preserving the full transcript so you do not have to repeat yourself.',
    source: 'CloudHost247 support ticket workflow',
    weight: 16,
  },
  {
    id: 'backup-troubleshooting',
    intent: 'backup_troubleshooting',
    title: 'Backups and restoration',
    keywords: ['backup', 'restore', 'restoration', 'recover data', 'troubleshooting'],
    answer: 'CloudHost247 backup coverage depends on the service and the plan, and the Backup Policy is the source of truth. For a restoration request, open a CloudHost247 support ticket with the affected service and the approximate date of the data you need; this chat cannot promise a restoration time or outcome.',
    source: 'CloudHost247 Backup Policy and support workflow',
    weight: 20,
  },
  {
    id: 'contact-information',
    intent: 'contact',
    title: 'Contact CloudHost247',
    keywords: ['contact cloudhost247', 'contact information', 'how do i contact', 'support email'],
    answer: 'You can reach CloudHost247 through the Support area and the support ticket workflow. For an account-specific issue this conversation can be transferred so the support team receives the full transcript instead of asking you to repeat it.',
    source: 'CloudHost247 contact and support pages',
    weight: 18,
  },
  {
    id: 'proxy-services',
    intent: 'proxy',
    title: 'Proxy services',
    keywords: ['proxy', 'proxies', 'proxy service'],
    answer: 'Proxy services are part of the CloudHost247 service catalog. Current plans, pricing and availability can only be confirmed from the live catalog. A service-specific or account-specific proxy request should go to CloudHost247 Support.',
    source: 'CloudHost247 proxy service module',
    weight: 22,
  },
  {
    id: 'phone-sms-otp',
    intent: 'phone_services',
    title: 'Virtual numbers, OTP and SMS',
    keywords: ['virtual number', 'phone number', 'otp', 'sms', 'text message', 'voip', 'esim'],
    answer: 'CloudHost247 includes phone and messaging service modules for numbers, SMS, OTP, VoIP and eSIM where configured. The exact country, number, delivery and pricing are service-specific and must be checked in the live catalog or with support.',
    source: 'CloudHost247 phone services modules',
    weight: 22,
  },
  {
    id: 'smm',
    intent: 'smm',
    title: 'SMM services',
    keywords: ['smm', 'social media marketing', 'social media service'],
    answer: 'SMM services are represented by a CloudHost247 service module. Current service details and availability are catalog-controlled. This chat will not invent delivery quantities, timing or guarantees; support can review a specific order.',
    source: 'CloudHost247 SMM service module',
    weight: 22,
  },
  {
    id: 'account-management',
    intent: 'account_management',
    title: 'Account management',
    keywords: ['change my name', 'account settings', 'profile', 'my account', 'sign in', 'login'],
    answer: 'You can manage your CloudHost247 profile from Account, and use the authenticated dashboard for services, domains, DNS, SSL, billing and support. Credentials, tokens, passwords and another customer\'s information are never exposed in chat, by design.',
    source: 'CloudHost247 account and authorization workflow',
    weight: 12,
  },
  {
    id: 'mrz-developer-tool',
    intent: 'mrz_developer_tool',
    title: 'ePassport MRZ calculator, validator and parser',
    keywords: ['mrz', 'machine readable zone', 'td3', 'icao 9303', 'check digit', 'mrz calculator', 'mrz parser', 'epassport mrz'],
    answer: 'CloudHost247 provides a privacy-first ePassport MRZ calculator and parser in Developer Tools for legitimate software development and OCR/parser testing, and the platform\'s own tool endpoint can explain the format field by field. It implements the ICAO Doc 9303 TD3 two-line (44 characters per line) format, Latin diacritic transliteration and 7-3-1 modulo-10 check digits. Mathematical MRZ validation only checks syntax and check digits — it never verifies whether a physical passport is genuine or government-issued, and submitted MRZ inputs are never stored.',
    source: 'CloudHost247 Developer / Document Tools — MRZ calculator and parser',
    weight: 26,
  },
]);

/** Escalation reasons, ported from the audited build's `EscalationReason` union. */
const ESCALATION_REASONS = Object.freeze([
  'USER_REQUESTED_HUMAN', 'AI_UNABLE_TO_ANSWER', 'ACCOUNT_SPECIFIC_REQUEST', 'BILLING_SUPPORT_REQUIRED',
  'TECHNICAL_SUPPORT_REQUIRED', 'SERVER_SUPPORT_REQUIRED', 'COMPLAINT', 'REFUND_REQUEST',
  'SECURITY_RELATED', 'OTHER',
]);

/** Reasons that make a conversation high priority in the human queue. */
const HIGH_PRIORITY_REASONS = Object.freeze(['SECURITY_RELATED', 'COMPLAINT', 'REFUND_REQUEST']);

/** The engine label attached to every decision — this platform runs no language model here. */
const ENGINE = 'deterministic-retrieval';

// ---------------------------------------------------------------------------- intent patterns
// Conservative by construction: each pattern captures a case where a wrong answer would be worse
// than an escalation.

const HUMAN_REQUEST = /(?:\b(?:human|real person|live person|live agent|support agent|support representative|representative)\b)|(?:\b(?:connect|transfer|route)\b.{0,36}\b(?:human|agent|person|support|representative)\b)|(?:\b(?:speak|talk|chat)\b.{0,24}\b(?:human|someone|person|agent|support|representative)\b)|(?:\b(?:let me|i need|can i)\b.{0,24}\b(?:speak|talk|chat)\b.{0,24}\b(?:agent|human|person|support)\b)/i;
const NEWSLETTER_REQUEST = /\b(?:newsletter|mailing list|subscribe me|subscribe to|service announcements|updates and offers)\b/i;
const NEWSLETTER_CONFIRMATION = /^(?:yes|yeah|yep|sure|okay|ok|i agree|please do|sign me up|do it)[!. ]*$/i;
const SECURITY_REQUEST = /\b(?:hacked|hack|breach|compromised|stolen password|security incident|account takeover|abuse report)\b/i;
const REFUND_REQUEST = /\b(?:refund|chargeback|money back|cancel\s+(?:my\s+)?payment)\b/i;
const COMPLAINT_REQUEST = /\b(?:complaint|complain|lawyer|legal action|sue|fraud)\b/i;
const SERVER_INCIDENT = /\b(?:server|vps|instance)\b.{0,30}\b(?:down|offline|unreachable|broken|not working|failed)\b/i;
const ACCOUNT_ACTION = /\b(?:transfer|delete|cancel|renew)\s+my\s+|\b(?:can you|please|i need you to)\s+(?:update|change|add|remove|delete|configure)\s+my\b/i;
// `my account / my invoice / my server …` are questions about a record this chat cannot read. A bare
// "my domain" or "my ticket" is not on that list on purpose: those are usually how-to questions, and
// the catalogue answers them as workflow rather than as account data. Ask about the *status* of one
// and it escalates again, because a status is a fact about a row.
const ACCOUNT_REQUEST = /\b(?:my|our)\s+(?:account|invoice|payment|order|refund|renewal|subscription|server|vps)\b|\b(?:payment status|server status|account status|domain status|transfer status|order status|ticket status|why (?:was|is) my)\b|\b(?:password|credential|api key|secret|token)\b/i;
const BILLING_REQUEST = /\b(?:billing|invoice|renewal|renew|payment method|pay invoice|payment)\b/i;
const PRICE_REQUEST = /\b(?:price|pricing|cost|how much|fee|fees)\b/i;

/** Product terms used to narrow a price lookup to the rows the question is actually about. */
const PRICE_TERMS = Object.freeze([
  'domain', 'hosting', 'wordpress', 'cpanel', 'plesk', 'vps', 'cloud', 'dedicated', 'rdp', 'email',
  'smtp', 'ssl', 'proxy', 'smm', 'sms', 'otp', 'server',
]);

const normalize = (value) => String(value ?? '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Deterministic retrieval: score every entry by how many of its keywords appear in the message, and
 * let the entry's reviewed weight break ties. No embedding, no model, nothing that can drift.
 */
function retrieveKnowledge(message) {
  const text = normalize(message);
  if (!text) return null;
  const matches = KNOWLEDGE_ENTRIES
    .map((entry) => ({
      entry,
      score: entry.keywords.reduce((score, keyword) => score + (text.includes(normalize(keyword)) ? 1 : 0), 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return (right.entry.weight ?? 0) - (left.entry.weight ?? 0);
    });
  return matches[0]?.entry ?? null;
}

/** The reviewed catalogue, for the admin knowledge view. Code-owned and read-only there. */
function listSupportKnowledge() {
  return KNOWLEDGE_ENTRIES.map((entry) => ({ ...entry }));
}

function noAnswer(intent, reason, body, confidence = 0.1) {
  return { kind: 'ESCALATE', body, intent, confidence, sources: [], reason, engine: ENGINE };
}

/**
 * Published prices, read from the real catalog rows.
 *
 * `catalog_plan_pricing.price` is numeric: depending on the driver it arrives as a number or a
 * string. It is formatted, never re-typed, and a product/plan/pricing triple that is not fully
 * present is skipped rather than shown with a hole in it. If nothing matches, the caller refuses to
 * quote a price — an empty catalog read must never become "contact us for pricing" dressed as data,
 * and it must never become a number.
 */
async function publishedPrices(store, requestText, { limit = 20 } = {}) {
  let products; let plans; let pricing;
  try {
    [products, plans, pricing] = await Promise.all([
      store.table('catalog_products').all(),
      store.table('catalog_product_plans').all(),
      store.table('catalog_plan_pricing').all(),
    ]);
  } catch (error) {
    // A catalog that cannot be read is a refusal, not an empty price list: "no published pricing"
    // and "I could not look" are different statements and the customer is told which one happened.
    return { rows: [], count: 0, scope: [], failure: String(error.message ?? error) };
  }

  const productById = new Map(products.filter((row) => row.status === 'active').map((row) => [row.id, row]));
  const planById = new Map(plans.filter((row) => row.status === 'active').map((row) => [row.id, row]));

  const text = normalize(requestText);
  const requested = PRICE_TERMS.filter((term) => text.includes(term));

  const formatAmount = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return String(numeric);
  };

  const rows = [];
  for (const price of pricing) {
    if (price.is_active === false) continue;
    const plan = planById.get(price.plan_id);
    const product = plan ? productById.get(plan.product_id) : null;
    if (!plan || !product) continue;
    const haystack = `${product.name} ${product.slug} ${product.category ?? ''} ${plan.name} ${plan.slug}`.toLocaleLowerCase();
    if (requested.length > 0 && !requested.some((term) => haystack.includes(term))) continue;
    const amount = formatAmount(price.price);
    if (amount === null) continue;
    const setupFee = formatAmount(price.setup_fee);
    rows.push({
      productName: product.name,
      planName: plan.name,
      amount,
      currency: price.currency ?? 'USD',
      billingCycle: price.billing_cycle,
      setupFee: setupFee && Number(setupFee) > 0 ? setupFee : null,
      line: `${product.name} — ${plan.name}: ${price.currency ?? 'USD'} ${amount} ${price.billing_cycle}${setupFee && Number(setupFee) > 0 ? ` plus ${price.currency ?? 'USD'} ${setupFee} setup` : ''}`,
    });
    if (rows.length >= limit) break;
  }

  return { rows, count: rows.length, scope: requested };
}

/**
 * Human-support availability, from presence rows and real conversation load.
 *
 * ONLINE when at least one eligible staff member is present with spare capacity, BUSY when staff are
 * present but at capacity, OFFLINE when nobody is. Extracted from the public availability route so
 * the route and the escalation path cannot disagree about whether a human is reachable.
 */
async function supportAvailability(store, { spareCapacity = true } = {}) {
  const [users, presence, conversations] = await Promise.all([
    store.table('users').all(),
    store.table('support_agent_presence').all(),
    store.table('ai_support_conversations').all(),
  ]);

  const eligible = new Set(
    users.filter((u) => u.status === 'active' && ['staff', 'admin', 'super_admin'].includes(u.role)).map((u) => u.id),
  );

  const availableAgentIds = [];
  let online = 0;
  let busy = 0;
  for (const row of presence) {
    if (!eligible.has(row.user_id)) continue;
    if (row.status === 'ONLINE') {
      online += 1;
      const load = conversations.filter(
        (c) => c.assigned_agent_id === row.user_id && ['ASSIGNED', 'IN_PROGRESS'].includes(c.status),
      ).length;
      if (!spareCapacity || load < (row.capacity ?? 3)) availableAgentIds.push(row.user_id);
    } else if (row.status === 'BUSY') {
      busy += 1;
    }
  }

  // Lowest current load first, so a second escalation does not land on the same agent as the first.
  const loadOf = (agentId) => conversations.filter(
    (c) => c.assigned_agent_id === agentId && ['ASSIGNED', 'IN_PROGRESS'].includes(c.status),
  ).length;
  availableAgentIds.sort((a, b) => loadOf(a) - loadOf(b));

  return {
    status: availableAgentIds.length > 0 ? 'ONLINE' : (online > 0 || busy > 0) ? 'BUSY' : 'OFFLINE',
    availableAgentIds,
    onlineCount: online,
    busyCount: busy,
  };
}

function sourceFor(entry, catalogNames) {
  return [entry.source, ...catalogNames.slice(0, 3).map((name) => `Catalog: ${name}`)];
}

function priceDecision(result) {
  const rows = result.rows ?? [];
  if (rows.length === 0) {
    return noAnswer(
      'pricing',
      'AI_UNABLE_TO_ANSWER',
      result.failure
        ? 'The CloudHost247 catalog could not be read just now, so no price can be quoted here. I will not guess a price — CloudHost247 Support can confirm the correct product and price.'
        : 'I could not find published pricing in the CloudHost247 catalog for that request, so I will not guess a price. CloudHost247 Support can confirm the correct product and price.',
      0.05,
    );
  }
  return {
    kind: 'ANSWER',
    engine: ENGINE,
    body: `The current published CloudHost247 catalog shows:\n\n${rows.slice(0, 8).map((row) => `• ${row.line}`).join('\n')}\n\nPrices and availability can change; the live product page is the source of truth.`,
    intent: 'pricing',
    confidence: 0.96,
    sources: ['CloudHost247 published product catalog'],
  };
}

/**
 * Decide what the support assistant replies with.
 *
 * Order matters and is deliberate: the cases that must reach a human are checked before retrieval,
 * so no amount of keyword overlap can route a refund request, a security report or an
 * account-specific question into a documentation answer.
 */
async function decideSupportResponse(store, message, { previousMessages = [] } = {}) {
  const text = String(message ?? '').trim();
  if (!text) return noAnswer('empty', 'AI_UNABLE_TO_ANSWER', 'Please send a question, or ask for CloudHost247 Support.', 0);

  if (HUMAN_REQUEST.test(text)) {
    return noAnswer('human_request', 'USER_REQUESTED_HUMAN', 'I will take you to a CloudHost247 support representative and keep the full conversation with it.', 1);
  }
  if (SECURITY_REQUEST.test(text)) {
    return noAnswer('security', 'SECURITY_RELATED', 'Security-related requests need a human support representative. I am escalating this conversation now, with the transcript attached.', 1);
  }
  if (REFUND_REQUEST.test(text)) {
    return noAnswer('refund', 'REFUND_REQUEST', 'Refund decisions require CloudHost247 Support. I am escalating this conversation now rather than answering it myself.', 1);
  }
  if (COMPLAINT_REQUEST.test(text)) {
    return noAnswer('complaint', 'COMPLAINT', 'I am sorry this needs attention. I am escalating this conversation to CloudHost247 Support now.', 1);
  }

  const newsletterWasOffered = previousMessages.some(
    (item) => item.role === 'assistant' && /newsletter|subscribe to CloudHost247/i.test(String(item.content ?? '')),
  );
  if (NEWSLETTER_REQUEST.test(text) || (newsletterWasOffered && NEWSLETTER_CONFIRMATION.test(text))) {
    return {
      kind: 'NEWSLETTER',
      engine: ENGINE,
      body: 'Would you like to subscribe to CloudHost247 updates, offers and service announcements? A newsletter subscription is separate from a support request — provide your full name and email in the subscription form and it is recorded as its own consent.',
      intent: 'newsletter',
      confidence: 1,
      sources: ['CloudHost247 newsletter subscription workflow'],
    };
  }

  if (SERVER_INCIDENT.test(text)) {
    return noAnswer(
      'server_incident',
      /\bmy\b/i.test(text) ? 'ACCOUNT_SPECIFIC_REQUEST' : 'SERVER_SUPPORT_REQUIRED',
      'This chat cannot verify a server\'s live status, so it will not claim one. I am preserving the conversation and connecting you to CloudHost247 Support.',
      0.99,
    );
  }
  if (ACCOUNT_ACTION.test(text)) {
    return noAnswer(
      'account_action',
      'ACCOUNT_SPECIFIC_REQUEST',
      'The general CloudHost247 workflow can be explained here, but an account-specific change cannot be made or confirmed from chat. I am transferring this conversation to CloudHost247 Support.',
      0.99,
    );
  }
  if (ACCOUNT_REQUEST.test(text)) {
    const reason = BILLING_REQUEST.test(text) ? 'BILLING_SUPPORT_REQUIRED' : 'ACCOUNT_SPECIFIC_REQUEST';
    return noAnswer(
      'account_specific',
      reason,
      'Account-specific information cannot be safely determined from a general chat reply, so this is not answered from here. I am transferring the conversation to CloudHost247 Support.',
      0.98,
    );
  }

  if (PRICE_REQUEST.test(text)) return priceDecision(await publishedPrices(store, text));

  // A short follow-up such as "and WordPress?" can use the immediately preceding customer message
  // for retrieval. The full transcript is still stored; this only preserves a small, deterministic
  // amount of context and never reaches for an external service.
  const previousCustomer = previousMessages.find((item) => item.role === 'user' || item.role === 'CUSTOMER')?.content ?? '';
  const retrievalText = text.length < 32 && previousCustomer ? `${previousCustomer} ${text}` : text;
  const entry = retrieveKnowledge(retrievalText);
  if (entry) {
    // Optional catalog citations, exactly as the audited build treated them: if the catalog read
    // fails the answer still stands on its own source, and no product name is invented to fill in.
    const products = await store.table('catalog_products').all().catch(() => []);
    const catalogNames = products.filter((row) => row.status === 'active').map((row) => row.name);
    return {
      kind: 'ANSWER',
      engine: ENGINE,
      body: entry.answer,
      intent: entry.intent,
      confidence: Math.min(0.98, 0.78 + (entry.weight ?? 0) / 100),
      sources: sourceFor(entry, catalogNames),
    };
  }

  return noAnswer(
    'unknown',
    'AI_UNABLE_TO_ANSWER',
    'I do not have verified CloudHost247 information to answer that accurately, so I will not attempt one. I am transferring this conversation to CloudHost247 Support with the transcript.',
    0.15,
  );
}

module.exports = {
  KNOWLEDGE_ENTRIES,
  ESCALATION_REASONS,
  HIGH_PRIORITY_REASONS,
  ENGINE,
  retrieveKnowledge,
  listSupportKnowledge,
  publishedPrices,
  supportAvailability,
  decideSupportResponse,
};
