/**
 * Tools Center — SPA API client and the per-tool input schemas.
 *
 * Every call goes through `apiFetch`, so the platform's existing session handling (token header,
 * 401 → session clear) applies unchanged. The tool execution call returns the server envelope
 * *as-is*: the UI renders `success: false` with the server's code/message instead of flattening it
 * into a generic error, because "CONFIGURATION_REQUIRED" and "RATE_LIMITED" need different advice.
 */
import { apiFetch, ApiRequestError } from './api';

export type ToolStatus = 'ACTIVE' | 'DISABLED' | 'MAINTENANCE' | 'CONFIGURATION_REQUIRED' | 'SERVICE_UNAVAILABLE';

export interface ToolSummary {
  legacyPaths?: string[];
  discoveryCategories?: string[];
  seoTitle?: string;
  relatedTools?: string[];
  resultMode?: string;
  visibility?: string;
  slug: string;
  name: string;
  category: string;
  summary: string;
  description: string;
  icon: string;
  path: string;
  apiPath: string;
  authRequired: boolean;
  status: ToolStatus;
  statusMessage: string | null;
  providerKind: string | null;
  requiresOwnership: boolean;
  cacheSeconds: number;
  keywords: string[];
  notes: string[];
  favorite?: boolean;
  runs?: number;
  lastUsedAt?: string;
}

export interface ToolSuccess<T> {
  success: true;
  tool: string;
  status: 'ACTIVE';
  generatedAt: string;
  data: T;
  meta: { durationMs: number; cached: boolean; sources: string[]; warnings: string[]; historyId?: string };
}

export interface ToolFailure {
  success: false;
  code: string;
  message: string;
  retryable: boolean;
  tool?: string;
  detail?: Record<string, unknown>;
}

export type ToolEnvelope<T> = ToolSuccess<T> | ToolFailure;

export interface ToolCategory {
  slug: string;
  label: string;
  toolCount: number;
}

export interface ToolsDashboard {
  success: true;
  generatedAt: string;
  masterEnabled: boolean;
  anonymousAccess: boolean;
  /** Set when the platform database is unreachable: usage panels are empty and tools cannot run. */
  degraded?: boolean;
  degradedReason?: string | null;
  signedIn: boolean;
  categories: ToolCategory[];
  popular: ToolSummary[];
  recent: ToolSummary[];
  favorites: ToolSummary[];
  statusSummary: Record<string, number>;
}

export interface ToolExplanation {
  headline: string;
  whatThisMeans: string[];
  whatToCheckNext: string[];
  limitations: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  derivedFrom: string[];
  note: string;
}

/** Field metadata drives the generated input form on the tool page. */
export interface ToolField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'textarea' | 'checkbox' | 'time-list';
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  defaultValue?: string | number | boolean;
  /** Only rendered when another field has one of these values. */
  showWhen?: { field: string; equals: string[] };
}

export interface ToolForm {
  fields: ToolField[];
  /** POST is the default; GET tools are read-only lookups that work from the URL. */
  method?: 'GET' | 'POST';
  /** Rendered above the form; explains what the tool does and does not do. */
  intro?: string;
}

const select = (name: string, label: string, options: string[], extra: Partial<ToolField> = {}): ToolField => ({
  name,
  label,
  type: 'select',
  options: options.map((value) => ({ value, label: value })),
  ...extra,
});

/**
 * Per-tool input schemas. Tools without an entry fall back to a free-form JSON editor, which is
 * always available anyway under "Advanced input".
 */
export const TOOL_FORMS: Record<string, ToolForm> = {
  'dns-propagation': { method: 'POST', fields: [ { name: 'domain', label: 'Domain', type: 'text', required: true, placeholder: 'example.com' }, select('type', 'Record type', ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA'], { defaultValue: 'A' }), { name: 'expected', label: 'Expected value (optional)', type: 'text', help: 'Propagation compares each resolver answer with this value.' } ] },
  'dns-lookup': { method: 'GET', fields: [ { name: 'name', label: 'Domain or hostname', type: 'text', required: true, placeholder: 'example.com' }, select('type', 'Record type', ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA', 'SRV', 'PTR'], { defaultValue: 'A' }), { name: 'dnssec', label: 'Request DNSSEC records (DO bit)', type: 'checkbox' } ] },
  'dns-health': { method: 'POST', fields: [ { name: 'domain', label: 'Domain', type: 'text', required: true }, { name: 'selectors', label: 'DKIM selectors (comma separated)', type: 'text', help: 'Leave empty to try the common selectors and report which exist.' }, { name: 'extended', label: 'Include BIMI and DNSSEC checks', type: 'checkbox', defaultValue: true } ] },
  'mx-lookup': { method: 'GET', fields: [ { name: 'domain', label: 'Domain', type: 'text', required: true }, { name: 'checkPort25', label: 'Test port 25 reachability (slow, often blocked)', type: 'checkbox' } ] },
  'spf-checker': { method: 'GET', fields: [ { name: 'domain', label: 'Domain', type: 'text', required: true } ] },
  'dmarc-checker': { method: 'GET', fields: [ { name: 'domain', label: 'Domain', type: 'text', required: true } ] },
  'dmarc-generator': { method: 'POST', fields: [ { name: 'domain', label: 'Domain', type: 'text', required: true }, select('policy', 'Policy', ['none', 'quarantine', 'reject'], { defaultValue: 'none' }), select('subdomainPolicy', 'Subdomain policy', ['', 'none', 'quarantine', 'reject'], { defaultValue: '' }), { name: 'percentage', label: 'Percentage', type: 'number', min: 0, max: 100, defaultValue: 100 }, { name: 'rua', label: 'Aggregate report address', type: 'text', placeholder: 'mailto:dmarc@example.com' }, { name: 'ruf', label: 'Forensic report address', type: 'text', placeholder: 'mailto:dmarc@example.com' }, select('adkim', 'DKIM alignment', ['', 'r', 's'], { defaultValue: 'r' }), select('aspf', 'SPF alignment', ['', 'r', 's'], { defaultValue: 'r' }) ] },
  'dkim-checker': { method: 'POST', fields: [ { name: 'domain', label: 'Domain', type: 'text', required: true }, { name: 'selectors', label: 'Selectors (comma separated)', type: 'text', help: 'Press Run with this empty to test the common selectors.' } ] },
  'bimi-checker': { method: 'GET', fields: [ { name: 'domain', label: 'Domain', type: 'text', required: true } ] },
  'dnskey-lookup': { method: 'GET', fields: [ { name: 'domain', label: 'Domain', type: 'text', required: true } ] },
  'ds-lookup': { method: 'GET', fields: [ { name: 'domain', label: 'Domain', type: 'text', required: true } ] },
  'reverse-dns': { method: 'GET', fields: [ { name: 'address', label: 'IP address', type: 'text', required: true, placeholder: '1.1.1.1' } ] },
  'reverse-ip': { method: 'GET', fields: [ { name: 'address', label: 'IP address', type: 'text', required: true }, { name: 'refresh', label: 'Bypass the cache', type: 'checkbox' } ] },

  'ip-lookup': { method: 'GET', fields: [ { name: 'address', label: 'IP address', type: 'text', required: true }, { name: 'includeReverse', label: 'Include reverse DNS', type: 'checkbox', defaultValue: true } ] },
  'my-ip': { method: 'GET', fields: [], intro: 'Reports the address this platform’s edge observed for your connection, plus the headers your browser sent.' },
  'ip-whois': { method: 'GET', fields: [ { name: 'address', label: 'IP address', type: 'text', required: true } ] },
  'domain-to-ip': { method: 'GET', fields: [ { name: 'domain', label: 'Domain', type: 'text', required: true } ] },
  'ip-to-hostname': { method: 'GET', fields: [ { name: 'address', label: 'IP address', type: 'text', required: true } ] },
  'isp-lookup': { method: 'GET', fields: [ { name: 'address', label: 'IP address', type: 'text', required: true } ] },
  'ip-converters': { method: 'POST', fields: [ select('mode', 'Conversion', ['ipv4-to-decimal', 'decimal-to-ipv4', 'ipv6-to-decimal', 'decimal-to-ipv6', 'ipv4-to-ipv6', 'ipv6-to-ipv4', 'expand-ipv6', 'compress-ipv6', 'cidr-to-range', 'range-to-cidr'], { required: true, defaultValue: 'ipv4-to-decimal' }), { name: 'value', label: 'Value', type: 'text', required: true, help: 'For range-to-cidr, enter "start end".' } ] },

  'subnet-calculator': { method: 'POST', fields: [ { name: 'cidr', label: 'Subnet (address/prefix)', type: 'text', required: true, placeholder: '192.168.1.0/24' }, { name: 'newPrefixLength', label: 'Split into /prefix (optional)', type: 'number', min: 1, max: 128 } ] },
  ping: { method: 'POST', fields: [ { name: 'target', label: 'Hostname or IP', type: 'text', required: true }, { name: 'count', label: 'Probes', type: 'number', min: 1, max: 10, defaultValue: 4 }, { name: 'forceTcp', label: 'Force TCP mode', type: 'checkbox', help: 'ICMP is used when the deployment allows it; TCP timing is always available.' } ] },
  traceroute: { method: 'POST', fields: [ { name: 'target', label: 'Hostname or IP', type: 'text', required: true }, { name: 'maxHops', label: 'Maximum hops', type: 'number', min: 1, max: 30, defaultValue: 20 } ] },
  'port-checker': { method: 'POST', fields: [ { name: 'host', label: 'Host', type: 'text', required: true }, { name: 'ports', label: 'Ports (comma or space separated, max 20)', type: 'text', placeholder: '22, 80, 443' } ] },
  'mac-lookup': { method: 'GET', fields: [ { name: 'mac', label: 'MAC address', type: 'text', required: true, placeholder: '00:1A:2B:3C:4D:5E' } ] },
  'mac-generator': { method: 'POST', fields: [ { name: 'count', label: 'How many', type: 'number', min: 1, max: 20, defaultValue: 5 }, select('mode', 'Kind', ['random', 'locally-administered', 'universally-administered'], { defaultValue: 'locally-administered' }) ] },
  'asn-whois': { method: 'POST', fields: [ { name: 'asn', label: 'ASN', type: 'text', placeholder: 'AS15169' }, { name: 'address', label: '…or an IP address', type: 'text', help: 'The origin AS is looked up with a keyless DNS query (Team Cymru), then described via RDAP.' } ] },
  'speed-test': { method: 'POST', fields: [ { name: 'measureServerEgress', label: 'Also measure the server’s own egress (needs a provider)', type: 'checkbox' } ] },

  'http-headers': { method: 'POST', fields: [ { name: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://example.com/' }, select('method', 'Method', ['GET', 'HEAD'], { defaultValue: 'GET' }), { name: 'userAgent', label: 'Override User-Agent', type: 'text' } ] },
  'server-os': { method: 'POST', fields: [ { name: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://example.com/' } ] },
  'smtp-tester': { method: 'POST', fields: [ { name: 'target', label: 'Domain or e-mail address', type: 'text', required: true }, { name: 'port', label: 'Port', type: 'number', min: 1, max: 65535, defaultValue: 25 }, { name: 'recipient', label: 'Recipient to probe (optional)', type: 'text', help: 'Sends RCPT TO with an empty MAIL FROM. Only do this for mailboxes you are authorised to test.' }, { name: 'acknowledgeRecipientCheck', label: 'I am authorised to probe that recipient', type: 'checkbox' } ] },
  'email-header': { method: 'POST', fields: [ { name: 'headers', label: 'Raw message headers', type: 'textarea', required: true, placeholder: 'Paste the full headers (View → Show original).' } ] },
  'json-tools': { method: 'POST', fields: [ select('operation', 'Operation', ['validate', 'format', 'minify', 'query', 'to-csv', 'from-csv', 'diff'], { required: true, defaultValue: 'format' }), { name: 'text', label: 'JSON or CSV input', type: 'textarea', required: true }, { name: 'path', label: 'JSONPath (for query)', type: 'text', placeholder: '$.items[0].name' }, { name: 'before', label: 'Before (for diff)', type: 'textarea' }, { name: 'after', label: 'After (for diff)', type: 'textarea' }, { name: 'sortKeys', label: 'Sort keys', type: 'checkbox' } ] },
  'encoding-tools': { method: 'POST', fields: [ select('format', 'Format', ['base64', 'base64url', 'hex', 'url', 'html', 'unicode-escape', 'binary', 'rot13', 'rot47'], { required: true, defaultValue: 'base64' }), select('mode', 'Mode', ['encode', 'decode'], { defaultValue: 'encode' }), { name: 'text', label: 'Text', type: 'textarea', required: true }, { name: 'token', label: '…or inspect a JWT', type: 'text', help: 'A JWT is decoded locally; the signature is NOT verified (that needs the issuer’s key).' } ] },
  'url-tools': { method: 'POST', fields: [ select('operation', 'Operation', ['components', 'parameters', 'resolve', 'campaign', 'strip-tracking', 'compare'], { required: true, defaultValue: 'components' }), { name: 'url', label: 'URL', type: 'text', required: true }, { name: 'base', label: 'Base URL (for resolve)', type: 'text' }, { name: 'relative', label: 'Relative URL (for resolve)', type: 'text' }, { name: 'source', label: 'utm_source', type: 'text' }, { name: 'medium', label: 'utm_medium', type: 'text' }, { name: 'campaign', label: 'utm_campaign', type: 'text' }, { name: 'first', label: 'First URL (for compare)', type: 'text' }, { name: 'second', label: 'Second URL (for compare)', type: 'text' } ] },
  'mrz-generator': { method: 'POST', intro: 'Generates, validates and parses ICAO Doc 9303 TD3 machine-readable zones. The page at /tools/mrz-generator runs this in your browser; the API processes the values in memory for one request and never caches, logs or stores them.', fields: [ select('mode', 'Mode', ['generate', 'validate', 'parse'], { required: true, defaultValue: 'generate' }), { name: 'mrz', label: 'MRZ (two lines, for validate/parse)', type: 'textarea', placeholder: 'Two 44-character lines, e.g. from the tool page\u2019s Generate Test Data button' }, { name: 'issuingState', label: 'Issuing state (3 letters)', type: 'text', placeholder: 'UTO' }, { name: 'surname', label: 'Surname', type: 'text', placeholder: 'SURNAME' }, { name: 'givenNames', label: 'Given names', type: 'text', placeholder: 'GIVEN NAMES' }, { name: 'nationality', label: 'Nationality (3 letters)', type: 'text', placeholder: 'UTO' }, { name: 'documentNumber', label: 'Document number', type: 'text', placeholder: 'AB1234567' }, { name: 'dateOfBirth', label: 'Date of birth (YYMMDD)', type: 'text', placeholder: 'YYMMDD' }, { name: 'sex', label: 'Sex', type: 'text', placeholder: 'F' }, { name: 'expiryDate', label: 'Expiry date (YYMMDD)', type: 'text', placeholder: 'YYMMDD' }, { name: 'optionalData', label: 'Optional data', type: 'text', placeholder: 'OPTIONAL' } ] },
  'user-agent': { method: 'POST', fields: [ { name: 'userAgent', label: 'User-Agent string', type: 'text', help: 'Leave empty and enable the option below to parse your own browser’s user-agent.' }, { name: 'fromRequest', label: 'Parse my browser’s user-agent', type: 'checkbox', defaultValue: true } ] },

  'broken-links': { method: 'POST', fields: [ { name: 'url', label: 'Page URL', type: 'text', required: true }, { name: 'maxLinks', label: 'Maximum links to check', type: 'number', min: 1, max: 100, defaultValue: 40 }, { name: 'includeExternal', label: 'Also check external links', type: 'checkbox', defaultValue: true } ] },
  'open-graph': { method: 'POST', fields: [ { name: 'url', label: 'Page URL', type: 'text', required: true } ] },
  'robots-generator': { method: 'POST', fields: [ select('mode', 'Template', ['block-all', 'allow-all', 'block-ai', 'allow-search-engines', 'custom'], { defaultValue: 'allow-search-engines' }), { name: 'host', label: 'Host', type: 'text', placeholder: 'https://example.com' }, { name: 'sitemaps', label: 'Sitemap URLs (comma separated)', type: 'text' }, { name: 'disallowPaths', label: 'Disallow paths (comma separated)', type: 'text' }, { name: 'allowPaths', label: 'Allow paths (comma separated)', type: 'text' }, { name: 'text', label: '…or paste a robots.txt to analyse', type: 'textarea' } ] },
  'serp-simulator': { method: 'POST', fields: [ { name: 'url', label: 'URL', type: 'text', required: true }, { name: 'title', label: 'Title tag', type: 'text' }, { name: 'description', label: 'Meta description', type: 'textarea' }, { name: 'breadcrumb', label: 'Breadcrumb', type: 'text' }, { name: 'siteName', label: 'Site name', type: 'text' }, select('device', 'Device', ['desktop', 'mobile'], { defaultValue: 'desktop' }), { name: 'html', label: '…or paste page HTML for a meta-tag audit', type: 'textarea' } ] },

  'ssl-checker': { method: 'POST', fields: [ { name: 'host', label: 'Hostname', type: 'text', required: true, placeholder: 'example.com' }, { name: 'port', label: 'Port', type: 'number', min: 1, max: 65535, defaultValue: 443 }, { name: 'skipProtocolProbe', label: 'Skip the protocol probes (faster)', type: 'checkbox' } ] },
  'ip-blacklist': { method: 'POST', fields: [ { name: 'address', label: 'IP address', type: 'text', required: true } ] },
  'password-tools': { method: 'POST', fields: [ select('operation', 'Operation', ['generate', 'score', 'hash'], { required: true, defaultValue: 'generate' }), { name: 'length', label: 'Length (generate)', type: 'number', min: 4, max: 256, defaultValue: 20 }, select('preset', 'Preset (generate)', ['strong', 'pin', 'memorable', 'maximum'], { defaultValue: 'strong' }), { name: 'password', label: 'Password to score', type: 'text' }, { name: 'value', label: 'Value to hash', type: 'textarea' }, select('algorithm', 'Hash algorithm', ['sha256', 'sha1', 'sha512', 'md5'], { defaultValue: 'sha256' }) ] },
  'bin-checker': { method: 'POST', fields: [ { name: 'bin', label: 'BIN / IIN (6–8 digits)', type: 'text', required: true, placeholder: '424242' } ] },

  punycode: { method: 'POST', fields: [ { name: 'domain', label: 'Domain', type: 'text', required: true, placeholder: 'münchen.de' }, select('mode', 'Direction', ['to-ascii', 'to-unicode'], { defaultValue: 'to-ascii' }) ] },
  'domain-availability': { method: 'POST', fields: [ { name: 'domain', label: 'Domain', type: 'text', placeholder: 'example.com' }, { name: 'domains', label: '…or several (comma separated, max 10)', type: 'text' } ] },
  'domain-health': { method: 'POST', fields: [ { name: 'domain', label: 'Domain', type: 'text', required: true }, { name: 'selectors', label: 'DKIM selectors (optional)', type: 'text' }, { name: 'extended', label: 'Include BIMI and DNSSEC', type: 'checkbox', defaultValue: true } ] },

  'word-counter': { method: 'POST', fields: [ { name: 'text', label: 'Text', type: 'textarea', required: true } ] },
  'lorem-ipsum': { method: 'POST', fields: [ { name: 'paragraphs', label: 'Paragraphs', type: 'number', min: 1, max: 50, defaultValue: 3 }, { name: 'format', label: 'Format', type: 'select', options: [ { value: 'plain', label: 'plain' }, { value: 'html', label: 'html' } ], defaultValue: 'plain' }, { name: 'startWithLorem', label: 'Start with “Lorem ipsum…”', type: 'checkbox', defaultValue: true } ] },
  notepad: { method: 'POST', fields: [ { name: 'text', label: 'Text', type: 'textarea', required: true }, { name: 'operations', label: 'Operations (comma separated)', type: 'text', placeholder: 'trim-lines, dedupe-lines, upper' }, { name: 'find', label: 'Find', type: 'text' }, { name: 'replace', label: 'Replace with', type: 'text' } ] },
  'small-text': { method: 'POST', fields: [ { name: 'text', label: 'Text', type: 'textarea', required: true }, select('style', 'Style', ['superscript', 'subscript', 'small-caps', 'wide', 'mirror'], { defaultValue: 'superscript' }) ] },
  'invisible-character': { method: 'POST', fields: [ { name: 'text', label: 'Text to inspect', type: 'textarea' }, { name: 'clean', label: 'Remove invisible characters', type: 'checkbox' } ] },
  'runic-translator': { method: 'POST', fields: [ { name: 'text', label: 'Text', type: 'textarea', required: true }, select('direction', 'Direction', ['to-runes', 'to-latin'], { defaultValue: 'to-runes' }) ] },
  'qr-generator': { method: 'POST', fields: [ { name: 'content', label: 'Content', type: 'textarea', required: true }, select('format', 'Format', ['png', 'svg'], { defaultValue: 'png' }), select('errorCorrectionLevel', 'Error correction', ['L', 'M', 'Q', 'H'], { defaultValue: 'M' }), { name: 'size', label: 'Size (px)', type: 'number', min: 64, max: 2048, defaultValue: 512 } ] },
  'qr-scanner': { method: 'POST', fields: [ { name: 'image', label: 'Image as base64 data URL', type: 'textarea', required: true, help: 'Decoded locally; the QR content is never visited.' } ] },
  'wifi-qr': { method: 'POST', fields: [ { name: 'ssid', label: 'Network name (SSID)', type: 'text', required: true }, { name: 'password', label: 'Password', type: 'text' }, select('security', 'Security', ['WPA', 'WEP', 'nopass'], { defaultValue: 'WPA' }), { name: 'hidden', label: 'Hidden network', type: 'checkbox' } ] },
  'time-card': { method: 'POST', fields: [ { name: 'entries', label: 'Clock-in/out pairs (one per line: HH:MM HH:MM)', type: 'textarea', required: true, placeholder: '09:00 17:30\n09:15 17:45' }, { name: 'defaultBreakMinutes', label: 'Break per day (minutes)', type: 'number', min: 0, max: 720, defaultValue: 30 }, { name: 'weeklyOvertimeAfterMinutes', label: 'Weekly overtime after (minutes)', type: 'number', min: 0, max: 10080, defaultValue: 2400 }, { name: 'hourlyRate', label: 'Hourly rate (optional)', type: 'number', min: 0 } ] },
  'color-tools': { method: 'POST', fields: [ select('operation', 'Operation', ['convert', 'contrast', 'palette', 'color-blindness'], { defaultValue: 'convert' }), { name: 'color', label: 'Colour', type: 'text', placeholder: '#3366CC' }, { name: 'foreground', label: 'Foreground (contrast)', type: 'text' }, { name: 'background', label: 'Background (contrast)', type: 'text' }, select('kind', 'Palette kind', ['complementary', 'analogous', 'triadic', 'split-complementary', 'tetradic', 'monochromatic', 'shades', 'tints'], { defaultValue: 'complementary' }) ] },
  'image-ocr': { method: 'POST', fields: [ { name: 'image', label: 'Image as base64 data URL', type: 'textarea', required: true }, { name: 'language', label: 'Language hint', type: 'text', placeholder: 'eng' } ] },
  'reverse-image-search': { method: 'POST', fields: [ { name: 'image', label: 'Image as base64 data URL', type: 'textarea', required: true } ] },
};

export function toolForm(slug: string): ToolForm {
  if (['nameserver-lookup', 'cname-lookup', 'whois'].includes(slug)) return { method: 'GET', fields: [{ name: 'domain', label: 'Domain', type: 'text', required: true, placeholder: 'example.com' }] };
  if (slug === 'uuid-generator') return { fields: [{ name: 'count', label: 'Number of identifiers', type: 'number', min: 1, max: 50, defaultValue: 1 }] };
  return TOOL_FORMS[slug] ?? { method: 'POST', fields: [] };
}

/** Converts form values (all strings) into the JSON body the API expects. */
export function buildToolInput(slug: string, values: Record<string, string | boolean>): Record<string, unknown> {
  const form = toolForm(slug);
  const input: Record<string, unknown> = {};
  for (const field of form.fields) {
    const value = values[field.name];
    if (value === undefined || value === '' || value === false) continue;
    if (field.name === 'entries' && typeof value === 'string') {
      const entries = value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [clockIn, clockOut] = line.split(/[\s,]+/);
          return { clockIn: clockIn ?? '', clockOut: clockOut ?? '' };
        });
      input.entries = entries;
      continue;
    }
    if (field.name === 'selectors' && typeof value === 'string') {
      input.selectors = value.split(/[\s,;]+/).filter(Boolean);
      continue;
    }
    if (field.name === 'operations' && typeof value === 'string') {
      input.operations = value.split(/[\s,;]+/).filter(Boolean);
      continue;
    }
    if (field.name === 'domains' && typeof value === 'string') {
      input.domains = value.split(/[\s,;]+/).filter(Boolean);
      continue;
    }
    if (field.name === 'ports' && typeof value === 'string') {
      input.ports = value.split(/[\s,;]+/).filter(Boolean);
      continue;
    }
    if (field.name === 'sitemaps' || field.name === 'disallowPaths' || field.name === 'allowPaths' || field.name === 'testPaths') {
      if (typeof value === 'string') input[field.name] = value.split(/[\s,;]+/).filter(Boolean);
      continue;
    }
    if (field.type === 'number' && typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) input[field.name] = parsed;
      continue;
    }
    input[field.name] = value;
  }
  return input;
}

// --- API calls ---------------------------------------------------------------------------------

export const toolsApi = {
  catalog: (category?: string) =>
    apiFetch<{
      success: true;
      categories: ToolCategory[];
      discoveryCategories?: ToolCategory[];
      tools: ToolSummary[];
      count: number;
      masterEnabled: boolean;
      anonymousAccess: boolean;
      /** True when operator policy could not be read (platform database unreachable). The
       *  catalogue is still complete and every tool is reported SERVICE_UNAVAILABLE. */
      degraded?: boolean;
      degradedReason?: string | null;
    }>(`/api/tools/catalog${category ? `?category=${encodeURIComponent(category)}` : ''}`),
  dashboard: () => apiFetch<ToolsDashboard>('/api/tools/dashboard'),
  run: async <T>(slug: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolEnvelope<T>> => {
    try { return await apiFetch<ToolEnvelope<T>>(`/api/tools/${encodeURIComponent(slug)}`, { method: 'POST', body: JSON.stringify(input), signal }); }
    catch (error) {
      if (error instanceof ApiRequestError) return { success: false, tool: slug, code: error.code, message: error.message, retryable: error.retryable ?? (error.status >= 500 || error.status === 429) };
      throw error;
    }
  },
  explain: <T>(slug: string, input: Record<string, unknown>) => apiFetch<{ success: true; explanation: ToolExplanation; data: T }>(`/api/tools/${encodeURIComponent(slug)}/explain`, { method: 'POST', body: JSON.stringify(input) }),
  saveReport: <T>(slug: string, input: Record<string, unknown>) => apiFetch<{ success: true; report: { id: string; target: string; created_at: string } }>(`/api/tools/${encodeURIComponent(slug)}/report`, { method: 'POST', body: JSON.stringify(input) }),
  openTicket: <T>(slug: string, input: Record<string, unknown>, note?: string) => apiFetch<{ success: true; ticket: { id: string; subject: string } }>(`/api/tools/${encodeURIComponent(slug)}/ticket`, { method: 'POST', body: JSON.stringify({ ...input, ...(note ? { note } : {}) }) }),
  history: (params: { limit?: number; offset?: number; tool?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));
    if (params.tool) query.set('tool', params.tool);
    return apiFetch<{ entries: HistoryEntry[]; total: number }>(`/api/tools/history?${query.toString()}`);
  },
  clearHistory: (id?: string) => apiFetch<{ removed: number }>(id ? `/api/tools/history/${id}` : '/api/tools/history', { method: 'DELETE' }),
  favorites: () => apiFetch<{ favorites: ToolSummary[] }>('/api/tools/favorites'),
  addFavorite: (slug: string) => apiFetch<{ created: boolean }>('/api/tools/favorites', { method: 'POST', body: JSON.stringify({ slug }) }),
  removeFavorite: (slug: string) => apiFetch<{ removed: boolean }>(`/api/tools/favorites/${encodeURIComponent(slug)}`, { method: 'DELETE' }),
  reports: () => apiFetch<{ reports: ReportEntry[]; total: number }>('/api/tools/reports'),
  deleteReport: (id: string) => apiFetch<{ deleted: boolean }>(`/api/tools/reports/${id}`, { method: 'DELETE' }),
  monitors: () => apiFetch<{ monitors: MonitorEntry[]; events: MonitorEvent[] }>('/api/tools/monitors'),
  createMonitor: (input: { kind: string; target: string; recordType?: string; expectedValue?: string; matchMode?: string }) => apiFetch<{ monitor: MonitorEntry }>('/api/tools/monitors', { method: 'POST', body: JSON.stringify(input) }),
  updateMonitor: (id: string, patch: { enabled?: boolean; expectedValue?: string | null; matchMode?: string }) => apiFetch<{ monitor: MonitorEntry }>(`/api/tools/monitors/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteMonitor: (id: string) => apiFetch<{ deleted: boolean }>(`/api/tools/monitors/${id}`, { method: 'DELETE' }),
  checkMonitor: (id: string) => apiFetch<{ evaluation: { status: string; detail: string }; notification: { title: string; delivered: boolean } | null }>(`/api/tools/monitors/${id}/check`, { method: 'POST' }),
  domainHealth: (domain: string) => apiFetch<ToolEnvelope<DomainHealthResult>>('/api/tools/domain-health', { method: 'POST', body: JSON.stringify({ domain }) }),
  adminOverview: () => apiFetch<AdminToolsOverview>('/api/admin/tools/overview'),
  adminTools: () => apiFetch<{ success: true; count: number; tools: AdminToolRow[] }>('/api/admin/tools/tools'),
  adminPatchTool: (slug: string, patch: Record<string, unknown>) => apiFetch<{ override: unknown }>(`/api/admin/tools/tools/${encodeURIComponent(slug)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  adminResetTool: (slug: string) => apiFetch<{ reset: boolean }>(`/api/admin/tools/tools/${encodeURIComponent(slug)}/override`, { method: 'DELETE' }),
  adminProviders: () => apiFetch<{ providers: ProviderView[] }>('/api/admin/tools/providers'),
  adminSaveProvider: (slug: string, input: Record<string, unknown>) => apiFetch<{ provider: ProviderView }>(`/api/admin/tools/providers/${encodeURIComponent(slug)}`, { method: 'PUT', body: JSON.stringify({ ...input, slug }) }),
  adminTestProvider: (slug: string) => apiFetch<{ success: true; result: { slug: string; ok: boolean; status: string; latencyMs: number | null; detail: string } }>(`/api/admin/tools/providers/${encodeURIComponent(slug)}/test`, { method: 'POST' }),
  adminResolvers: () => apiFetch<{ resolvers: ResolverView[] }>('/api/admin/tools/resolvers'),
  adminTestResolver: (id: string) => apiFetch<{ success: true; result: { status: string; latencyMs: number | null; detail: string } }>(`/api/admin/tools/resolvers/${id}/test`, { method: 'POST' }),
  adminClearCache: (toolSlug?: string) => apiFetch<{ removed: number }>('/api/admin/tools/cache/clear', { method: 'POST', body: JSON.stringify(toolSlug ? { toolSlug } : {}) }),
  adminSweep: () => apiFetch<{ provider: unknown; resolver: unknown; monitor: unknown }>('/api/admin/tools/sweep', { method: 'POST', body: JSON.stringify({ kind: 'all' }) }),
  adminHealthChecks: () => apiFetch<{ checks: Array<{ id: string; subject_type: string; subject_slug: string; status: string; latency_ms: number | null; detail: string | null; checked_at: string }> }>('/api/admin/tools/health-checks?limit=50'),
};

export interface HistoryEntry {
  id: string;
  tool_slug: string;
  target: string | null;
  status: string;
  summary: Record<string, unknown>;
  created_at: string;
}

export interface ReportEntry {
  id: string;
  tool_slug: string;
  tool_name: string;
  target: string;
  status: string;
  created_at: string;
}

export interface MonitorEntry {
  id: string;
  kind: 'SSL_EXPIRY' | 'DNS_RECORD' | 'EMAIL_CONFIG';
  target: string;
  record_type: string | null;
  expected_value: string | null;
  match_mode: string;
  enabled: boolean;
  last_status: string;
  last_value: string | null;
  last_detail: string | null;
  last_checked_at: string | null;
}

export interface MonitorEvent {
  id: string;
  monitor_id: string;
  status: string;
  previous_value: string | null;
  current_value: string | null;
  detail: string;
  created_at: string;
}

export interface DomainHealthResult {
  domain: string;
  generatedAt: string;
  verdict: { status: string; summary: string; sectionsChecked: number; sectionsFailed: number };
  sections: Array<{ id: string; label: string; status: string; summary: string; detail: string | null; checked: boolean; durationMs: number | null; evidence: unknown }>;
  hostingContext: { owned: boolean; domainId: string | null; zoneId: string | null; serverName: string | null; serverIp: string | null; actions: Array<{ label: string; href: string; kind: string }> };
  monitors: Array<{ id: string; kind: string; target: string; enabled: boolean; lastStatus: string; lastCheckedAt: string | null }>;
  recommendations: string[];
  notes: string[];
  durationMs: number;
}

export interface ProviderView {
  slug: string;
  name: string;
  kind: string;
  description: string;
  endpoint: string | null;
  enabled: boolean;
  needsCredentials: boolean;
  hasCredentials: boolean;
  configuration: Record<string, unknown>;
  timeoutMs: number;
  rateLimitPerMinute: number;
  priority: number;
  healthStatus: string;
  healthDetail: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  usable: boolean;
  requirement: string | null;
}

export interface AdminToolRow extends ToolSummary {
  hasOverride: boolean;
  rateLimitProfile: string;
  statusOverride: string | null;
}

export interface AdminMetrics {
  totalExecutions: number;
  executionsToday: number;
  activeTools: number;
  disabledTools: number;
  failedExecutions: number;
  rateLimitEvents: number;
  blockedEvents: number;
  perTool: Array<{ slug: string; executions: number; failures: number; avgDurationMs: number | null; lastRunAt: string | null }>;
  daily: Array<{ day: string; executions: number; failures: number }>;
}

export interface ProviderHealthRow {
  slug: string;
  kind: string;
  healthStatus: string;
  checks: number;
  failures: number;
  latencyMs: number | null;
  lastCheckedAt?: string | null;
  lastError?: string | null;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  errorRate?: number | null;
}

export interface AbuseSummary {
  windowMinutes: number;
  limitEvents: number;
  blockedEvents: number;
  blockedAddresses: number;
  topTools: Array<{ toolSlug: string; events: number }>;
}

export interface ResolverView {
  id: string;
  name: string;
  provider: string;
  ip_address: string;
  protocol: string;
  version: string;
  country: string | null;
  endpoint: string | null;
  enabled: boolean;
  priority: number;
  health_status: string;
  last_checked_at: string | null;
  last_latency_ms: number | null;
}

export interface AdminToolsOverview {
  success: true;
  generatedAt: string;
  masterEnabled: boolean;
  anonymousAccess: boolean;
  metrics: AdminMetrics;
  catalog: { total: number; byStatus: Record<string, number>; byCategory: Array<{ slug: string; label: string; count: number }>; customised: number; missingImplementations: string[] };
  providers: ProviderHealthRow[];
  resolvers: Array<{ id: string; name: string; protocol: string; ipAddress: string; endpoint: string | null; enabled: boolean; healthStatus: string; lastCheckedAt: string | null; latencyMs: number | null }>;
  abuse: AbuseSummary;
}
