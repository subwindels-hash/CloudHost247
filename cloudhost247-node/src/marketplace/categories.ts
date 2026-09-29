/**
 * Phase 6 — the canonical marketplace category list (spec §7).
 *
 * Categories are rows in `application_categories`, seeded/updated by the manifest importer and
 * the category admin API. This constant defines the canonical slug → display name mapping and
 * default sort order so freshly imported databases get a sane, consistent category tree, while
 * still allowing admins to rename/reorder/retire categories afterwards (the importer only
 * inserts missing rows; it never overwrites admin edits).
 */
export interface CanonicalCategory {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
}

export const CANONICAL_CATEGORIES: CanonicalCategory[] = [
  { slug: 'ai', name: 'AI', description: 'LLM frontends, model serving, and machine-learning tools', sortOrder: 10 },
  { slug: 'analytics', name: 'Analytics', description: 'Web, product, and event analytics', sortOrder: 20 },
  { slug: 'automation', name: 'Automation', description: 'Workflow automation and integrations', sortOrder: 30 },
  { slug: 'business', name: 'Business', description: 'General business software', sortOrder: 40 },
  { slug: 'cms', name: 'CMS', description: 'Content management and blogging platforms', sortOrder: 50 },
  { slug: 'communication', name: 'Communication', description: 'Chat, email, and collaboration servers', sortOrder: 60 },
  { slug: 'crm', name: 'CRM', description: 'Customer relationship management', sortOrder: 70 },
  { slug: 'database', name: 'Database', description: 'Database servers and management tools', sortOrder: 80 },
  { slug: 'developer-tools', name: 'Developer Tools', description: 'Git, CI, and engineering productivity', sortOrder: 90 },
  { slug: 'documents', name: 'Documents', description: 'Document management and editors', sortOrder: 100 },
  { slug: 'e-commerce', name: 'E-commerce', description: 'Online stores and selling platforms', sortOrder: 110 },
  { slug: 'education', name: 'Education', description: 'Learning management systems', sortOrder: 120 },
  { slug: 'finance', name: 'Finance', description: 'Accounting, budgeting, and invoicing', sortOrder: 130 },
  { slug: 'home-automation', name: 'Home Automation', description: 'Smart home hubs and controllers', sortOrder: 140 },
  { slug: 'media', name: 'Media', description: 'Photo, video, and music servers', sortOrder: 150 },
  { slug: 'monitoring', name: 'Monitoring', description: 'Uptime, metrics, and alerting', sortOrder: 160 },
  { slug: 'networking', name: 'Networking', description: 'DNS, VPN, and network services', sortOrder: 170 },
  { slug: 'productivity', name: 'Productivity', description: 'Files, notes, and personal tools', sortOrder: 180 },
  { slug: 'project-management', name: 'Project Management', description: 'Tasks, boards, and planning', sortOrder: 190 },
  { slug: 'security', name: 'Security', description: 'Secrets, identity, and access management', sortOrder: 200 },
  { slug: 'storage', name: 'Storage', description: 'Object storage and file synchronization', sortOrder: 210 },
  { slug: 'system-administration', name: 'System Administration', description: 'Infrastructure dashboards and ops tooling', sortOrder: 220 },
  { slug: 'web-hosting', name: 'Web Hosting', description: 'Hosting control panels and web serving', sortOrder: 230 },
  { slug: 'infrastructure', name: 'Infrastructure', description: 'Core platform infrastructure components', sortOrder: 240 },
];

export const CANONICAL_CATEGORY_SLUGS = CANONICAL_CATEGORIES.map((c) => c.slug);
