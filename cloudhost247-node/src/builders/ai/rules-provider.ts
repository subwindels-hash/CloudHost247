/**
 * The native ("rules") site generator.
 *
 * This is a real generator, not a stand-in for one: it composes a complete, publishable site plan —
 * pages, sections, headings, body copy, calls to action, SEO metadata and image suggestions — from
 * the customer's brief, using the section registry as its only vocabulary. It is deterministic, so
 * the same brief always yields the same plan, and it runs with no external service.
 *
 * What it deliberately does NOT do is invent facts. Every factual sentence in its output comes from
 * the brief the customer typed (their business name, industry, description, audience, goals,
 * differentiators). Where the brief is silent, the generator emits a clearly-worded instruction
 * ("Describe what you offer…") rather than a plausible-sounding fabrication — no invented
 * testimonials, statistics, client names, certifications or prices ever appear in generated
 * content. That is also why the plan it returns carries `engine: 'rules'` and the label
 * "Built-in generator", and why the UI shows that label next to the result.
 */
import { sanitizeText, validateSection, validateSeo, type StoredSection } from '../sections';
import type { GeneratedImageSuggestion, GeneratedPage, GeneratedSitePlan, SiteBrief, SiteGenerationProvider } from './types';

const PALETTES: Record<string, { primary: string; accent: string }> = {
  technology: { primary: '#0756d8', accent: '#22d3ee' },
  logistics: { primary: '#0f3d6e', accent: '#f59e0b' },
  health: { primary: '#0e7490', accent: '#34d399' },
  finance: { primary: '#1e3a8a', accent: '#10b981' },
  retail: { primary: '#b91c1c', accent: '#f59e0b' },
  creative: { primary: '#7c3aed', accent: '#f472b6' },
  education: { primary: '#1d4ed8', accent: '#facc15' },
  default: { primary: '#0756d8', accent: '#12b886' },
};

function paletteFor(industry: string | undefined): { primary: string; accent: string } {
  const fallback = PALETTES.default!;
  if (!industry) return fallback;
  const key = industry.toLowerCase();
  for (const [name, palette] of Object.entries(PALETTES)) {
    if (name !== 'default' && key.includes(name)) return palette;
  }
  return fallback;
}

function sentence(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => (word.length > 2 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** Strips an article/possessive so "an international logistics company" reads well inline. */
function descriptor(brief: SiteBrief): string {
  const industry = brief.industry?.trim();
  const description = brief.description.trim();
  if (description) return sentence(description);
  if (industry) return `A ${industry.toLowerCase()} business.`;
  return '';
}

function goalsList(brief: SiteBrief): string[] {
  return (brief.goals ?? []).map((goal) => sanitizeText(goal, 160)).filter(Boolean);
}

function section(type: string, props: Record<string, unknown>): StoredSection {
  return validateSection({ type, props });
}

function homePage(brief: SiteBrief): GeneratedPage {
  const name = sanitizeText(brief.businessName, 160);
  const intro = descriptor(brief);
  const audience = brief.audience ? sanitizeText(brief.audience, 200) : '';
  const goals = goalsList(brief);

  const subheadingParts = [intro];
  if (audience) subheadingParts.push(`Built for ${audience.replace(/^(for|to)\s+/i, '')}.`);
  if (goals.length) subheadingParts.push(`Focused on ${goals.slice(0, 2).join(' and ').toLowerCase()}.`);

  const sections: StoredSection[] = [
    section('hero', {
      heading: name,
      subheading: subheadingParts.filter(Boolean).join(' ') || `Welcome to ${name}. Replace this line with what you do and who you do it for.`,
      align: 'center',
      buttons: [
        { label: 'Contact us', href: '/contact' },
        { label: 'Our services', href: '/services', style: 'secondary' },
      ],
    }),
  ];

  if (intro || audience) {
    sections.push(
      section('image_text', {
        heading: `About ${name}`,
        body:
          [sentence(brief.description), audience ? `We work with ${audience.replace(/^(for|to)\s+/i, '')}.` : '']
            .filter(Boolean)
            .join(' ') || `Describe ${name} here — when it started, what it is known for, and who it serves.`,
        imagePosition: 'right',
      })
    );
  }

  sections.push(
    section('features', {
      heading: 'What we offer',
      intro: 'Replace these cards with your real services and the outcome each one delivers.',
      items: [
        { title: 'Service one', description: `Describe the ${brief.industry ? brief.industry.toLowerCase() : ''} service you lead with, and who it is for.`.replace(/\s+/g, ' ') },
        { title: 'Service two', description: 'Describe the next service, and the problem it solves.' },
        { title: 'Service three', description: 'Describe the third service, or remove this card.' },
      ],
    })
  );

  sections.push(
    section('cta', {
      heading: `Work with ${name}`,
      body: 'Tell us what you need and we will reply with the next step.',
      buttonLabel: 'Get in touch',
      buttonHref: '/contact',
    })
  );

  sections.push(
    section('footer', {
      copyright: `© ${new Date().getFullYear()} ${name}`,
      about: sentence(brief.description).slice(0, 300) || `A short line about ${name}.`,
    })
  );

  return {
    title: 'Home',
    path: '/',
    isHome: true,
    seo: validateSeo({
      title: `${name}${brief.industry ? ` — ${titleCase(brief.industry)}` : ''}`,
      description:
        sentence(brief.description).slice(0, 155) ||
        `${name}${brief.industry ? ` is a ${brief.industry.toLowerCase()} business` : ''}. Contact us to find out more.`,
      keywords: brief.keywords ?? [],
    }),
    sections,
  };
}

function aboutPage(brief: SiteBrief): GeneratedPage {
  const name = sanitizeText(brief.businessName, 160);
  const audience = brief.audience ? sanitizeText(brief.audience, 200) : '';
  return {
    title: 'About',
    path: '/about',
    isHome: false,
    seo: validateSeo({ title: `About ${name}`, description: `Who ${name} is, how it works, and who it serves.` }),
    sections: [
      section('rich_text', {
        heading: `About ${name}`,
        body:
          [sentence(brief.description), audience ? `We work with ${audience.replace(/^(for|to)\s+/i, '')}.` : '']
            .filter(Boolean)
            .join(' ') || `Write a short paragraph about ${name} — its history, its team and what it stands for.`,
      }),
      section('features', {
        heading: 'How we work',
        items: [
          { title: 'First step', description: 'Describe how an engagement starts.' },
          { title: 'Second step', description: 'Describe what happens next.' },
          { title: 'Third step', description: 'Describe how it finishes and what support follows.' },
        ],
      }),
      section('cta', {
        heading: 'Talk to us',
        body: 'Tell us about your project and we will tell you honestly whether we are the right fit.',
        buttonLabel: 'Contact us',
        buttonHref: '/contact',
      }),
      section('footer', { copyright: `© ${new Date().getFullYear()} ${name}` }),
    ],
  };
}

function servicesPage(brief: SiteBrief): GeneratedPage {
  const name = sanitizeText(brief.businessName, 160);
  const goals = goalsList(brief);
  return {
    title: 'Services',
    path: '/services',
    isHome: false,
    seo: validateSeo({ title: `Services — ${name}`, description: `The services ${name} provides, and what each one includes.` }),
    sections: [
      section('rich_text', {
        heading: 'Our services',
        body: goals.length
          ? `Each service below is written to deliver on what matters to you: ${goals.join(', ')}.`
          : 'List what you offer. Replace this paragraph, then edit each card below.',
      }),
      section('features', {
        heading: 'What we do',
        items: [
          { title: 'Service one', description: 'What it includes, and how long it takes.' },
          { title: 'Service two', description: 'What it includes, and who it suits.' },
          { title: 'Service three', description: 'What it includes, and what it costs from.' },
        ],
      }),
      section('faq', {
        heading: 'Questions we are asked',
        items: [
          { question: 'How do we get started?', answer: 'Describe your first step — a call, a form, a proposal.' },
          { question: 'How is pricing structured?', answer: 'State your real pricing model. The builder never invents a price for you.' },
        ],
      }),
      section('cta', {
        heading: 'Request a quote',
        body: 'Send us the details and we will come back with a clear scope.',
        buttonLabel: 'Request a quote',
        buttonHref: '/contact',
      }),
      section('footer', { copyright: `© ${new Date().getFullYear()} ${name}` }),
    ],
  };
}

function contactPage(brief: SiteBrief): GeneratedPage {
  const name = sanitizeText(brief.businessName, 160);
  return {
    title: 'Contact',
    path: '/contact',
    isHome: false,
    seo: validateSeo({ title: `Contact ${name}`, description: `Get in touch with ${name}.` }),
    sections: [
      section('rich_text', {
        heading: 'Contact us',
        body: `Tell us what you need and we will reply as soon as we can. Replace this text with your real response time and contact details.`,
      }),
      section('contact_form', {
        heading: 'Send a message',
        body: 'Submissions arrive in your CloudHost247 Unified Inbox, so nothing gets lost.',
        // Replaced with the site's real form id when the plan is applied (see generation-service).
        formId: 'REPLACE_WITH_FORM_ID',
      }),
      section('footer', { copyright: `© ${new Date().getFullYear()} ${name}` }),
    ],
  };
}

const PAGE_BUILDERS: Record<string, (brief: SiteBrief) => GeneratedPage> = {
  home: homePage,
  about: aboutPage,
  services: servicesPage,
  contact: contactPage,
};

export function buildRulesPlan(brief: SiteBrief): GeneratedSitePlan {
  const requested = (brief.pages && brief.pages.length ? brief.pages : ['home', 'about', 'services', 'contact'])
    .map((page) => page.toLowerCase().replace(/[^a-z]/g, ''))
    .filter((page, index, all) => PAGE_BUILDERS[page] && all.indexOf(page) === index);

  const wanted = requested.length ? requested : ['home'];
  const pages = wanted.map((page) => PAGE_BUILDERS[page]!(brief));
  const name = sanitizeText(brief.businessName, 160);

  const imageSuggestions: GeneratedImageSuggestion[] = [
    {
      sectionKey: 'hero',
      description: `A wide, professional photograph representing ${brief.industry ? brief.industry.toLowerCase() : 'your business'} — bright, uncluttered, with room for headline text.`,
      searchTerms: [brief.industry ?? 'business', 'team at work', 'office environment'].filter(Boolean),
    },
    {
      sectionKey: 'about',
      description: 'A real photograph of your team, premises or work in progress. Real photos outperform stock every time.',
      searchTerms: ['team portrait', 'workspace', 'customer meeting'],
    },
  ];

  return {
    name: `${name} website`,
    summary: [
      `${pages.length} page${pages.length === 1 ? '' : 's'} generated from your brief.`,
      'All copy is drawn from what you told us — edit any section to make it yours.',
      'Add your own photographs: the placeholder image slots are listed with suggestions.',
    ].join(' '),
    theme: paletteFor(brief.industry),
    pages,
    imageSuggestions,
    engine: 'rules',
    engineLabel: 'Built-in generator',
  };
}

export const rulesProvider: SiteGenerationProvider = {
  engine: 'rules',
  label: 'Built-in generator',
  isConfigured: () => ({ configured: true, reason: null }),
  async generate({ brief }) {
    return buildRulesPlan(brief);
  },
};
