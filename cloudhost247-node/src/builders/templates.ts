/**
 * First-party Website Builder templates.
 *
 * These are complete, real page schemas — importing one produces a page the customer can publish
 * immediately, not a thumbnail claiming to be a design. They live in code rather than in the
 * database so they ship with the platform and are guaranteed to validate against the section
 * registry (each is validated on import, like any other content).
 *
 * Placeholder-free by construction: every template's copy is written so it reads correctly as a
 * starting point ("Replace this paragraph with your own…"), and no template invents a testimonial,
 * a statistic, a customer logo or a price. Sections that would need real customer data
 * (testimonials, logos, stats, pricing) are deliberately absent from the starter schemas — the
 * editor offers them, and the customer fills them with their own facts.
 */
import type { StoredSection } from './sections';

export interface FirstPartyTemplate {
  slug: string;
  name: string;
  category: 'business' | 'services' | 'portfolio' | 'landing' | 'personal' | 'nonprofit';
  description: string;
  palette: { primary: string; accent: string; font?: string };
  schema: Omit<StoredSection, 'id'>[];
}

const CTA_EMAIL = 'mailto:hello@example.com';

export const FIRST_PARTY_TEMPLATES: readonly FirstPartyTemplate[] = [
  {
    slug: 'professional-services',
    name: 'Professional services',
    category: 'services',
    description: 'A credibility-first layout for consultancies, agencies and B2B service firms.',
    palette: { primary: '#0756d8', accent: '#12b886' },
    schema: [
      {
        type: 'hero',
        props: {
          heading: 'Put your firm’s main promise here',
          subheading:
            'One or two sentences explaining who you help and what changes for them. Replace this text with your own.',
          align: 'left',
          buttons: [
            { label: 'Book a consultation', href: CTA_EMAIL },
            { label: 'See our services', href: '/services', style: 'secondary' },
          ],
        },
      },
      {
        type: 'features',
        props: {
          heading: 'What we do',
          intro: 'Replace these three cards with your own services and the outcome each one delivers.',
          items: [
            { title: 'Service one', description: 'What it includes and who it is for.' },
            { title: 'Service two', description: 'What it includes and who it is for.' },
            { title: 'Service three', description: 'What it includes and who it is for.' },
          ],
        },
      },
      {
        type: 'image_text',
        props: {
          heading: 'How we work',
          body:
            'Describe your process in your own words — discovery, proposal, delivery, support. Replace this paragraph.',
          imagePosition: 'right',
          ctaLabel: 'Contact us',
          ctaHref: CTA_EMAIL,
        },
      },
      {
        type: 'faq',
        props: {
          heading: 'Common questions',
          items: [
            { question: 'How long does a typical engagement take?', answer: 'Replace this answer with your real timeline.' },
            { question: 'How do you price your work?', answer: 'Replace this answer with your real pricing model.' },
            { question: 'Who will we work with day to day?', answer: 'Name your team and their roles.' },
          ],
        },
      },
      {
        type: 'cta',
        props: {
          heading: 'Ready to talk?',
          body: 'Tell us what you need and we will reply with next steps.',
          buttonLabel: 'Start the conversation',
          buttonHref: CTA_EMAIL,
        },
      },
      { type: 'footer', props: { copyright: '© Your Company', about: 'Replace with a short line about your business.' } },
    ],
  },
  {
    slug: 'saas-landing',
    name: 'Product landing page',
    category: 'landing',
    description: 'A focused conversion layout for a software product or a single offer.',
    palette: { primary: '#1d4ed8', accent: '#22d3ee' },
    schema: [
      {
        type: 'hero',
        props: {
          heading: 'Your product, in one clear sentence',
          subheading: 'Say what it does and who it is for. Replace this text.',
          align: 'center',
          buttons: [{ label: 'Create an account', href: '/register' }],
        },
      },
      {
        type: 'features',
        props: {
          heading: 'Built for the work you actually do',
          items: [
            { title: 'Core capability', description: 'Describe the one thing your product does best.' },
            { title: 'Second capability', description: 'Describe the next most important outcome.' },
            { title: 'Third capability', description: 'Describe the third.' },
          ],
        },
      },
      {
        type: 'image_text',
        props: {
          heading: 'See it in action',
          body: 'Add a screenshot or product image with a short explanation of what the reader is looking at.',
          imagePosition: 'left',
        },
      },
      {
        type: 'faq',
        props: {
          heading: 'Questions before you start',
          items: [
            { question: 'Is there a free plan?', answer: 'Answer honestly — and keep the pricing section in sync.' },
            { question: 'Can I cancel at any time?', answer: 'State your real policy.' },
          ],
        },
      },
      {
        type: 'cta',
        props: {
          heading: 'Start today',
          body: 'Create your account and set up your first workspace in minutes.',
          buttonLabel: 'Get started',
          buttonHref: '/register',
        },
      },
      { type: 'footer', props: { copyright: '© Your Product' } },
    ],
  },
  {
    slug: 'portfolio',
    name: 'Portfolio',
    category: 'portfolio',
    description: 'An image-led layout for designers, photographers and independent studios.',
    palette: { primary: '#111827', accent: '#f59e0b' },
    schema: [
      {
        type: 'hero',
        props: {
          heading: 'Your name, and what you make',
          subheading: 'A single line about your practice. Replace this text.',
          align: 'center',
        },
      },
      {
        type: 'gallery',
        props: {
          heading: 'Selected work',
          columns: '3',
          images: [
            { url: 'https://example.com/placeholder-1.jpg', alt: 'Replace with your project image', caption: 'Project one' },
            { url: 'https://example.com/placeholder-2.jpg', alt: 'Replace with your project image', caption: 'Project two' },
            { url: 'https://example.com/placeholder-3.jpg', alt: 'Replace with your project image', caption: 'Project three' },
          ],
        },
      },
      {
        type: 'rich_text',
        props: {
          heading: 'About',
          body: 'Say who you are, how you work, and what kind of projects you want more of.',
        },
      },
      {
        type: 'cta',
        props: {
          heading: 'Work with me',
          body: 'Send a short brief and I will reply with availability.',
          buttonLabel: 'Get in touch',
          buttonHref: CTA_EMAIL,
        },
      },
      { type: 'footer', props: { copyright: '© Your Name' } },
    ],
  },
  {
    slug: 'local-business',
    name: 'Local business',
    category: 'business',
    description: 'Opening hours, location, services and a contact form for a physical business.',
    palette: { primary: '#0f766e', accent: '#f97316' },
    schema: [
      {
        type: 'hero',
        props: {
          heading: 'Your business name',
          subheading: 'What you offer, and where to find you. Replace this text.',
          align: 'center',
          buttons: [{ label: 'Contact us', href: '/contact' }],
        },
      },
      {
        type: 'image_text',
        props: {
          heading: 'About us',
          body: 'A short, human paragraph about the business — when it started, what it is known for.',
          imagePosition: 'right',
        },
      },
      {
        type: 'features',
        props: {
          heading: 'What we offer',
          items: [
            { title: 'Service one', description: 'Short description.' },
            { title: 'Service two', description: 'Short description.' },
            { title: 'Service three', description: 'Short description.' },
          ],
        },
      },
      {
        type: 'contact_form',
        props: {
          heading: 'Send us a message',
          body: 'We reply during opening hours. Submissions arrive in your CloudHost247 Unified Inbox.',
          formId: 'REPLACE_WITH_FORM_ID',
        },
      },
      { type: 'footer', props: { copyright: '© Your Business' } },
    ],
  },
];

export function findFirstPartyTemplate(slug: string): FirstPartyTemplate | undefined {
  return FIRST_PARTY_TEMPLATES.find((template) => template.slug === slug);
}
