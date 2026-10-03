/**
 * Tools Center — Developer and Webmaster category handlers (spec §30–§39).
 *
 * The JSON/encoding/URL/UA tools are pure functions, so they are the easiest to be honest about:
 * what you send is what is processed, nothing leaves the server process. The network-facing ones
 * (HTTP headers, OS fingerprint, SMTP, link checker, Open Graph) go through the SSRF guard and keep
 * the evidence they gathered.
 */
import { httpHeaders, serverOsCheck } from '../developer/http';
import { smtpTest } from '../developer/smtp';
import { analyseEmailHeaders } from '../developer/email-header';
import { validateJson, formatJson, queryJson, jsonToCsv, csvToJson, diffJson } from '../developer/json-tools';
import { convertEncoding, inspectJwt } from '../developer/encoding';
import { urlComponents, urlParameters, resolveUrl, buildCampaignUrl, stripTracking, compareUrls } from '../developer/url-tools';
import { parseUserAgent } from '../developer/user-agent';
import { brokenLinkCheck } from '../webmaster/links';
import { openGraphCheck } from '../webmaster/social';
import { analyseRobots, generateRobots } from '../webmaster/robots';
import { serpSimulator, metaTagAudit } from '../webmaster/serp';
import { invalidInput } from '../core/errors';
import type { ToolHandler } from './kit';
import { bool, maybeNum, maybeStr, oneOf, str, strArray, targetLabel } from './kit';

const LINK_KINDS = ['a', 'img', 'script', 'link', 'iframe', 'source', 'other'] as const;

const JSON_OPERATIONS = ['validate', 'format', 'minify', 'query', 'to-csv', 'from-csv', 'diff'] as const;
const URL_OPERATIONS = ['components', 'parameters', 'resolve', 'campaign', 'strip-tracking', 'compare'] as const;
const ROBOTS_MODES = ['block-all', 'allow-all', 'block-ai', 'allow-search-engines', 'custom'] as const;
const ENCODING_FORMATS = ['base64', 'base64url', 'hex', 'url', 'html', 'unicode-escape', 'binary', 'rot13', 'rot47'] as const;

export const developerWebmasterHandlers: Record<string, ToolHandler> = {
  'http-headers': async (input) => {
    const headers: Record<string, string> = {};
    const userAgent = maybeStr(input, 'userAgent', { max: 300 });
    if (userAgent) headers['user-agent'] = userAgent;
    return httpHeaders({
      url: str(input, 'url', { max: 2000 }) || str(input, 'target', { required: true, max: 2000 }),
      method: oneOf(input, 'method', ['GET', 'HEAD'] as const, { default: 'GET' }),
      timeoutMs: maybeNum(input, 'timeoutMs', { min: 2000, max: 20_000 }),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });
  },

  'server-os': async (input) =>
    serverOsCheck({
      url: str(input, 'url', { max: 2000 }) || str(input, 'target', { required: true, max: 2000 }),
      timeoutMs: maybeNum(input, 'timeoutMs', { min: 2000, max: 20_000 }),
    }),

  'smtp-tester': async (input, context) => {
    const recipient = maybeStr(input, 'recipient', { max: 320 });
    return smtpTest(context.db, {
      target: str(input, 'target', { max: 320 }) || str(input, 'domain', { required: true, max: 320 }),
      port: maybeNum(input, 'port', { min: 1, max: 65535 }),
      ...(recipient ? { recipient } : {}),
      acknowledgeRecipientCheck: bool(input, 'acknowledgeRecipientCheck', false),
      timeoutMs: maybeNum(input, 'timeoutMs', { min: 2000, max: 15_000 }),
      maxHosts: maybeNum(input, 'maxHosts', { min: 1, max: 4 }),
    });
  },

  'email-header': async (input) => analyseEmailHeaders({ headers: str(input, 'headers', { required: true, max: 512 * 1024, trim: false }) }),

  'json-tools': async (input) => {
    const operation = oneOf(input, 'operation', JSON_OPERATIONS, { required: true });
    switch (operation) {
      case 'validate':
        return validateJson(str(input, 'text', { required: true, max: 2_000_000, trim: false }));
      case 'format':
        return formatJson({
          text: str(input, 'text', { required: true, max: 2_000_000, trim: false }),
          indent: input.indent === 'tab' ? 'tab' : maybeNum(input, 'indent', { min: 0, max: 8 }),
          sortKeys: bool(input, 'sortKeys', false),
          minify: false,
          trailingNewline: bool(input, 'trailingNewline', false),
        });
      case 'minify':
        return formatJson({ text: str(input, 'text', { required: true, max: 2_000_000, trim: false }), minify: true, trailingNewline: false });
      case 'query':
        return queryJson({ text: str(input, 'text', { required: true, max: 2_000_000, trim: false }), path: str(input, 'path', { required: true, max: 500 }) });
      case 'to-csv':
        return jsonToCsv({ text: str(input, 'text', { required: true, max: 2_000_000, trim: false }), delimiter: oneOf(input, 'delimiter', [',', ';', '\t'] as const, { default: ',' }) });
      case 'from-csv':
        return csvToJson({
          text: str(input, 'text', { required: true, max: 2_000_000, trim: false }),
          delimiter: oneOf(input, 'delimiter', [',', ';', '\t'] as const, { default: ',' }),
          inferTypes: bool(input, 'inferTypes', true),
        });
      case 'diff':
        return diffJson({
          before: str(input, 'before', { required: true, max: 2_000_000, trim: false }),
          after: str(input, 'after', { required: true, max: 2_000_000, trim: false }),
        });
      default:
        throw invalidInput('Unsupported JSON operation.');
    }
  },

  'encoding-tools': async (input) => {
    if (bool(input, 'inspectJwt', false) || str(input, 'token').length > 0) {
      return inspectJwt({ token: str(input, 'token', { required: true, max: 20_000 }) });
    }
    return convertEncoding({
      text: str(input, 'text', { required: true, max: 500_000, trim: false }),
      format: oneOf(input, 'format', ENCODING_FORMATS, { required: true }),
      mode: oneOf(input, 'mode', ['encode', 'decode'] as const, { default: 'encode' }),
    });
  },

  'url-tools': async (input) => {
    const operation = oneOf(input, 'operation', URL_OPERATIONS, { required: true });
    switch (operation) {
      case 'components':
        return urlComponents({ url: str(input, 'url', { required: true, max: 4000 }) });
      case 'parameters':
        return urlParameters({ url: str(input, 'url', { required: true, max: 4000 }) });
      case 'resolve':
        return resolveUrl({ base: str(input, 'base', { required: true, max: 4000 }), relative: str(input, 'relative', { required: true, max: 4000 }) });
      case 'campaign':
        return buildCampaignUrl({
          url: str(input, 'url', { required: true, max: 4000 }),
          source: str(input, 'source', { required: true, max: 200 }),
          medium: str(input, 'medium', { required: true, max: 200 }),
          campaign: str(input, 'campaign', { required: true, max: 200 }),
          term: maybeStr(input, 'term', { max: 200 }),
          content: maybeStr(input, 'content', { max: 200 }),
        });
      case 'strip-tracking':
        return stripTracking({ url: str(input, 'url', { required: true, max: 4000 }) });
      case 'compare':
        return compareUrls({
          first: str(input, 'first', { required: true, max: 4000 }),
          second: str(input, 'second', { required: true, max: 4000 }),
        });
      default:
        throw invalidInput('Unsupported URL operation.');
    }
  },

  'user-agent': async (input, context) => {
    const userAgent = maybeStr(input, 'userAgent', { max: 600 }) ?? (input.fromRequest === true ? context.request.headers['user-agent'] : undefined);
    if (userAgent && input.fromRequest === true) {
      // Parsing the caller's own UA is the common case; the explicit header map is passed so the
      // result can also report Accept-Language / Sec-CH-UA hints the browser sent.
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(context.request.headers)) {
        if (typeof value === 'string') headers[key] = value;
        else if (Array.isArray(value)) headers[key] = value.join(', ');
      }
      return parseUserAgent({ userAgent, headers });
    }
    if (userAgent) return parseUserAgent({ userAgent });
    return parseUserAgent({ headers: { 'user-agent': String(context.request.headers['user-agent'] ?? '') } });
  },

  'broken-links': async (input) =>
    brokenLinkCheck({
      url: str(input, 'url', { max: 2000 }) || str(input, 'target', { required: true, max: 2000 }),
      maxLinks: maybeNum(input, 'maxLinks', { min: 1, max: 100 }),
      timeoutMs: maybeNum(input, 'timeoutMs', { min: 2000, max: 20_000 }),
      includeExternal: input.includeExternal === undefined ? undefined : bool(input, 'includeExternal', true),
      kindFilter: strArray(input, 'kinds', { max: 7 })?.filter((kind): kind is (typeof LINK_KINDS)[number] => (LINK_KINDS as readonly string[]).includes(kind)),
    }),

  'open-graph': async (input) => openGraphCheck({ url: str(input, 'url', { max: 2000 }) || str(input, 'target', { required: true, max: 2000 }) }),

  'robots-generator': async (input) => {
    const mode = oneOf(input, 'mode', ROBOTS_MODES, { default: 'allow-search-engines' });
    if (str(input, 'text').length > 0) {
      return analyseRobots({
        text: str(input, 'text', { max: 200_000, trim: false }),
        testPaths: strArray(input, 'testPaths', { max: 40 }),
        testUserAgents: strArray(input, 'testUserAgents', { max: 20 }),
      });
    }
    return generateRobots({
      mode,
      sitemaps: strArray(input, 'sitemaps', { max: 20 }),
      host: maybeStr(input, 'host', { max: 300 }),
      crawlDelaySeconds: maybeNum(input, 'crawlDelaySeconds', { min: 0, max: 3600 }),
      disallowPaths: strArray(input, 'disallowPaths', { max: 100 }),
      allowPaths: strArray(input, 'allowPaths', { max: 100 }),
      userAgents: strArray(input, 'userAgents', { max: 40 }),
      keepOutOfIndex: bool(input, 'keepOutOfIndex', false),
    });
  },

  'serp-simulator': async (input) => {
    if (str(input, 'html').length > 0) return metaTagAudit({ html: str(input, 'html', { max: 1_000_000, trim: false }) });
    return serpSimulator({
      title: maybeStr(input, 'title', { max: 400 }),
      description: maybeStr(input, 'description', { max: 1000 }),
      url: str(input, 'url', { required: true, max: 4000 }),
      breadcrumb: maybeStr(input, 'breadcrumb', { max: 400 }),
      siteName: maybeStr(input, 'siteName', { max: 200 }),
      device: oneOf(input, 'device', ['desktop', 'mobile'] as const, { default: 'desktop' }),
    });
  },
};

export const developerWebmasterTargets: Record<string, (input: Record<string, unknown>) => string | null> = {
  'http-headers': (input) => targetLabel(typeof input.url === 'string' ? input.url : typeof input.target === 'string' ? input.target : null),
  'server-os': (input) => targetLabel(typeof input.url === 'string' ? input.url : typeof input.target === 'string' ? input.target : null),
  'smtp-tester': (input) => targetLabel(typeof input.target === 'string' ? input.target : typeof input.domain === 'string' ? input.domain : null),
  'email-header': (input) => {
    const headers = typeof input.headers === 'string' ? input.headers : '';
    const from = /^from:.*$/im.exec(headers)?.[0] ?? null;
    return targetLabel(from);
  },
  'json-tools': () => null,
  'encoding-tools': () => null,
  'url-tools': (input) => targetLabel(typeof input.url === 'string' ? input.url : null),
  'user-agent': () => null,
  'broken-links': (input) => targetLabel(typeof input.url === 'string' ? input.url : null),
  'open-graph': (input) => targetLabel(typeof input.url === 'string' ? input.url : null),
  'robots-generator': (input) => targetLabel(typeof input.host === 'string' ? input.host : null),
  'serp-simulator': (input) => targetLabel(typeof input.url === 'string' ? input.url : null),
};
