/**
 * AI Website Builder — provider abstraction.
 *
 * The abstraction exists for the same reason the Domain Services adapter boundary does: so the
 * platform can change (or add) a model vendor without touching the project, usage, review or
 * apply-to-site code, and so an unconfigured deployment fails closed with a specific, honest
 * reason.
 *
 * Two engines implement it:
 *   - `rules`   — the native, deterministic generator (src/builders/ai/rules-provider.ts). It is
 *                 always available and never claims to be a model.
 *   - `llm`     — an external chat-completion provider (OpenAI-compatible or Anthropic-compatible)
 *                 that is only usable once an administrator has stored credentials. Without them
 *                 the registry reports CONFIGURATION_REQUIRED; nothing is ever generated in its
 *                 place, and no error is hidden behind a silent fallback.
 *
 * Every provider returns the SAME structured plan shape, which is validated against the section
 * registry before it is stored — so a model response can never introduce a section, a URL scheme or
 * a piece of markup the platform does not support.
 */
import type { PageSeo, StoredSection } from '../sections';

export type AiEngine = 'rules' | 'llm' | 'anthropic';

export interface SiteBrief {
  /** What the site is for, in the customer's own words. The only source of factual copy. */
  businessName: string;
  industry?: string;
  description: string;
  audience?: string;
  goals?: string[];
  tone?: string;
  pages?: string[];
  language?: string;
  keywords?: string[];
}

export interface GeneratedPage {
  title: string;
  path: string;
  isHome: boolean;
  seo: PageSeo;
  sections: StoredSection[];
}

export interface GeneratedImageSuggestion {
  sectionKey: string;
  description: string;
  searchTerms: string[];
}

export interface GeneratedSitePlan {
  name: string;
  summary: string;
  theme: { primary: string; accent: string; font?: string };
  pages: GeneratedPage[];
  imageSuggestions: GeneratedImageSuggestion[];
  /** Which engine produced this plan, so the UI can say so truthfully. */
  engine: AiEngine;
  engineLabel: string;
}

export interface GenerationContext {
  brief: SiteBrief;
  /** Called by providers that want to log a provider-side reference for support. */
  onProviderReference?: (reference: string) => void;
}

export interface SiteGenerationProvider {
  engine: AiEngine;
  label: string;
  /** Whether the provider can run right now. `reason` is shown to the customer/admin verbatim. */
  isConfigured(): { configured: boolean; reason: string | null };
  generate(context: GenerationContext): Promise<GeneratedSitePlan>;
}

export type AiProviderErrorCode =
  | 'CONFIGURATION_REQUIRED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'PROVIDER_ERROR'
  | 'ALLOWANCE_EXCEEDED';

export class AiProviderError extends Error {
  constructor(
    public readonly code: AiProviderErrorCode,
    message: string,
    public readonly retryable = false
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** A safe, customer-facing message for each failure class. Never includes provider internals. */
export function safeAiMessage(error: AiProviderError): string {
  switch (error.code) {
    case 'CONFIGURATION_REQUIRED':
      return 'The AI website generator needs an administrator to connect a model provider before it can be used. The built-in generator is available now.';
    case 'ALLOWANCE_EXCEEDED':
      return 'Your monthly AI generation allowance has been reached. You can upgrade your plan or use the built-in generator.';
    case 'RATE_LIMITED':
      return 'The model provider is rate limiting requests right now. Please try again in a few minutes.';
    case 'TIMEOUT':
      return 'The model provider took too long to respond. Please try again.';
    case 'INVALID_RESPONSE':
      return 'The model provider returned a response this platform could not use. The attempt was recorded and no site content was changed.';
    default:
      return 'The model provider is temporarily unavailable. The attempt was recorded and no site content was changed.';
  }
}
