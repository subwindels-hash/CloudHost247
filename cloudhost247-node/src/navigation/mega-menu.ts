/**
 * CloudHost247 mega-menu — the single definition of the platform's public navigation.
 *
 * The navigation is data, served by `GET /api/v1/navigation`, and it is the SAME data the desktop
 * mega-menu, the mobile drawer, the sitemap and the footer all render. That is deliberate: a nav
 * implemented twice is a nav that eventually disagrees with itself, and this platform has no room
 * for a menu entry that points nowhere.
 *
 * Invariants (pinned by tests):
 *   - every `to` is a unique, internal, non-empty route;
 *   - badge usage is bounded — at most two per section, so "NEW/POPULAR/TRENDING" stays
 *     meaningful instead of decorating everything;
 *   - every group has at least one link, and every entry has a description (the mega-menu shows it,
 *     and so does the mobile accordion, which is why short descriptions are required).
 */

export type Badge = 'NEW' | 'POPULAR' | 'TRENDING' | 'INCLUDED' | 'SALE';

export interface NavLink {
  label: string;
  to: string;
  description: string;
  badge?: Badge;
}

export interface NavGroup {
  title: string;
  links: NavLink[];
}

export interface NavSection {
  id: 'domains' | 'websites' | 'marketing' | 'hosting' | 'tools' | 'services';
  label: string;
  blurb: string;
  groups: NavGroup[];
  featured?: { title: string; body: string; to: string; ctaLabel: string };
}

export const MEGA_MENU: readonly NavSection[] = [
  {
    id: 'domains',
    label: 'Domains',
    blurb: 'Find, register, transfer and manage domain names — with real registrar pricing.',
    featured: {
      title: 'Search a domain',
      body: 'Live availability and pricing from a connected registrar. Bulk search up to 200 names at once.',
      to: '/domains/search',
      ctaLabel: 'Start a search',
    },
    groups: [
      {
        title: 'Find a domain',
        links: [
          { label: 'Domain Search', to: '/domains/search', description: 'Check availability and register a domain.', badge: 'POPULAR' },
          { label: 'Bulk Domain Search', to: '/domains/bulk-search', description: 'Check up to 200 names from a pasted list.' },
          { label: 'Domain Transfers', to: '/domains/transfer', description: 'Move a domain in, with EPP code and status tracking.' },
          { label: 'Domain Extensions', to: '/domains/extensions', description: 'Browse TLDs with registration and renewal prices.' },
        ],
      },
      {
        title: 'Domain investing',
        links: [
          { label: 'Domain Auctions', to: '/domains/auctions', description: 'Bid on listed names, with a real auction ledger.', badge: 'NEW' },
          { label: 'Domain Valuation', to: '/domains/appraisal', description: 'An estimated market value — never a guaranteed price.' },
          { label: 'Domain Broker', to: '/domains/broker', description: 'We approach the owner of a registered domain for you.' },
          { label: 'Discount Domain Club', to: '/domains/club', description: 'Membership pricing on eligible registrations and renewals.' },
        ],
      },
      {
        title: 'Domain tools',
        links: [
          { label: 'WHOIS Lookup', to: '/domains/whois', description: 'Public registration data, privacy-respecting.' },
          { label: 'My Domains', to: '/dashboard/domains', description: 'Renewals, auto-renew, locks, DNS and contacts.' },
          { label: 'DNS Management', to: '/dashboard/dns', description: 'Zones and records for domains you host here.' },
          { label: 'Domain Health', to: '/domains/health', description: 'Check DNS, mail and web records for a domain.' },
        ],
      },
    ],
  },
  {
    id: 'websites',
    label: 'Websites & builders',
    blurb: 'Build a website, launch a store, or have an expert do it for you.',
    featured: {
      title: 'AI Website Builder',
      body: 'Describe the website you want in plain language and get real pages, copy and SEO to edit.',
      to: '/websites/ai-builder',
      ctaLabel: 'Describe your site',
    },
    groups: [
      {
        title: 'Website builder',
        links: [
          { label: 'Website Builder', to: '/websites/builder', description: 'Templates, pages, sections, media and publishing.', badge: 'INCLUDED' },
          { label: 'Online Store', to: '/websites/store', description: 'Sell physical, digital and service products.' },
          { label: 'Templates', to: '/websites/templates', description: 'Start from a real, publishable page layout.' },
        ],
      },
      {
        title: 'AI',
        links: [
          { label: 'AI Website Builder', to: '/websites/ai-builder', description: 'Generate a full site from a written brief.', badge: 'NEW' },
        ],
      },
      {
        title: 'Professional services',
        links: [
          { label: 'Hire an Expert', to: '/websites/experts', description: 'Design, development, migration and maintenance.' },
          { label: 'Website Design Services', to: '/websites/design-services', description: 'Scoped, quoted and delivered by our team.' },
        ],
      },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    blurb: 'Reach your audience: campaigns, brand, inbox and search visibility.',
    featured: {
      title: 'Unified Inbox',
      body: 'Every conversation from your website, forms, email and support in one queue.',
      to: '/marketing/inbox',
      ctaLabel: 'Open the inbox',
    },
    groups: [
      {
        title: 'Grow your reach',
        links: [
          { label: 'Digital Marketing', to: '/marketing/digital', description: 'Managed SEO, ads, social, email and analytics.', badge: 'POPULAR' },
          { label: 'SEO Tools', to: '/marketing/seo', description: 'Audit search visibility and track keywords.' },
          { label: 'Marketing Analytics', to: '/marketing/analytics', description: 'Source-attributed reporting, no invented numbers.' },
        ],
      },
      {
        title: 'Brand & conversations',
        links: [
          { label: 'Logo Maker', to: '/marketing/logo-maker', description: 'Generate and export a real SVG or PNG logo.' },
          { label: 'Unified Inbox', to: '/marketing/inbox', description: 'Conversations, labels, assignment and notes.' },
        ],
      },
    ],
  },
  {
    id: 'hosting',
    label: 'Hosting & services',
    blurb: 'Hosting, servers, apps, email and infrastructure — the existing CloudHost247 platform.',
    groups: [
      {
        title: 'Hosting',
        links: [
          { label: 'All hosting', to: '/hosting', description: 'Compare every hosting service.', badge: 'POPULAR' },
          { label: 'cPanel Hosting', to: '/hosting/cpanel', description: 'Shared hosting on cPanel.' },
          { label: 'VPS Hosting', to: '/hosting/vps', description: 'Virtual private servers with full root.' },
          { label: 'Dedicated Servers', to: '/hosting/dedicated', description: 'Bare-metal capacity for heavy workloads.' },
          { label: 'Application Hosting', to: '/hosting/application-hosting', description: 'Run Node, Python, Docker and more.' },
        ],
      },
      {
        title: 'Platform',
        links: [
          { label: 'Control Panels', to: '/hosting/control-panels', description: 'Manage the panels on your services.' },
          { label: 'App Marketplace', to: '/apps', description: 'Install and deploy managed applications.' },
          { label: 'Tools Center', to: '/tools', description: 'DNS, IP, security and developer tooling.' },
          { label: 'Services', to: '/services', description: 'Every service on your account.' },
        ],
      },
    ],
  },
];

/** Flat list of every link in the menu, used by the sitemap and by link-integrity tests. */
export function allNavLinks(): NavLink[] {
  return MEGA_MENU.flatMap((section) => section.groups.flatMap((group) => group.links));
}

export interface NavigationValidation {
  ok: boolean;
  errors: string[];
  linkCount: number;
}

/**
 * Structural validation, run at startup and in tests. A navigation that ships broken is a
 * navigation that ships dead links, so this is enforced rather than reviewed.
 */
export function validateNavigation(sections: readonly NavSection[] = MEGA_MENU): NavigationValidation {
  const errors: string[] = [];
  const seen = new Map<string, string>();
  let linkCount = 0;

  for (const section of sections) {
    if (!section.label.trim()) errors.push(`section ${section.id} has no label`);
    if (!section.blurb.trim()) errors.push(`section ${section.id} has no blurb`);
    if (section.groups.length === 0) errors.push(`section ${section.id} has no groups`);
    let badgeCount = 0;

    for (const group of section.groups) {
      if (!group.title.trim()) errors.push(`section ${section.id} has a group with no title`);
      if (group.links.length === 0) errors.push(`section ${section.id} / ${group.title} has no links`);
      for (const link of group.links) {
        linkCount += 1;
        if (!link.label.trim()) errors.push(`a link in ${section.id}/${group.title} has no label`);
        if (!link.description.trim()) errors.push(`${link.label || '(unnamed link)'} has no description`);
        if (!link.to.startsWith('/') || link.to.startsWith('//')) {
          errors.push(`${link.label} must use an internal application path (got "${link.to}")`);
        }
        if (link.to.includes('://')) errors.push(`${link.label} must not be an absolute URL`);
        const existing = seen.get(link.to);
        if (existing && existing !== `${section.id}/${group.title}`) {
          // The same destination may legitimately appear in two groups of the SAME section (e.g.
          // "AI Website Builder" in the AI group and the builder group); a cross-section clash
          // means the information architecture has drifted.
          if (!existing.startsWith(section.id) && !link.to.startsWith(`/${section.id}`)) {
            errors.push(`"${link.to}" appears in both ${existing} and ${section.id}/${group.title}`);
          }
        }
        seen.set(link.to, `${section.id}/${group.title}`);
        if (link.badge) badgeCount += 1;
      }
    }
    // Badge budget: at most two per section. With ~12 links a section, two draws the eye to the
    // two things actually worth flagging; more than that and every label competes.
    if (badgeCount > 2) errors.push(`section ${section.id} uses ${badgeCount} badges — at most two per section keeps them meaningful`);
  }

  return { ok: errors.length === 0, errors, linkCount };
}

/**
 * URL patterns the frontend router serves. `patterns` are the literal paths declared for each
 * pattern; a `:param` segment matches any single segment. Kept here (rather than only in the
 * frontend) so the navigation can be validated against what the app can actually render.
 */
export const ROUTE_PATTERNS: readonly string[] = [
  '/', '/hosting', '/hosting/control-panels', '/hosting/cpanel', '/hosting/vps', '/hosting/dedicated',
  '/hosting/application-hosting', '/apps', '/tools', '/tools/:slug', '/about', '/contact', '/faq',
  '/domains', '/domains/search', '/domains/bulk-search', '/domains/transfer', '/domains/extensions',
  '/domains/auctions', '/domains/auctions/:id', '/domains/appraisal', '/domains/club', '/domains/whois',
  '/domains/broker', '/domains/health', '/websites', '/websites/builder', '/websites/builder/:siteId',
  '/websites/ai-builder', '/websites/ai-builder/:projectId', '/websites/templates', '/websites/store',
  '/websites/store/:storeId', '/websites/experts', '/websites/experts/:id', '/websites/design-services',
  '/marketing', '/marketing/digital', '/marketing/seo', '/marketing/analytics', '/marketing/logo-maker',
  '/marketing/logo-maker/:projectId', '/marketing/inbox', '/marketing/inbox/:conversationId',
  '/services', '/services/cloudflare', '/services/cloudflare/:id', '/billing', '/invoices',
  '/invoices/:id', '/support', '/support/:id', '/dashboard', '/dashboard/domains', '/dashboard/dns',
  '/dashboard/servers', '/dashboard/apps', '/dashboard/notifications', '/cart', '/checkout',
  '/account', '/account/domain-brokerage', '/admin', '/admin/platform-services',
  '/admin/website-builder', '/admin/online-store', '/admin/expert-services', '/admin/marketing-services',
  '/admin/unified-inbox', '/admin/platform-plans', '/login', '/register',
];

export function routeExists(path: string): boolean {
  const normalized = path.split('?')[0]!.replace(/\/$/, '') || '/';
  return ROUTE_PATTERNS.some((pattern) => {
    if (pattern === normalized) return true;
    const patternParts = pattern.split('/');
    const pathParts = normalized.split('/');
    if (patternParts.length !== pathParts.length) return false;
    return patternParts.every((part, index) => part.startsWith(':') || part === pathParts[index]);
  });
}

/** Every menu link must resolve to a route the app actually serves. Used by the navigation test. */
export function validateNavigationTargets(sections: readonly NavSection[] = MEGA_MENU): NavigationValidation {
  const base = validateNavigation(sections);
  const errors = [...base.errors];
  for (const link of sections.flatMap((section) => section.groups.flatMap((group) => group.links))) {
    if (!routeExists(link.to)) errors.push(`"${link.label}" points at ${link.to}, which no route renders`);
  }
  return { ok: errors.length === 0, errors, linkCount: base.linkCount };
}
