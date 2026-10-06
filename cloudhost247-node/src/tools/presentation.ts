import { DISCOVERY_CATEGORIES, TOOL_CATALOG } from './catalog';
export function resolveToolPage(path: string) {
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
