/**
 * CloudHost247's embedded support knowledge.
 *
 * This is deliberately a small, reviewable knowledge base rather than a pretend general-purpose
 * model. Every answer is tied to a CloudHost247 page, route, module, or database capability. The
 * operator can answer only when a matching entry exists; everything else is escalated.
 */

export interface SupportKnowledgeEntry {
  id: string;
  intent: string;
  title: string;
  keywords: readonly string[];
  answer: string;
  source: string;
  /** A more specific entry wins over a broad entry when both match. */
  weight?: number;
}

export const CLOUDHOST247_KNOWLEDGE: readonly SupportKnowledgeEntry[] = [
  {
    id: 'domain-dns-management',
    intent: 'domain_dns',
    title: 'Domains and DNS',
    keywords: ['domain', 'dns', 'nameserver', 'name server', 'a record', 'mx record', 'cname', 'txt record'],
    answer:
      'You can manage domains and DNS from the CloudHost247 dashboard. Open Domains, select the domain, then use DNS Management to add or update records. DNS changes can take time to propagate. Use only the record values supplied by the service you are connecting.',
    source: 'CloudHost247 domain and DNS management',
    weight: 20,
  },
  {
    id: 'domain-registration',
    intent: 'domain_registration',
    title: 'Domain registration',
    keywords: ['register a domain', 'domain registration', 'buy a domain', 'new domain', 'domain transfer'],
    answer:
      'CloudHost247 has a domain service area. Current domain products, availability, and published pricing must come from the live CloudHost247 catalog; I will not invent a registrar result or price. Human support can help with a domain-specific request.',
    source: 'CloudHost247 domain service catalog and domain marketing page',
    weight: 24,
  },
  {
    id: 'hosting-catalog',
    intent: 'hosting',
    title: 'Hosting products',
    keywords: ['web hosting', 'wordpress hosting', 'wordpress', 'cpanel', 'plesk', 'control panel', 'hosting plan', 'website deployment'],
    answer:
      'CloudHost247 provides hosting products through its live service catalog, including web hosting, WordPress hosting, and control-panel based hosting where configured. Current plans, published prices, and features are shown on the relevant CloudHost247 product page; I will not quote an unpublished or unavailable plan.',
    source: 'CloudHost247 hosting catalog and hosting pages',
    weight: 18,
  },
  {
    id: 'cloud-vps-dedicated',
    intent: 'servers',
    title: 'Cloud, VPS, and dedicated servers',
    keywords: ['vps', 'cloud server', 'cloud hosting', 'dedicated server', 'server hosting', 'virtual private server'],
    answer:
      'CloudHost247 server products are managed from the server dashboard. The provider, region, operating system, control panel, and available actions depend on the exact configured product. I can explain the dashboard workflow, but I cannot claim a server is available, healthy, restored, or provisioned without verified account or provider data.',
    source: 'CloudHost247 server catalog and server management workflow',
    weight: 20,
  },
  {
    id: 'server-management',
    intent: 'server_management',
    title: 'Server management',
    keywords: ['reinstall', 'reboot', 'restart server', 'shutdown', 'console', 'snapshot', 'firewall rule', 'server dashboard'],
    answer:
      'Supported server actions are shown by the CloudHost247 server dashboard for the configured provider. Reinstalling an operating system is destructive and requires explicit confirmation. I cannot report a customer server status or promise an operation completion time without verified live data.',
    source: 'CloudHost247 server operations and provisioning rules',
    weight: 24,
  },
  {
    id: 'rdp',
    intent: 'rdp',
    title: 'RDP',
    keywords: ['rdp', 'remote desktop', 'windows remote desktop'],
    answer:
      'RDP is a CloudHost247 service area. Current availability, plan details, credentials, and connection information are account-specific or catalog-controlled. I will not invent a server address, password, plan, or availability; support can help with a specific RDP service.',
    source: 'CloudHost247 RDP service module',
    weight: 24,
  },
  {
    id: 'email-smtp',
    intent: 'email',
    title: 'Business email and SMTP',
    keywords: ['business email', 'email hosting', 'mailbox', 'smtp', 'smtp hosting', 'mail delivery'],
    answer:
      'CloudHost247 email and SMTP services are listed in the CloudHost247 service catalog. For mailbox access, delivery, credentials, or account-specific sending problems, I should transfer you to support rather than guess.',
    source: 'CloudHost247 email hosting and SMTP service modules',
    weight: 22,
  },
  {
    id: 'ssl',
    intent: 'ssl',
    title: 'SSL certificates',
    keywords: ['ssl', 'ssl certificate', 'tls', 'https', 'certificate'],
    answer:
      'SSL certificates and their status are managed from the SSL area of the CloudHost247 dashboard. Certificate availability and validation depend on the selected service and domain configuration. I cannot confirm a certificate has been issued without verified account data.',
    source: 'CloudHost247 SSL management workflow',
    weight: 20,
  },
  {
    id: 'billing-renewals',
    intent: 'billing',
    title: 'Billing and renewals',
    keywords: ['billing', 'invoice', 'renewal', 'renew', 'payment method', 'pay invoice', 'subscription'],
    answer:
      'Invoices, payments, and renewal details are available in the authenticated CloudHost247 Billing area. I cannot infer an individual payment, balance, renewal, refund, or suspension status from chat; account-specific billing questions require support.',
    source: 'CloudHost247 billing and invoice workflow',
    weight: 18,
  },
  {
    id: 'support-tickets',
    intent: 'support',
    title: 'Support tickets',
    keywords: ['support ticket', 'ticket', 'help desk', 'contact support', 'support portal'],
    answer:
      'Authenticated customers can open and track support tickets from the CloudHost247 Support area. I can also transfer this conversation to the support queue while preserving the conversation history.',
    source: 'CloudHost247 support ticket workflow',
    weight: 16,
  },
  {
    id: 'backup-troubleshooting',
    intent: 'backup_troubleshooting',
    title: 'Backups and restoration',
    keywords: ['backup', 'restore', 'restoration', 'recover data', 'troubleshooting'],
    answer:
      'CloudHost247 backup coverage depends on the service and plan. The Backup Policy is the source of truth. For a restoration request, submit a CloudHost247 support ticket with the affected service and the approximate date of the data needed; I cannot promise a restoration time or outcome.',
    source: 'CloudHost247 Backup Policy and support workflow',
    weight: 20,
  },
  {
    id: 'contact-information',
    intent: 'contact',
    title: 'Contact CloudHost247',
    keywords: ['contact cloudhost247', 'contact information', 'how do i contact', 'support email'],
    answer:
      'You can contact CloudHost247 through the Support area and support ticket workflow. For an account-specific issue, this conversation can be transferred so the support team receives the full transcript instead of asking you to repeat it.',
    source: 'CloudHost247 contact and support pages',
    weight: 18,
  },
  {
    id: 'proxy-services',
    intent: 'proxy',
    title: 'Proxy services',
    keywords: ['proxy', 'proxies', 'proxy service'],
    answer:
      'Proxy services are part of the CloudHost247 service catalog. I can only confirm current plans, pricing, and availability from the live catalog. A service-specific or account-specific proxy request should go to CloudHost247 Support.',
    source: 'CloudHost247 LTE proxy service module',
    weight: 22,
  },
  {
    id: 'phone-sms-otp',
    intent: 'phone_services',
    title: 'Virtual numbers, OTP, and SMS',
    keywords: ['virtual number', 'phone number', 'otp', 'sms', 'text message', 'voip', 'esim'],
    answer:
      'CloudHost247 includes phone and messaging service modules for numbers, SMS, OTP, VoIP, and eSIM where configured. The exact country, number, delivery, and pricing are service-specific and must be checked in the live catalog or with support.',
    source: 'CloudHost247 phone services modules',
    weight: 22,
  },
  {
    id: 'smm',
    intent: 'smm',
    title: 'SMM services',
    keywords: ['smm', 'social media marketing', 'social media service'],
    answer:
      'SMM services are represented by a CloudHost247 service module. Current service details and availability are catalog-controlled. I will not invent delivery quantities, timing, or guarantees; support can review a specific order.',
    source: 'CloudHost247 SMM service module',
    weight: 22,
  },
  {
    id: 'account-management',
    intent: 'account_management',
    title: 'Account management',
    keywords: ['change my name', 'account settings', 'profile', 'my account', 'sign in', 'login'],
    answer:
      'You can manage your CloudHost247 profile from Account and use the authenticated dashboard for services, domains, DNS, SSL, billing, and support. I cannot expose credentials, tokens, passwords, or another customer’s information.',
    source: 'CloudHost247 account and authorization workflow',
    weight: 12,
  },
] as const;

const normalized = (value: string): string => value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();

/** Deterministic retrieval: all terms in an entry are plain, inspectable application data. */
export function retrieveKnowledge(message: string): SupportKnowledgeEntry | null {
  const text = normalized(message);
  const matches = CLOUDHOST247_KNOWLEDGE
    .map((entry) => ({
      entry,
      score: entry.keywords.reduce((score, keyword) => score + (text.includes(normalized(keyword)) ? 1 : 0), 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return (right.entry.weight ?? 0) - (left.entry.weight ?? 0);
    });

  return matches[0]?.entry ?? null;
}

export function listKnowledgeEntries(): SupportKnowledgeEntry[] {
  return [...CLOUDHOST247_KNOWLEDGE];
}
