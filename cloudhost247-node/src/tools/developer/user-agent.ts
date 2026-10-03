/**
 * Tools Center — user-agent tools (spec §49).
 *
 * Parses a user-agent string into browser, engine, platform, device class and bot identity, using a
 * curated ordered rule table. Two honesty constraints:
 *   - A UA string is a CLAIM. Every result is labelled with the pattern that matched, so nobody has
 *     to trust the tool.
 *   - This is not a replacement for feature detection or a UA database service. Anything outside the
 *     table returns UNKNOWN with the raw string, rather than a plausible-looking guess.
 */
import { invalidInput } from '../core/errors';
import { sanitizeUntrustedText } from '../core/validation';

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface UaIdentity {
  raw: string;
  browser: { name: string; version: string | null } | null;
  engine: { name: string; version: string | null } | null;
  platform: { os: string; version: string | null } | null;
  device: { class: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown'; vendor: string | null; model: string | null };
  bot: { isBot: boolean; name: string | null; purpose: string | null; disclaimer: string | null };
  clientHints: { secChUa: string | null; secChUaPlatform: string | null; secChUaMobile: string | null; secChUaFullVersionList: string | null };
  matchedRules: Array<{ field: string; pattern: string; value: string }>;
  confidence: Confidence;
  unknown: string[];
  notes: string[];
}

interface UaRule {
  field: 'browser' | 'engine' | 'platform' | 'device';
  pattern: RegExp;
  name: string;
  versionGroup?: number;
  deviceClass?: UaIdentity['device']['class'];
  vendor?: string | null;
  modelGroup?: number;
}

const UA_RULES: UaRule[] = [
  // Browsers first, in the order that matters (Edge/Opera/Samsung/Vivaldi all claim Chrome).
  { field: 'browser', pattern: /Edg(?:e|A|iOS)?\/([\d.]+)/, name: 'Microsoft Edge', versionGroup: 1 },
  { field: 'browser', pattern: /OPR\/([\d.]+)/, name: 'Opera', versionGroup: 1 },
  { field: 'browser', pattern: /SamsungBrowser\/([\d.]+)/, name: 'Samsung Internet', versionGroup: 1 },
  { field: 'browser', pattern: /Vivaldi\/([\d.]+)/, name: 'Vivaldi', versionGroup: 1 },
  { field: 'browser', pattern: /Brave\/([\d.]+)/, name: 'Brave', versionGroup: 1 },
  { field: 'browser', pattern: /Firefox\/([\d.]+)/, name: 'Firefox', versionGroup: 1 },
  { field: 'browser', pattern: /FxiOS\/([\d.]+)/, name: 'Firefox for iOS', versionGroup: 1 },
  { field: 'browser', pattern: /CriOS\/([\d.]+)/, name: 'Chrome on iOS', versionGroup: 1 },
  { field: 'browser', pattern: /Chrome\/([\d.]+)/, name: 'Chrome', versionGroup: 1 },
  { field: 'browser', pattern: /Version\/([\d.]+).*Safari/, name: 'Safari', versionGroup: 1 },
  { field: 'browser', pattern: /Safari\/([\d.]+)/, name: 'Safari', versionGroup: 1 },
  { field: 'browser', pattern: /MSIE ([\d.]+)/, name: 'Internet Explorer', versionGroup: 1 },
  { field: 'browser', pattern: /Trident\/[\d.]+.*rv:([\d.]+)/, name: 'Internet Explorer (compatibility mode)', versionGroup: 1 },
  { field: 'browser', pattern: /curl\/([\d.]+)/, name: 'curl (command-line client)', versionGroup: 1 },
  { field: 'browser', pattern: /Wget\/([\d.]+)/, name: 'Wget (command-line client)', versionGroup: 1 },
  { field: 'browser', pattern: /python-requests\/([\d.]+)/, name: 'Python requests', versionGroup: 1 },
  { field: 'browser', pattern: /PostmanRuntime\/([\d.]+)/, name: 'Postman', versionGroup: 1 },

  // Engines.
  { field: 'engine', pattern: /Gecko\/([\d.]+)/, name: 'Gecko', versionGroup: 1 },
  { field: 'engine', pattern: /AppleWebKit\/([\d.]+)/, name: 'WebKit', versionGroup: 1 },
  { field: 'engine', pattern: /Trident\/([\d.]+)/, name: 'Trident', versionGroup: 1 },
  { field: 'engine', pattern: /Blink/, name: 'Blink' },

  // Platforms.
  { field: 'platform', pattern: /Windows NT ([\d.]+)/, name: 'Windows', versionGroup: 1 },
  { field: 'platform', pattern: /Android ([\d.]+)/, name: 'Android', versionGroup: 1 },
  { field: 'platform', pattern: /iPhone OS ([\d_]+)/, name: 'iOS (iPhone)', versionGroup: 1 },
  { field: 'platform', pattern: /iPad; CPU OS ([\d_]+)/, name: 'iPadOS', versionGroup: 1 },
  { field: 'platform', pattern: /Mac OS X ([\d_.]+)/, name: 'macOS', versionGroup: 1 },
  { field: 'platform', pattern: /CrOS/, name: 'ChromeOS' },
  { field: 'platform', pattern: /Ubuntu/, name: 'Ubuntu Linux' },
  { field: 'platform', pattern: /Linux/, name: 'Linux (distribution not stated)' },
  { field: 'platform', pattern: /FreeBSD/, name: 'FreeBSD' },

  // Devices.
  { field: 'device', pattern: /iPhone/, name: 'iPhone', deviceClass: 'mobile', vendor: 'Apple' },
  { field: 'device', pattern: /iPad/, name: 'iPad', deviceClass: 'tablet', vendor: 'Apple' },
  { field: 'device', pattern: /Android[^;)]*;\s*([^;)]+)\s*(?:Build|\))/, name: 'Android device', deviceClass: 'mobile', vendor: null, modelGroup: 1 },
  { field: 'device', pattern: /Mobile|Windows Phone/, name: 'Mobile device', deviceClass: 'mobile' },
];

const BOT_RULES: Array<{ pattern: RegExp; name: string; purpose: string; disclaimer?: string }> = [
  { pattern: /Googlebot-Image/i, name: 'Googlebot-Image', purpose: 'Indexing images for Google Images.' },
  { pattern: /Googlebot/i, name: 'Googlebot', purpose: 'Indexing pages for Google Search.', disclaimer: 'The UA string can be imitated trivially; only a reverse-DNS check (or verifying the published IP ranges) confirms Googlebot.' },
  { pattern: /bingbot/i, name: 'Bingbot', purpose: 'Indexing pages for Bing.' },
  { pattern: /DuckDuckBot/i, name: 'DuckDuckBot', purpose: 'Indexing pages for DuckDuckGo.' },
  { pattern: /Applebot/i, name: 'Applebot', purpose: 'Apple search and Siri suggestions.' },
  { pattern: /YandexBot/i, name: 'YandexBot', purpose: 'Indexing pages for Yandex.' },
  { pattern: /Ba[idu]du?spider/i, name: 'Baiduspider', purpose: 'Indexing pages for Baidu.' },
  { pattern: /facebookexternalhit/i, name: 'facebookexternalhit', purpose: 'Fetching a page to build a link preview.' },
  { pattern: /Twitterbot/i, name: 'Twitterbot', purpose: 'Building link previews for X/Twitter.' },
  { pattern: /LinkedInBot/i, name: 'LinkedInBot', purpose: 'Building link previews for LinkedIn.' },
  { pattern: /Slackbot|Discordbot|TelegramBot/i, name: 'Chat link preview bot', purpose: 'Building the link preview shown inside a chat app.' },
  { pattern: /AhrefsBot|SemrushBot|MJ12bot|DotBot/i, name: 'SEO crawler', purpose: 'Commercial crawling for SEO/backlink data. Usually honours robots.txt with the right rules.' },
  { pattern: /GPTBot|CCBot|ClaudeBot|anthropic-ai|Bytespider/i, name: 'AI training crawler', purpose: 'Collecting content for model training or AI answers. Its robots.txt opt-out policy differs per operator.' },
  { pattern: /curl|Wget|python-requests|Go-http-client|node-fetch|axios/i, name: 'Scripted client', purpose: 'A command-line or library HTTP client, not a browser.' },
  { pattern: /UptimeRobot|Pingdom|StatusCake|Better Uptime/i, name: 'Monitoring service', purpose: 'Availability monitoring.' },
];

export function parseUserAgent(input: { userAgent?: string; headers?: Record<string, string> }): UaIdentity {
  const ua = (input.userAgent ?? input.headers?.['user-agent'] ?? '').trim();
  if (ua.length === 0) throw invalidInput('Enter a user-agent string (or pass a User-Agent header).');
  if (ua.length > 4096) throw invalidInput('That is longer than any real user-agent string.');

  const matchedRules: UaIdentity['matchedRules'] = [];
  let browser: UaIdentity['browser'] = null;
  let engine: UaIdentity['engine'] = null;
  let platform: UaIdentity['platform'] = null;
  let device: UaIdentity['device'] = { class: 'desktop', vendor: null, model: null };

  for (const rule of UA_RULES) {
    const match = rule.pattern.exec(ua);
    if (!match) continue;
    const version = rule.versionGroup !== undefined ? (match[rule.versionGroup] ?? null) : null;
    if (rule.field === 'browser' && !browser) browser = { name: rule.name, version };
    if (rule.field === 'engine' && !engine) engine = { name: rule.name, version };
    if (rule.field === 'platform' && !platform) platform = { os: rule.name, version: version?.replace(/_/g, '.') ?? null };
    if (rule.field === 'device') {
      device = {
        class: rule.deviceClass ?? 'desktop',
        vendor: rule.vendor ?? null,
        model: rule.modelGroup !== undefined ? (match[rule.modelGroup] ?? rule.name).trim() : rule.name,
      };
    }
    matchedRules.push({ field: rule.field, pattern: rule.pattern.source, value: rule.name });
  }

  const botMatch = BOT_RULES.find((rule) => rule.pattern.test(ua));
  if (botMatch) {
    device = { class: 'bot', vendor: null, model: botMatch.name };
    matchedRules.push({ field: 'bot', pattern: 'bot table', value: botMatch.name });
  }

  const unknown: string[] = [];
  if (!browser) unknown.push('The browser/client could not be identified from the table this tool uses.');
  if (!platform) unknown.push('The operating system could not be identified.');
  if (browser?.name === 'Chrome' && /Chrome\/\d+/.test(ua) && !/Chromium|Edg|OPR|SamsungBrowser|Vivaldi|Brave/.test(ua)) {
    unknown.push('Chrome is claimed, but most Chromium-based browsers also claim Chrome. Other Chromium browsers in this table are checked first; anything not in the table will be reported as Chrome.');
  }
  if (device.class === 'desktop' && /Android|Mobile/.test(ua) && !botMatch) {
    unknown.push('The string mentions a mobile platform but no device rule matched; the device class may be wrong.');
  }

  const headers = input.headers ?? {};
  const clientHints = {
    secChUa: headers['sec-ch-ua'] ?? null,
    secChUaPlatform: headers['sec-ch-ua-platform'] ?? null,
    secChUaMobile: headers['sec-ch-ua-mobile'] ?? null,
    secChUaFullVersionList: headers['sec-ch-ua-full-version-list'] ?? null,
  };
  if (clientHints.secChUa && browser) {
    matchedRules.push({ field: 'browser', pattern: 'Sec-CH-UA header', value: clientHints.secChUa });
  }

  return {
    raw: sanitizeUntrustedText(ua, { maxLength: 512, collapseWhitespace: false }),
    browser,
    engine,
    platform,
    device,
    bot: {
      isBot: Boolean(botMatch),
      name: botMatch?.name ?? null,
      purpose: botMatch?.purpose ?? null,
      disclaimer: botMatch?.disclaimer ?? (botMatch ? 'A user-agent string is a self-declared claim. Verify a bot by its reverse DNS and published IP ranges before treating it as legitimate.' : null),
    },
    clientHints,
    matchedRules,
    confidence: browser && platform ? 'HIGH' : browser || platform ? 'MEDIUM' : 'LOW',
    unknown,
    notes: [
      'A user-agent string is supplied by the client and can be set to anything. It is a hint, never authentication.',
      'Browsers freeze and reduce the detail in UA strings deliberately (Chrome\'s UA reduction programme). Client Hints are the replacement, and they need the site to opt in per request.',
      'For your own site, prefer feature detection for behaviour and keep UA sniffing only for analytics, where an unknown bucket is an acceptable outcome.',
    ],
  };
}
