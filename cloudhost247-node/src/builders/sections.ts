/**
 * Website Builder section registry.
 *
 * A builder page is an ordered array of section objects, and this is the only thing that decides
 * whether a section is valid. Two properties matter more than the individual block types:
 *
 *  1. **Content can never become code.** There is no HTML, no `<script>`, no CSS, no iframe and no
 *     `javascript:` URL in any schema below. Every string is length-capped and sanitised, every URL
 *     must be `https:` (or `mailto:` for an email link), and an unknown section type or unknown
 *     property is rejected rather than stored. A page stored through this registry is safe to
 *     render as text, which is exactly what the renderer does.
 *
 *  2. **One registry, three consumers.** The editor UI reads the same catalogue to render the
 *     "add section" palette, the API validates with it, and the AI generator builds its output from
 *     it — so a generated site can never contain a section the editor cannot open or the renderer
 *     cannot draw.
 */
import { ValidationError } from '../lib/errors';

export type SectionType =
  | 'hero'
  | 'rich_text'
  | 'features'
  | 'image_text'
  | 'gallery'
  | 'cta'
  | 'pricing'
  | 'testimonials'
  | 'faq'
  | 'contact_form'
  | 'footer'
  | 'logos'
  | 'stats'
  | 'team';

export interface SectionFieldSpec {
  key: string;
  label: string;
  kind: 'text' | 'long_text' | 'url' | 'image' | 'list' | 'select' | 'boolean';
  required?: boolean;
  maxLength?: number;
  options?: readonly string[];
  itemFields?: readonly { key: string; label: string; kind: 'text' | 'long_text' | 'url' | 'image'; required?: boolean; maxLength?: number }[];
  help?: string;
}

export interface SectionDefinition {
  type: SectionType;
  label: string;
  description: string;
  group: 'structure' | 'content' | 'conversion' | 'social_proof' | 'contact';
  fields: readonly SectionFieldSpec[];
}

const TEXT = 200;
const LONG = 2000;
const SHORT = 120;
const URL_MAX = 500;

export const SECTION_REGISTRY: readonly SectionDefinition[] = [
  {
    type: 'hero',
    label: 'Hero',
    description: 'The headline block at the top of a page: title, subtitle and up to two buttons.',
    group: 'structure',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', required: true, maxLength: TEXT },
      { key: 'subheading', label: 'Subheading', kind: 'long_text', maxLength: LONG },
      { key: 'imageUrl', label: 'Background image URL', kind: 'url', maxLength: URL_MAX },
      { key: 'imageAlt', label: 'Background image alt text', kind: 'text', maxLength: SHORT },
      { key: 'align', label: 'Alignment', kind: 'select', options: ['left', 'center'] },
      {
        key: 'buttons',
        label: 'Buttons',
        kind: 'list',
        itemFields: [
          { key: 'label', label: 'Label', kind: 'text', required: true, maxLength: SHORT },
          { key: 'href', label: 'Link', kind: 'url', required: true, maxLength: URL_MAX },
          { key: 'style', label: 'Style', kind: 'text', maxLength: 20 },
        ],
      },
    ],
  },
  {
    type: 'rich_text',
    label: 'Text',
    description: 'A block of body copy with an optional heading.',
    group: 'content',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', maxLength: TEXT },
      { key: 'body', label: 'Body', kind: 'long_text', required: true, maxLength: LONG },
      { key: 'align', label: 'Alignment', kind: 'select', options: ['left', 'center'] },
    ],
  },
  {
    type: 'features',
    label: 'Feature list',
    description: 'Three to six short feature cards, each with a title and description.',
    group: 'content',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', maxLength: TEXT },
      { key: 'intro', label: 'Intro', kind: 'long_text', maxLength: LONG },
      {
        key: 'items',
        label: 'Features',
        kind: 'list',
        required: true,
        itemFields: [
          { key: 'title', label: 'Title', kind: 'text', required: true, maxLength: SHORT },
          { key: 'description', label: 'Description', kind: 'long_text', maxLength: 400 },
          { key: 'icon', label: 'Icon keyword', kind: 'text', maxLength: 40 },
        ],
      },
    ],
  },
  {
    type: 'image_text',
    label: 'Image + text',
    description: 'An image beside a paragraph — the workhorse “about” block.',
    group: 'content',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', required: true, maxLength: TEXT },
      { key: 'body', label: 'Body', kind: 'long_text', required: true, maxLength: LONG },
      { key: 'imageUrl', label: 'Image URL', kind: 'url', maxLength: URL_MAX },
      { key: 'imageAlt', label: 'Image alt text', kind: 'text', maxLength: SHORT },
      { key: 'imagePosition', label: 'Image position', kind: 'select', options: ['left', 'right'] },
      { key: 'ctaLabel', label: 'Button label', kind: 'text', maxLength: SHORT },
      { key: 'ctaHref', label: 'Button link', kind: 'url', maxLength: URL_MAX },
    ],
  },
  {
    type: 'gallery',
    label: 'Gallery',
    description: 'A grid of images with alt text.',
    group: 'content',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', maxLength: TEXT },
      { key: 'columns', label: 'Columns', kind: 'select', options: ['2', '3', '4'] },
      {
        key: 'images',
        label: 'Images',
        kind: 'list',
        required: true,
        itemFields: [
          { key: 'url', label: 'Image URL', kind: 'url', required: true, maxLength: URL_MAX },
          { key: 'alt', label: 'Alt text', kind: 'text', maxLength: SHORT },
          { key: 'caption', label: 'Caption', kind: 'text', maxLength: SHORT },
        ],
      },
    ],
  },
  {
    type: 'cta',
    label: 'Call to action',
    description: 'A single, high-contrast conversion block.',
    group: 'conversion',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', required: true, maxLength: TEXT },
      { key: 'body', label: 'Body', kind: 'long_text', maxLength: 500 },
      { key: 'buttonLabel', label: 'Button label', kind: 'text', required: true, maxLength: SHORT },
      { key: 'buttonHref', label: 'Button link', kind: 'url', required: true, maxLength: URL_MAX },
    ],
  },
  {
    type: 'pricing',
    label: 'Pricing',
    description: 'Plan cards. Amounts are text you type — the builder never invents a price.',
    group: 'conversion',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', maxLength: TEXT },
      { key: 'intro', label: 'Intro', kind: 'long_text', maxLength: LONG },
      {
        key: 'plans',
        label: 'Plans',
        kind: 'list',
        required: true,
        itemFields: [
          { key: 'name', label: 'Plan name', kind: 'text', required: true, maxLength: SHORT },
          { key: 'price', label: 'Price label', kind: 'text', required: true, maxLength: 40 },
          { key: 'period', label: 'Period label', kind: 'text', maxLength: 40 },
          { key: 'features', label: 'Features (one per line)', kind: 'long_text', maxLength: LONG },
          { key: 'ctaLabel', label: 'Button label', kind: 'text', maxLength: SHORT },
          { key: 'ctaHref', label: 'Button link', kind: 'url', maxLength: URL_MAX },
          { key: 'highlighted', label: 'Highlighted', kind: 'text', maxLength: 5 },
        ],
      },
    ],
  },
  {
    type: 'testimonials',
    label: 'Testimonials',
    description: 'Quotes with an author and role.',
    group: 'social_proof',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', maxLength: TEXT },
      {
        key: 'items',
        label: 'Quotes',
        kind: 'list',
        required: true,
        itemFields: [
          { key: 'quote', label: 'Quote', kind: 'long_text', required: true, maxLength: 600 },
          { key: 'author', label: 'Author', kind: 'text', required: true, maxLength: SHORT },
          { key: 'role', label: 'Role', kind: 'text', maxLength: SHORT },
          { key: 'avatarUrl', label: 'Avatar URL', kind: 'url', maxLength: URL_MAX },
        ],
      },
    ],
  },
  {
    type: 'logos',
    label: 'Logo strip',
    description: 'Customer or partner logos.',
    group: 'social_proof',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', maxLength: TEXT },
      {
        key: 'logos',
        label: 'Logos',
        kind: 'list',
        required: true,
        itemFields: [
          { key: 'url', label: 'Logo URL', kind: 'url', required: true, maxLength: URL_MAX },
          { key: 'alt', label: 'Alt text', kind: 'text', required: true, maxLength: SHORT },
        ],
      },
    ],
  },
  {
    type: 'stats',
    label: 'Statistics',
    description: 'A row of headline numbers you supply.',
    group: 'social_proof',
    fields: [
      {
        key: 'items',
        label: 'Statistics',
        kind: 'list',
        required: true,
        itemFields: [
          { key: 'value', label: 'Value', kind: 'text', required: true, maxLength: 24 },
          { key: 'label', label: 'Label', kind: 'text', required: true, maxLength: SHORT },
        ],
      },
    ],
  },
  {
    type: 'team',
    label: 'Team',
    description: 'People cards with a photo, name and role.',
    group: 'content',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', maxLength: TEXT },
      {
        key: 'members',
        label: 'Members',
        kind: 'list',
        required: true,
        itemFields: [
          { key: 'name', label: 'Name', kind: 'text', required: true, maxLength: SHORT },
          { key: 'role', label: 'Role', kind: 'text', maxLength: SHORT },
          { key: 'bio', label: 'Bio', kind: 'long_text', maxLength: 400 },
          { key: 'photoUrl', label: 'Photo URL', kind: 'url', maxLength: URL_MAX },
        ],
      },
    ],
  },
  {
    type: 'faq',
    label: 'FAQ',
    description: 'Question and answer pairs — also emitted as FAQ structured data.',
    group: 'content',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', maxLength: TEXT },
      {
        key: 'items',
        label: 'Questions',
        kind: 'list',
        required: true,
        itemFields: [
          { key: 'question', label: 'Question', kind: 'text', required: true, maxLength: 300 },
          { key: 'answer', label: 'Answer', kind: 'long_text', required: true, maxLength: LONG },
        ],
      },
    ],
  },
  {
    type: 'contact_form',
    label: 'Contact form',
    description: 'One of this site’s forms. Submissions land in your Unified Inbox.',
    group: 'contact',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', maxLength: TEXT },
      { key: 'body', label: 'Intro', kind: 'long_text', maxLength: 600 },
      { key: 'formId', label: 'Form', kind: 'text', required: true, maxLength: 64 },
    ],
  },
  {
    type: 'footer',
    label: 'Footer',
    description: 'Site footer with link columns and a legal line.',
    group: 'structure',
    fields: [
      { key: 'about', label: 'About text', kind: 'long_text', maxLength: 600 },
      { key: 'copyright', label: 'Copyright line', kind: 'text', maxLength: TEXT },
      {
        key: 'columns',
        label: 'Link columns',
        kind: 'list',
        itemFields: [
          { key: 'title', label: 'Column title', kind: 'text', required: true, maxLength: SHORT },
          { key: 'links', label: 'Links (label | url, one per line)', kind: 'long_text', maxLength: LONG },
        ],
      },
    ],
  },
];

const BY_TYPE = new Map(SECTION_REGISTRY.map((definition) => [definition.type, definition]));

export function sectionDefinition(type: string): SectionDefinition | undefined {
  return BY_TYPE.get(type as SectionType);
}

export function listSections(): readonly SectionDefinition[] {
  return SECTION_REGISTRY;
}

export interface StoredSection {
  id: string;
  type: SectionType;
  props: Record<string, unknown>;
}

/** Allowed link schemes. Everything else — including `javascript:` and `data:` — is rejected. */
const SAFE_HREF = /^(https:\/\/[^\s<>"']{1,480}|mailto:[^\s<>"'@]{1,64}@[^\s<>"']{1,190}|\/[^\s<>"']{0,300}|#[A-Za-z0-9_-]{0,60})$/;
const SAFE_IMAGE = /^https:\/\/[^\s<>"']{1,480}$/;

/** Strips control characters and the angle brackets that would let a value pretend to be markup. */
export function sanitizeText(value: string, maxLength: number): string {
  const stripped = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\r\n/g, '\n');
  return stripped.slice(0, maxLength);
}

function assertUrl(value: string, field: string, image: boolean): string {
  const trimmed = value.trim();
  const pattern = image ? SAFE_IMAGE : SAFE_HREF;
  if (!pattern.test(trimmed)) {
    throw new ValidationError(
      image
        ? `${field} must be an https:// image URL`
        : `${field} must be an https:// link, an internal /path, a mailto: address or an #anchor`
    );
  }
  return trimmed;
}

function coerceField(
  spec: SectionFieldSpec,
  value: unknown,
  limit: number
): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  switch (spec.kind) {
    case 'text':
    case 'long_text': {
      if (typeof value !== 'string') throw new ValidationError(`${spec.label} must be text`);
      return sanitizeText(value, Math.min(spec.maxLength ?? LIMIT_DEFAULT, limit));
    }
    case 'url': {
      if (typeof value !== 'string') throw new ValidationError(`${spec.label} must be a URL`);
      return assertUrl(value, spec.label, spec.key.toLowerCase().includes('image') || spec.key.toLowerCase().includes('avatar') || spec.key.toLowerCase().includes('photo') || spec.key.toLowerCase().includes('logo'));
    }
    case 'image': {
      if (typeof value !== 'string') throw new ValidationError(`${spec.label} must be an image URL`);
      return assertUrl(value, spec.label, true);
    }
    case 'select': {
      if (typeof value !== 'string' || !(spec.options ?? []).includes(value)) {
        throw new ValidationError(`${spec.label} must be one of: ${(spec.options ?? []).join(', ')}`);
      }
      return value;
    }
    case 'boolean':
      return value === true || value === 'true';
    case 'list': {
      if (!Array.isArray(value)) throw new ValidationError(`${spec.label} must be a list`);
      if (value.length > limit) throw new ValidationError(`${spec.label} cannot contain more than ${limit} items`);
      return value.map((entry) => {
        if (!entry || typeof entry !== 'object') throw new ValidationError(`${spec.label} items must be objects`);
        const record = entry as Record<string, unknown>;
        const item: Record<string, unknown> = {};
        for (const itemSpec of spec.itemFields ?? []) {
          const coerced = coerceField(itemSpec as SectionFieldSpec, record[itemSpec.key], limit);
          if (coerced === undefined) continue;
          if (itemSpec.required && (coerced === '' || coerced === undefined)) {
            throw new ValidationError(`${spec.label}: ${itemSpec.label} is required`);
          }
          item[itemSpec.key] = coerced;
        }
        for (const itemSpec of spec.itemFields ?? []) {
          if (itemSpec.required && item[itemSpec.key] === undefined) {
            throw new ValidationError(`${spec.label}: ${itemSpec.label} is required`);
          }
        }
        // Unknown keys are dropped rather than stored — the schema is the contract.
        return item;
      });
    }
    default:
      throw new ValidationError(`${spec.label} uses an unsupported field kind`);
  }
}

const LIMIT_DEFAULT = LONG;

/**
 * Validates and sanitises one section. Throws ValidationError with a message that names the field,
 * so the editor can point at it. Anything not in the registry is rejected outright.
 */
export function validateSection(input: unknown): StoredSection {
  if (!input || typeof input !== 'object') throw new ValidationError('Each section must be an object');
  const record = input as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : '';
  const definition = sectionDefinition(type);
  if (!definition) {
    throw new ValidationError(`Unknown section type "${type || '(missing)'}"`);
  }

  const props: Record<string, unknown> = {};
  const rawProps = (record.props ?? {}) as Record<string, unknown>;
  for (const spec of definition.fields) {
    const coerced = coerceField(spec, rawProps[spec.key], spec.kind === 'list' ? LIMIT_LIST : LIMIT_DEFAULT);
    if (coerced === undefined) {
      if (spec.required) throw new ValidationError(`${definition.label}: ${spec.label} is required`);
      continue;
    }
    props[spec.key] = coerced;
  }

  const id = typeof record.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(record.id) ? record.id : randomSectionId();
  return { id, type: definition.type, props };
}

/** Per-list item cap: enough for every real page, small enough to bound a stored document. */
const LIMIT_LIST = 24;

export function randomSectionId(): string {
  // Section ids only need to be unique within a page; a short random suffix keeps stored documents
  // readable and diffs stable.
  return `s${Math.random().toString(36).slice(2, 10)}`;
}

export function validateSections(input: unknown): StoredSection[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new ValidationError('Page content must be a list of sections');
  if (input.length > 60) throw new ValidationError('A page cannot contain more than 60 sections');
  const sections = input.map(validateSection);
  const ids = new Set(sections.map((section) => section.id));
  if (ids.size !== sections.length) throw new ValidationError('Section ids must be unique within a page');
  return sections;
}

/** Page-level SEO, validated with the same "no markup, no code" rule as section content. */
export interface PageSeo {
  title?: string;
  description?: string;
  ogImageUrl?: string;
  canonicalPath?: string;
  noIndex?: boolean;
  keywords?: string[];
}

export function validateSeo(input: unknown): PageSeo {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object') throw new ValidationError('SEO settings must be an object');
  const record = input as Record<string, unknown>;
  const seo: PageSeo = {};
  if (typeof record.title === 'string' && record.title.trim()) seo.title = sanitizeText(record.title, 70);
  if (typeof record.description === 'string' && record.description.trim()) {
    seo.description = sanitizeText(record.description, 160);
  }
  if (typeof record.ogImageUrl === 'string' && record.ogImageUrl.trim()) {
    seo.ogImageUrl = assertUrl(record.ogImageUrl, 'Open Graph image URL', true);
  }
  if (typeof record.canonicalPath === 'string' && record.canonicalPath.trim()) {
    const value = record.canonicalPath.trim();
    if (!/^\/[A-Za-z0-9._~/-]{0,180}$/.test(value)) {
      throw new ValidationError('Canonical path must be a site-relative path starting with /');
    }
    seo.canonicalPath = value;
  }
  if (record.noIndex === true) seo.noIndex = true;
  if (Array.isArray(record.keywords)) {
    seo.keywords = record.keywords
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .slice(0, 12)
      .map((entry) => sanitizeText(entry, 40));
  }
  return seo;
}
