import { DISCOVERY_CATEGORIES, TOOL_CATALOG } from './catalog';
import { BUSINESS_TOOLS, BUSINESS_TOOLS_ROOT } from './business';

/**
 * Resolve a `/tools/...` URL to the page that answers it.
 *
 * The not-found handler uses this to decide whether a URL under /tools is a real page or a 404, so
 * anything missing here is served with HTTP 404 and `X-Robots-Tag: noindex` even though the single
 * page app renders it. That is how all twenty-one business tools and the compliance collection hub
 * were being served: the app drew them, and every crawler, uptime check and link checker saw a 404.
 *
 * The order matters — the collection hub is a page like the catalogue entries, not a tool.
 */
export function resolveToolPage(path: string) {
  if (path === '/tools/compliance-documents')
    return {
      path,
      name: 'Compliance & Document Tools',
      summary:
        'Identity-document, secret, encoding and infrastructure utilities, each stating what it verifies.',
    };
  if (path === BUSINESS_TOOLS_ROOT || path === `${BUSINESS_TOOLS_ROOT}/`) {
    const catalogued = TOOL_CATALOG.find((tool) => tool.path === path);
    if (catalogued) return catalogued;
    return {
      path: BUSINESS_TOOLS_ROOT,
      name: 'Business Tools',
      summary:
        'Payroll, HR and finance calculators, generators and comparisons for Nigerian businesses.',
    };
  }
  if (path.startsWith(`${BUSINESS_TOOLS_ROOT}/`)) {
    const business = BUSINESS_TOOLS.find((tool) => tool.path === path);
    if (business) return { path, name: business.name, summary: business.summary };
  }
  if (path === '/tools' || path === '/tools/')
    return {
      path: '/tools',
      name: 'CloudHost247 Tools',
      summary:
        'DNS, domain, IP, network, security, email and developer tools with clear results and honest availability.',
    };
  const category = path.replace('/tools/category/', '');
  if (
    path.startsWith('/tools/category/') &&
    Object.prototype.hasOwnProperty.call(DISCOVERY_CATEGORIES, category)
  ) {
    const name =
      DISCOVERY_CATEGORIES[category as keyof typeof DISCOVERY_CATEGORIES]!;
    return {
      path,
      name: `${name} Tools`,
      summary: `Explore CloudHost247 ${name.toLowerCase()} tools with clear results and explicit limitations.`,
    };
  }
  return (
    TOOL_CATALOG.find(
      (tool) => tool.path === path || tool.legacyPaths?.includes(path)
    ) ?? null
  );
}
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!
  );
export function toolPageHtml(
  html: string,
  page: NonNullable<ReturnType<typeof resolveToolPage>>,
  appUrl: string
) {
  const canonical = appUrl.replace(/\/$/, '') + page.path;
  const title = `${page.name} | CloudHost247`;
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(title)}</title>`)
    .replace(
      /<meta\s+name="description"[\s\S]*?>/,
      `<meta name="description" content="${escape(page.summary)}">`
    )
    .replace(
      '</head>',
      `<link rel="canonical" href="${escape(canonical)}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(page.summary)}"><meta property="og:url" content="${escape(canonical)}"><meta property="og:type" content="website"></head>`
    );
}
