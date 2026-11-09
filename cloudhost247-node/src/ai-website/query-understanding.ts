import { foldText } from './types';

/**
 * Query understanding.
 *
 * The assistant has to answer "do you sell vps", "cheapest webhosting", "diff between vps and
 * dedicated", "can i host wordpress" and "how do i register a domian" from the same knowledge base
 * that stores the website's own words. That gap — customer vocabulary vs. published vocabulary — is
 * closed here, deterministically, before retrieval runs:
 *
 *   1. normalise      — fold case/accents, strip the brand name and question scaffolding
 *   2. expand         — abbreviations and alternative terminology become the canonical terms
 *   3. correct        — unknown tokens are matched against the *index vocabulary* (never a hardcoded
 *                        dictionary), so "domian" → "domain" and "wrodpress" → "wordpress"
 *   4. classify       — the question shape (pricing, availability, how-to, comparison, definition)
 *   5. resolve        — which CloudHost247 offerings the question is about
 *
 * No network calls, no model. Every function here is pure and unit-tested.
 */

/** Canonical CloudHost247 offering families, and the words customers actually use for them. */
export interface ServiceEntity {
  /** The id used in retrieval boosts and in the admin coverage report. */
  id: string;
  /** The authoritative page a customer should end up on for this offering. */
  route: string;
  label: string;
  aliases: readonly string[];
}

/**
 * This list maps *vocabulary*, not products. It never asserts that an offering exists — every
 * claim about availability and price still has to come from a retrieved page or the live catalogue
 * (see src/ai-website/live-facts.ts). If a page does not exist, the entity simply never matches
 * anything and the assistant says it cannot verify the offering.
 */
export const SERVICE_ENTITIES: readonly ServiceEntity[] = [
  { id: 'shared-hosting', route: '/hosting/web-hosting', label: 'Web hosting', aliases: ['web hosting', 'shared hosting', 'hosting', 'website hosting', 'webbosting', 'webhost', 'hosting plan', 'hosting plans', 'host'] },
  { id: 'wordpress-hosting', route: '/hosting/wordpress', label: 'WordPress hosting', aliases: ['wordpress', 'wp', 'wordpress hosting', 'woocommerce', 'woocommerce hosting'] },
  { id: 'business-hosting', route: '/hosting/business', label: 'Business hosting', aliases: ['business hosting', 'business host', 'small business hosting', 'company hosting'] },
  { id: 'reseller-hosting', route: '/hosting/reseller', label: 'Reseller hosting', aliases: ['reseller', 'reseller hosting', 'white label', 'whitelabel hosting'] },
  { id: 'vps-hosting', route: '/hosting/vps', label: 'VPS hosting', aliases: ['vps', 'virtual private server', 'virtual server', 'vps hosting', 'virtual machine', 'vm', 'kvm'] },
  { id: 'dedicated-server', route: '/hosting/dedicated', label: 'Dedicated servers', aliases: ['dedicated', 'dedicated server', 'dedicated servers', 'bare metal', 'bare metal server', 'dedi', 'dedicated hosting', 'physical server'] },
  { id: 'cloud-hosting', route: '/cloud', label: 'Cloud hosting', aliases: ['cloud', 'cloud hosting', 'public cloud', 'private cloud', 'cloud server', 'cloud servers', 'elastic compute', 'cloud instances'] },
  { id: 'enterprise-servers', route: '/cloud/enterprise-servers', label: 'Enterprise servers', aliases: ['enterprise server', 'enterprise servers', 'high memory server', 'high core server'] },
  { id: 'game-servers', route: '/cloud/game-servers', label: 'Game servers', aliases: ['game server', 'game servers', 'gaming server', 'minecraft server'] },
  { id: 'domain-registration', route: '/domains', label: 'Domains', aliases: ['domain', 'domains', 'domain name', 'domain names', 'register domain', 'domain registration', 'buy domain', 'new domain', 'tld', 'domian', 'domian name'] },
  { id: 'domain-transfer', route: '/domains/transfer', label: 'Domain transfer', aliases: ['domain transfer', 'transfer domain', 'transfer a domain', 'transfer my domain', 'move domain'] },
  { id: 'domain-search', route: '/domains/search', label: 'Domain search', aliases: ['domain search', 'check domain', 'domain availability', 'is my domain available', 'search domain'] },
  { id: 'dns-management', route: '/domains/dns', label: 'DNS management', aliases: ['dns', 'dns management', 'nameserver', 'nameservers', 'name server', 'a record', 'cname', 'mx record', 'txt record', 'dns record', 'dns records', 'propagation'] },
  { id: 'email-hosting', route: '/hosting/email', label: 'Email hosting', aliases: ['email', 'email hosting', 'business email', 'business email hosting', 'mailbox', 'mailboxes', 'smtp', 'imap', 'webmail', 'professional email', 'email address', 'email addresses'] },
  { id: 'ssl', route: '/hosting/ssl', label: 'SSL certificates', aliases: ['ssl', 'ssl certificate', 'ssl certificates', 'tls', 'https', 'certificate', 'security certificate', 'secure certificate', 'letsencrypt', 'lets encrypt', "let's encrypt"] },
  { id: 'cpanel', route: '/hosting/cpanel', label: 'cPanel hosting', aliases: ['cpanel', 'c panel', 'control panel', 'control panels', 'cp'] },
  { id: 'plesk', route: '/hosting/plesk', label: 'Plesk hosting', aliases: ['plesk'] },
  { id: 'windows-hosting', route: '/hosting/windows', label: 'Windows hosting', aliases: ['windows hosting', 'windows', 'asp net', 'iis', 'ms sql', 'mssql'] },
  { id: 'php-hosting', route: '/developers/php', label: 'PHP hosting', aliases: ['php', 'php hosting'] },
  { id: 'nodejs-hosting', route: '/developers/nodejs', label: 'Node.js hosting', aliases: ['node', 'nodejs', 'node js', 'npm', 'express'] },
  { id: 'python-hosting', route: '/developers/python', label: 'Python hosting', aliases: ['python', 'django', 'flask', 'wsgi'] },
  { id: 'laravel-hosting', route: '/developers/laravel', label: 'Laravel hosting', aliases: ['laravel', 'artisan', 'php artisan'] },
  { id: 'docker-hosting', route: '/developers/docker', label: 'Docker hosting', aliases: ['docker', 'container', 'containers', 'compose', 'dockerfile'] },
  { id: 'website-builder', route: '/websites/builder', label: 'Website builder', aliases: ['website builder', 'site builder', 'page builder', 'drag and drop builder', 'build a website'] },
  { id: 'ai-website-builder', route: '/websites/ai-builder', label: 'AI website builder', aliases: ['ai website builder', 'ai builder', 'ai site', 'generate a website', 'ai website'] },
  { id: 'website-design', route: '/websites/design-services', label: 'Website design services', aliases: ['website design', 'web design', 'design services', 'website redesign', 'build my website for me'] },
  { id: 'digital-marketing', route: '/marketing/digital', label: 'Digital marketing', aliases: ['digital marketing', 'seo', 'marketing services', 'adwords', 'google ads', 'social media marketing'] },
  { id: 'server-management', route: '/services/server-management', label: 'Server management', aliases: ['server management', 'managed server', 'managed servers', 'server admin', 'sysadmin'] },
  { id: 'backups', route: '/cloud/backups', label: 'Backups', aliases: ['backup', 'backups', 'restore', 'restoration', 'snapshot', 'backup policy', 'recover my data'] },
  { id: 'migration', route: '/hosting/migration', label: 'Migration', aliases: ['migration', 'migrate', 'move my website', 'transfer my website', 'move my hosting', 'transfer hosting'] },
  { id: 'monitoring', route: '/cloud/monitoring', label: 'Monitoring', aliases: ['monitoring', 'uptime', 'uptime monitoring', 'status monitoring', 'alerts'] },
  { id: 'firewall', route: '/cloud/firewall', label: 'Firewall', aliases: ['firewall', 'firewall rules', 'waf', 'ip blocking'] },
  { id: 'data-centers', route: '/cloud/data-centers', label: 'Data centres', aliases: ['data center', 'data centers', 'data centre', 'data centres', 'datacenter', 'region', 'regions', 'location', 'locations'] },
  { id: 'operating-systems', route: '/cloud/operating-systems', label: 'Operating systems', aliases: ['operating system', 'operating systems', 'os', 'os image', 'ubuntu', 'debian', 'centos', 'almalinux', 'rocky linux', 'windows server'] },
  { id: 'support', route: '/help', label: 'Support', aliases: ['support', 'help', 'help center', 'help centre', 'support ticket', 'ticket', 'contact support', 'get help', 'contact'] },
  { id: 'account', route: '/account', label: 'Customer account', aliases: ['account', 'my account', 'dashboard', 'client area', 'clientarea', 'customer area', 'portal', 'profile', 'settings'] },
  { id: 'billing', route: '/billing', label: 'Billing', aliases: ['billing', 'invoice', 'invoices', 'payment', 'payments', 'renewal', 'renew', 'renewals', 'refund', 'subscription', 'subscriptions', 'balance', 'card'] },
  { id: 'cart', route: '/cart', label: 'Cart and checkout', aliases: ['cart', 'checkout', 'order', 'ordering', 'buy', 'purchase', 'subscribe', 'sign up', 'how do i order'] },
  { id: 'tools', route: '/tools', label: 'Free tools', aliases: ['tools', 'free tools', 'utilities', 'dns lookup', 'whois', 'ip lookup', 'dns checker', 'ssl checker', 'calculator'] },
  { id: 'docs', route: '/docs', label: 'Developer documentation', aliases: ['docs', 'documentation', 'api docs', 'developer docs', 'api reference'] },
  { id: 'legal', route: '/legal', label: 'Legal and policies', aliases: ['legal', 'terms', 'terms of service', 'privacy', 'privacy policy', 'policy', 'policies', 'aup', 'acceptable use', 'cookie policy', 'sla'] },
  { id: 'status', route: '/status', label: 'Service status', aliases: ['status', 'service status', 'outage', 'downtime', 'is it down', 'maintenance'] },
  // "about" alone is a preposition ("what about WordPress"), so the company entity requires a
  // phrase. Bare "about" resolving the About page made every follow-up answer about the company.
  { id: 'about', route: '/about', label: 'About CloudHost247', aliases: ['about cloudhost247', 'about us', 'about the company', 'who are you', 'company information'] },
];

/** Words that carry no retrieval signal in this domain, and question scaffolding. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did',
  'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must', 'i', 'we', 'you',
  'they', 'he', 'she', 'it', 'me', 'us', 'them', 'my', 'our', 'your', 'their', 'its', 'this',
  'that', 'these', 'those', 'and', 'or', 'but', 'if', 'then', 'than', 'so', 'such', 'of', 'to',
  'in', 'on', 'at', 'by', 'for', 'from', 'with', 'about', 'into', 'over', 'under', 'as', 'have',
  'has', 'had', 'having', 'there', 'here', 'what', 'which', 'who', 'whom', 'when', 'where', 'why',
  'how', 'please', 'hi', 'hello', 'hey', 'thanks', 'thank', 'tell', 'show', 'give', 'want',
  'need', 'like', 'know', 'let', 'any', 'some', 'more', 'most', 'much', 'many', 'also', 'just',
  'really', 'very', 'get', 'got', 'make', 'made', 'use', 'using', 'used', 'available', 'offer',
  'offers', 'provide', 'provides', 'sell', 'sells', 'ok', 'okay', 'yes', 'no', 'not',
]);

/** Brand tokens, stripped before matching so "cloudhost247 vps" behaves like "vps". */
const BRAND_TOKENS = new Set(['cloudhost247', 'cloudhost', 'ch247', 'cloud host 247', 'cloudhost24']);

/** Abbreviations and alternative terminology → canonical terms, applied to the folded query. */
const EXPANSIONS: ReadonlyArray<{ pattern: RegExp; terms: readonly string[] }> = [
  { pattern: /\bvps(?:es)?\b/g, terms: ['vps', 'virtual', 'private', 'server'] },
  { pattern: /\bvm(?:s)?\b/g, terms: ['vps', 'virtual', 'server'] },
  { pattern: /\bdEDI\b/gi, terms: ['dedicated', 'server'] },
  { pattern: /\bdedis?\b/g, terms: ['dedicated', 'server'] },
  { pattern: /\bbare ?metal\b/g, terms: ['dedicated', 'server'] },
  { pattern: /\bwp\b/g, terms: ['wordpress'] },
  { pattern: /\bwoocommerce\b/g, terms: ['wordpress', 'woocommerce'] },
  { pattern: /\bssl\b|\btls\b/g, terms: ['ssl', 'certificate'] },
  { pattern: /\bhttps\b/g, terms: ['ssl', 'https', 'certificate'] },
  { pattern: /\bemail\b|\bmails?\b/g, terms: ['email', 'mailbox'] },
  { pattern: /\bsmtp\b|\bimap\b|\bpop3\b/g, terms: ['email', 'smtp', 'mailbox'] },
  { pattern: /\bcpanel\b|\bc ?panel\b/g, terms: ['cpanel', 'control', 'panel'] },
  { pattern: /\bdns\b/g, terms: ['dns', 'nameserver', 'record'] },
  { pattern: /\bcdn\b/g, terms: ['cdn', 'cache', 'network'] },
  { pattern: /\bos\b/g, terms: ['operating', 'system'] },
  { pattern: /\bspa\b/g, terms: ['website', 'application'] },
  { pattern: /\bai\b/g, terms: ['ai'] },
  { pattern: /\bprice\b|\bprices\b|\bpricing\b|\bcost\b|\bcosts\b|\bfee\b|\bfees\b|\bcharge\b|\bcharges\b|\bcheap\b|\bcheapest\b|\baffordable\b|\bbudget\b|\brate\b|\brates\b/g, terms: ['price', 'pricing', 'plan'] },
  { pattern: /\bbuy\b|\border\b|\borders\b|\bpurchase\b|\bsubscribe\b|\bsignup\b|\bsign up\b/g, terms: ['order', 'purchase', 'cart'] },
  { pattern: /\bhost\b|\bhosting\b|\bhosted\b/g, terms: ['hosting'] },
  { pattern: /\bdomain\b|\bdomains\b|\btld\b|\btlds\b/g, terms: ['domain', 'registration'] },
  { pattern: /\bmy\b|\baccount\b|\bdashboard\b|\bportal\b/g, terms: ['account', 'dashboard'] },
  { pattern: /\bdown\b|\boffline\b|\boutage\b|\bstatus\b/g, terms: ['status', 'outage'] },
  { pattern: /\bhelp\b|\bhuman\b|\bagent\b|\brepresentative\b|\bperson\b/g, terms: ['support', 'help'] },
];

export type QuestionIntent =
  | 'pricing'
  | 'availability'
  | 'how_to'
  | 'comparison'
  | 'definition'
  | 'navigation'
  | 'troubleshooting'
  | 'support_request'
  | 'account_specific'
  | 'general';

export interface QueryUnderstanding {
  /** The raw query, unchanged. */
  raw: string;
  /** Folded, brand-stripped query text. */
  normalised: string;
  /** Content tokens after stopword/brand removal (unstemmed, uncorrected). */
  tokens: string[];
  /** Corrected tokens (typo tolerance applied against the vocabulary). */
  correctedTokens: string[];
  /** Synonym/abbreviation expansions, deduplicated, in a stable order. */
  expansions: string[];
  /** The entity families the question is about, most specific first. */
  entities: ServiceEntity[];
  /** Customer words that must appear on a page for it to be evidence (see `rerank`). */
  strictTokens: string[];
  /** Customer words with no vocabulary presence and no known expansion: possible coverage gap. */
  ungroundedTokens?: string[];
  /** Human-readable record of the misspellings that were corrected, for the admin console. */
  corrections: string[];
  intent: QuestionIntent;
  /** True when the question asks for a comparison between two offerings. */
  isComparison: boolean;
  /** True when the question is a short follow-up that needs the previous turn's subject. */
  isFollowUp: boolean;
}

/** Light suffix stripping. FTS already stems; this is for the deterministic matchers. */
export function stem(token: string): string {
  if (token.length <= 3) return token;
  for (const suffix of ['ings', 'ing', 'ies', 'ied', 'ers', 'er', 'est', 'ed', 'es', 's']) {
    if (token.length - suffix.length < 3) continue;
    if (token.endsWith(suffix)) {
      const base = token.slice(0, -suffix.length);
      if (suffix === 'ies' || suffix === 'ied') return `${base}y`;
      return base;
    }
  }
  return token;
}

/**
 * Optimal-string-alignment distance, with an early exit once `max` is exceeded.
 *
 * OSA rather than plain Levenshtein because transposition is the typo that matters here: "vsp" for
 * "vps" and "dns records" for "nds records" are one keystroke apart to a person, and should cost one
 * edit, not two. That single change is what lets "do you sell vsp" resolve to VPS without any
 * hardcoded misspelling list.
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) rows.push(new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) rows[i]![0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, rows[i - 2]![j - 2]! + 1);
      }
      rows[i]![j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
  }
  return rows[a.length]![b.length]!;
}

/**
 * Corrects a token against a vocabulary using edit distance. Short tokens need an exact match,
 * because "wp" → "wps" style corrections do more harm than good.
 */
/**
 * Words that mean something decisive in a question and must never be "corrected" into something else.
 * "cost" is one edit from "cose"; correcting it silently turned a pricing question into nonsense and
 * the customer got "I cannot verify that" about a price the catalogue publishes.
 */
const PROTECTED_QUERY_WORDS = new Set([
  'price', 'prices', 'pricing', 'cost', 'costs', 'fee', 'fees', 'charge', 'charges', 'cheap',
  'cheapest', 'affordable', 'budget', 'plan', 'plans', 'buy', 'order', 'purchase', 'subscribe',
  'refund', 'refunds', 'cancel', 'renew', 'upgrade', 'downgrade', 'transfer', 'register',
  'hosting', 'host', 'domain', 'domains', 'email', 'ssl', 'vps', 'dns', 'server', 'servers',
  'backup', 'backups', 'support', 'ticket', 'tickets', 'invoice', 'invoices', 'payment', 'billing',
  'account', 'login', 'password', 'policy', 'policies', 'terms', 'privacy', 'uptime', 'sla',
  // Product and protocol names that are one edit from an unrelated common word. "voip" was being
  // corrected to "void" (both appear on the site), which turned a real service question into
  // nonsense before it was ever searched.
  'voip', 'smtp', 'imap', 'pop3', 'ssd', 'nvme', 'http', 'https', 'ipv4', 'ipv6', 'ssh', 'ftp',
  'cpanel', 'whm', 'letsencrypt', 'mysql', 'mariadb', 'postgres', 'redis', 'node', 'laravel',
]);

export function correctToken(token: string, vocabulary: ReadonlySet<string>): { token: string; corrected: boolean } {
  // Three-letter tokens are included deliberately: "vsp", "dns", "wp" are exactly the vocabulary a
  // hosting customer types, and a transposition of one is one edit away under OSA.
  if (token.length < 3 || vocabulary.has(token) || PROTECTED_QUERY_WORDS.has(token)) {
    return { token, corrected: false };
  }
  const limit = token.length <= 6 ? 1 : 2;
  let best: string | null = null;
  let bestDistance = limit + 1;
  for (const candidate of vocabulary) {
    if (Math.abs(candidate.length - token.length) > limit) continue;
    // Cheap pre-filter: the first letter of a misspelling is almost always correct.
    if (candidate[0] !== token[0]) continue;
    const distance = editDistance(token, candidate, limit);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
      if (distance === 1) break;
    }
  }
  return best ? { token: best, corrected: true } : { token, corrected: false };
}

const COMPARISON_PATTERN = /\b(?:difference|different|compare|comparison|versus|vs\.?|better|or)\b/i;
const PRICE_PATTERN = /\b(?:price|prices|pricing|cost|costs|fee|fees|charge|charges|cheap|cheapest|affordable|budget|how much|plan|plans|quote)\b/i;
const HOW_TO_PATTERN = /\b(?:how (?:do|can|does|to)|what is the process|steps?|guide|set ?up|configure|install|register|order|sign ?up|open an account|create an account)\b/i;
const DEFINITION_PATTERN = /^\s*(?:what(?:'s| is| are)|define|explain|meaning of|what does)\b/i;
const NAV_PATTERN = /\b(?:where (?:can|do|is)|find|locate|go to|navigate|which page|link|url)\b/i;
const TROUBLE_PATTERN = /\b(?:not working|doesn't work|does not work|broken|error|fail|failing|failed|cannot|can't|unable|stuck|slow|down|offline)\b/i;
const AVAILABILITY_PATTERN = /\b(?:available|availability|do you (?:have|offer|sell|provide|support)|is there|in stock|ready)\b/i;
const ACCOUNT_PATTERN = /\b(?:my|our)\s+(?:account|invoice|invoices|order|orders|payment|payments|service|services|domain|domains|ticket|tickets|bill|billing|server|servers|subscription|subscriptions)\b/i;
const SUPPORT_PATTERN = /\b(?:human|real person|live agent|live chat|speak to (?:someone|a person|an agent)|talk to (?:someone|a person|an agent)|contact support|raise a ticket|open a ticket|submit a ticket|complain|complaint)\b/i;
const FOLLOW_UP_PATTERN = /^\s*(?:what about|how about|and|also|which one|how much|how many|what is (?:that|it|this)|tell me more|more|why|and the)\b/i;
/** A turn whose only content words are pronouns: it cannot be answered without its predecessor. */
const PRONOUN_ONLY = /^\s*(?:how much is it|how much|which one|what about it|is it|does it|can it|and|more|why|how)\b[\s?!.]*$/i;

/** Normalises a question: folded, brand-free, punctuation-free, with scaffolding removed. */
export function normaliseQuery(raw: string): { normalised: string; tokens: string[] } {
  const folded = ` ${foldText(raw)} `;
  let stripped = folded;
  for (const brand of BRAND_TOKENS) {
    stripped = stripped.split(` ${brand} `).join(' ');
  }
  const tokens = stripped
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  return { normalised: tokens.join(' '), tokens };
}

/**
 * Understands a question without touching the database.
 *
 * `vocabulary` is the retrieval vocabulary (index terms + entity aliases). Passing it in — rather
 * than importing a global — is what makes typo correction follow the *indexed content*: publish a
 * page about "Kubernetes" and "kubernets" starts correcting on the next sync, with no code change.
 */
export function understandQuery(
  raw: string,
  options: { vocabulary?: ReadonlySet<string>; previousQuery?: string | null } = {}
): QueryUnderstanding {
  const vocabulary = options.vocabulary ?? new Set<string>();
  const { normalised, tokens } = normaliseQuery(raw);

  const content = tokens.filter((token) => !STOPWORDS.has(token) && !/^\d{1,2}$/.test(token));
  const correctedTokens: string[] = [];
  const corrections: string[] = [];
  for (const token of content) {
    const hasEntityAlias = SERVICE_ENTITIES.some((entity) =>
      entity.aliases.some((alias) => alias === token || alias.split(' ').includes(token))
    );
    if (hasEntityAlias) {
      correctedTokens.push(token);
      continue;
    }
    const corrected = correctToken(token, vocabulary);
    correctedTokens.push(corrected.token);
    if (corrected.corrected) corrections.push(`${token} → ${corrected.token}`);
  }

  // A concatenated word the corpus does not contain is split into the words it is made of, and the
  // parts become the terms that matter (the compound itself stays out of the strict set, because no
  // page will ever contain it).
  const compounds = new Set<string>();
  const expandedTokens: string[] = [];
  for (const token of correctedTokens) {
    const parts = splitCompound(token, vocabulary);
    if (parts) {
      compounds.add(token);
      expandedTokens.push(...parts);
    } else {
      expandedTokens.push(token);
    }
  }

  const expansions = new Set<string>();
  const haystack = content.length > 0 ? content.join(' ') : normalised;
  /**
   * Words the customer used that the platform already knows how to translate ("wp" → WordPress,
   * "cheap" → affordable). They are boosts, never requirements: a page is not wrong for not
   * containing the abbreviation when it contains the word the abbreviation stands for.
   */
  const boosted = new Set<string>();
  for (const expansion of EXPANSIONS) {
    const pattern = new RegExp(expansion.pattern.source, expansion.pattern.flags);
    const matches = haystack.match(pattern);
    if (!matches) continue;
    for (const term of expansion.terms) expansions.add(term);
    // Only a *translation* exempts the customer's word from being required: "wp" → "wordpress"
    // means the page may say either. An expansion that simply restates the word ("cpanel" →
    // "cpanel", "control panel") is adding vocabulary, not excusing the word.
    const restates = (word: string) => expansion.terms.some((term) => term.toLowerCase() === word);
    for (const match of matches) {
      for (const word of match.toLowerCase().split(/\s+/)) {
        if (!restates(word)) boosted.add(word);
      }
    }
  }

  // Entity resolution runs on both the raw and corrected tokens so a typo in an offering name
  // ("vsp hosting") still resolves, and on the expansions so "wp" maps to WordPress.
  const searchSpace = [...new Set([...content, ...correctedTokens, ...expansions])].join(' ');
  // Alias matching is word-boundary based. Substring matching would resolve "hosting" to the
  // "os" (operating systems) alias, which is how an assistant ends up answering a navigation
  // question with a Windows hosting page.
  const hasAlias = (haystack: string, alias: string): boolean => {
    const needle = foldText(alias);
    if (!needle) return false;
    return ` ${haystack} `.includes(` ${needle} `) || haystack === needle;
  };
  // A long specific alias ("wordpress hosting", "vps") outranks a short generic one. Without this,
  // "can I host WordPress" resolves shared-hosting first because it matched "hosting plan"/"web
  // hosting", and the generic product page then outranks the WordPress page it was asking about.
  const specificity = (entity: ServiceEntity): number => {
    const longest = entity.aliases.reduce((best, alias) => Math.max(best, alias.trim().split(/\s+/).length), 1);
    return longest * 2 + Math.min(6, Math.floor(entity.label.length / 4));
  };
  const entities = SERVICE_ENTITIES.map((entity) => {
    let score = 0;
    for (const alias of entity.aliases) {
      const aliasFolded = foldText(alias);
      if (!aliasFolded) continue;
      if (hasAlias(normalised, aliasFolded)) score = Math.max(score, aliasFolded.includes(' ') ? 3 : 2);
      else if (hasAlias(searchSpace, aliasFolded)) score = Math.max(score, 1);
      else if (aliasFolded.length >= 5 && correctedTokens.some((token) => token.length >= 4 && editDistance(token, aliasFolded, 1) <= 1)) {
        // A one-edit misspelling of an offering name still resolves the offering.
        score = Math.max(score, 1);
      }
    }
    return { entity, score };
  })
    .filter((entry) => entry.score > 0)
    // Multi-word aliases (more specific) outrank single words.
    .sort((a, b) => b.score - a.score || specificity(b.entity) - specificity(a.entity) || a.entity.id.localeCompare(b.entity.id))
    .map((entry) => entry.entity);

  // A follow-up inherits its subject. "How much is it?" carries no offering of its own; the previous
  // turn does, and answering the pronoun with an empty entity list is how an assistant ends up
  // pricing nothing. The inherited entity is added *after* the current turn's own matches so a
  // follow-up that introduces a new subject still wins.
  const previous = options.previousQuery ? understandQuery(options.previousQuery, { vocabulary, previousQuery: null }) : null;
  if (previous) {
    for (const inherited of previous.entities) {
      if (!entities.some((entity) => entity.id === inherited.id)) entities.push(inherited);
    }
  }

  // "Where can I manage my hosting / find my invoices / open my dashboard" is a question about the
  // customer area, whatever noun follows it. Resolving the account destination here is what makes
  // the navigation answers point at /account instead of at the product page that happens to contain
  // the same noun.
  if (NAV_PATTERN.test(raw) && /\b(?:my|manage|dashboard|portal|control panel|client area|sign in|log ?in)\b/i.test(raw)) {
    const account = SERVICE_ENTITIES.find((entity) => entity.id === 'account');
    if (account && !entities.some((entity) => entity.id === 'account')) entities.unshift(account);
  }

  /**
   * Words that ask *how* to answer rather than *what* about: "cost", "cheapest", "accept", "speak",
   * "human". They carry no subject matter of their own, so their absence from the corpus is not a
   * coverage gap — "cheapest vps" is about VPS even though the site never writes the word "cheapest".
   * Treating them as gaps would refuse exactly the pricing and escalation questions the assistant
   * must still handle. Subject words like "interstellar" and "travel" are deliberately not here.
   */
  const QUESTION_SCAFFOLDING = new Set([
    'cost', 'costs', 'cheap', 'cheapest', 'cheaper', 'afford', 'affordable', 'budget', 'lowest',
    'price', 'priced', 'quote', 'fee', 'fees', 'charge', 'charged', 'charges', 'exact', 'exactly',
    'accept', 'accepted', 'available', 'offer', 'offers', 'provide', 'provides', 'sell', 'sells',
    'support', 'supported', 'help', 'fast', 'slow', 'quick', 'quickly', 'good', 'best', 'better',
    'speak', 'talk', 'chat', 'human', 'person', 'agent', 'someone', 'anyone', 'team', 'staff',
    'recommend', 'suggest', 'need', 'want', 'looking', 'prefer', 'option', 'options', 'include',
    'included', 'allow', 'allowed', 'possible', 'kind', 'kinds', 'type', 'types', 'sort', 'way',
    'time', 'times', 'long', 'much', 'many', 'year', 'years', 'month', 'months', 'day', 'days',
    'free', 'paid', 'work', 'works', 'working', 'broken', 'stuck', 'wrong', 'issue', 'issues',
    'problem', 'problems', 'error', 'errors', 'fix', 'fixed', 'else', 'other', 'another', 'anything',
  ]);

  const expansionList = [...expansions];
  const ungroundedTokens = content.filter((token) => {
    if (vocabulary.has(token)) return false;
    const corrected = correctedTokens[content.indexOf(token)] ?? token;
    if (corrected !== token) return false;
    if (SERVICE_ENTITIES.some((entity) => entity.aliases.some((alias) => alias.split(' ').includes(token)))) return false;
    // A compound the corpus does not spell as one word ("webhosting" → "web" + "hosting") is
    // covered whenever both halves are known vocabulary. Without this, writing two real words
    // together looked like inventing a third.
    const halves = splitCompound(token, vocabulary);
    if (halves && halves.length > 1 && halves.every((half) => vocabulary.has(half))) return false;
    if (QUESTION_SCAFFOLDING.has(token)) return false;
    // An abbreviation legitimately expands to a word the corpus has ("wp" → "wordpress"); that is
    // coverage, not a gap.
    return !expansionList.some((term) => term.startsWith(token) || token.startsWith(term));
  });

  const isFollowUp = FOLLOW_UP_PATTERN.test(raw) || PRONOUN_ONLY.test(raw) || tokens.length <= 3;
  // `retrievalQueryFor` prepends the previous subject, so a follow-up must be flagged as such even
  // when it inherits entities — otherwise the inherited offering is searched without the words that
  // distinguish "how much is it" from "what is it".
  const inheritsContext = previous !== null && previous.entities.length > 0;
  const isComparison = COMPARISON_PATTERN.test(raw) && (entities.length >= 2 || /\bvs\b|\bversus\b|\bdifference\b/i.test(raw));

  let intent: QuestionIntent = 'general';
  if (ACCOUNT_PATTERN.test(raw)) intent = 'account_specific';
  else if (SUPPORT_PATTERN.test(raw)) intent = 'support_request';
  else if (PRICE_PATTERN.test(raw)) intent = 'pricing';
  else if (isComparison) intent = 'comparison';
  else if (TROUBLE_PATTERN.test(raw) && AVAILABILITY_PATTERN.test(raw) === false && HOW_TO_PATTERN.test(raw) === false) intent = 'troubleshooting';
  else if (HOW_TO_PATTERN.test(raw)) intent = 'how_to';
  else if (DEFINITION_PATTERN.test(raw)) intent = 'definition';
  else if (NAV_PATTERN.test(raw)) intent = 'navigation';
  else if (AVAILABILITY_PATTERN.test(raw)) intent = 'availability';

  return {
    raw,
    normalised,
    tokens: content,
    /**
     * Customer words that exist in neither the corpus vocabulary nor an expansion of one. "weather"
     * lands here; "vsp" does not, because it was corrected to a word the corpus has, and "wp" does
     * not, because it expands to one. This is the signal that the site simply may not cover the
     * subject — which is a different answer from "the page does not mention it".
     */
    ungroundedTokens,
    // Compound splitting happens *before* the expansions so the parts participate in matching and
    // entity resolution; the original compound is not repeated as a strict term because no page will
    // ever contain a word the customer invented by joining two real ones.
    correctedTokens: expandedTokens,
    // The words that must actually appear on a page for it to be the answer: the customer's own
    // words, minus the ones we can translate ourselves. "forecast" stays (the site has no page about
    // forecasting); "wp" and "wordpress" collapse to the one word that matters.
    strictTokens: [...new Set(expandedTokens.filter((token) => !boosted.has(token)))],
    expansions: [...expansions],
    entities,
    corrections: [...corrections],
    intent,
    isComparison,
    isFollowUp: isFollowUp || inheritsContext,
  };
}

/**
 * Builds the retrieval query for a turn. A short follow-up ("what about the price?") inherits the
 * subject of the previous customer turn — this is what makes the documented conversation work:
 *
 *   "Tell me about VPS" → "What about the price?" → "Which is best for a small business?"
 */
export function retrievalQueryFor(understanding: QueryUnderstanding, previousCustomerMessage?: string | null): string {
  const base = [...understanding.correctedTokens, ...understanding.expansions].join(' ');
  if (!understanding.isFollowUp || !previousCustomerMessage) return base || understanding.normalised;
  const previous = understandQuery(previousCustomerMessage);
  const subject = previous.entities[0]?.label ?? previous.correctedTokens.slice(0, 4).join(' ');
  return `${subject} ${base}`.trim();
}

/**
 * Splits a word the corpus does not contain into two corpus words, when it is a plain concatenation.
 *
 * Customers write "webhosting", "wordpresshosting", "dnsmanagement". The index contains "web" and
 * "hosting" separately, so a lexical search for the compound finds nothing at all — the whole
 * question returns zero candidates and the assistant has to say it cannot verify something it
 * absolutely knows. Splitting against the live vocabulary (rather than a hardcoded list) means this
 * works for any future compound the site introduces.
 */
export function splitCompound(token: string, vocabulary: ReadonlySet<string>): string[] | null {
  if (token.length < 6 || vocabulary.has(token)) return null;
  for (let index = 3; index <= token.length - 3; index += 1) {
    const head = token.slice(0, index);
    const tail = token.slice(index);
    if (vocabulary.has(head) && vocabulary.has(tail)) return [head, tail];
  }
  return null;
}

/** A tsquery body that matches any term OR'd together, prefix-matched, safe for `to_tsquery`. */
export function toTsQueryBody(terms: readonly string[]): string {
  const cleaned = terms
    .map((term) => foldText(term).replace(/\s+/g, ' ').trim())
    .filter((term) => term.length >= 2)
    .flatMap((term) => term.split(' '))
    .filter((term) => /^[a-z0-9]+$/.test(term) && term.length >= 2);
  const unique = [...new Set(cleaned)].slice(0, 24);
  if (unique.length === 0) return '';
  return unique.map((term) => `${term}:*`).join(' | ');
}
