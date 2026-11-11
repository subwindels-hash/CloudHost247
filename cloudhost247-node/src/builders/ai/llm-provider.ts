/**
 * External LLM site-generation provider.
 *
 * Supports an OpenAI-compatible `/chat/completions` endpoint and an Anthropic-compatible
 * `/v1/messages` endpoint, because those two shapes cover every mainstream vendor and every
 * self-hosted gateway (vLLM, Ollama, LiteLLM, OpenRouter…). Vendor choice is therefore
 * configuration — `AI_LLM_API_STYLE`, `AI_LLM_BASE_URL`, `AI_LLM_API_KEY`, `AI_LLM_MODEL` — not
 * code.
 *
 * Fail-closed rules, identical in spirit to the Domain Services adapters:
 *
 *   - No credentials → `isConfigured()` is false and `generate()` throws CONFIGURATION_REQUIRED.
 *     There is no silent fallback to the built-in generator: a customer who asked for a model must
 *     be told the model is unavailable, not handed something else labelled as one.
 *   - The response is parsed as JSON and then passed through the SAME section validator as
 *     hand-authored content. A model that returns HTML, an unknown section, a `javascript:` URL or
 *     a 50 kB paragraph is rejected — the failure is recorded, nothing is written, and the
 *     customer sees a specific message.
 *   - Timeouts and rate limits are classified, not swallowed, so the ledger shows what happened and
 *     the admin console can report it.
 */
import { providerEndpoint } from './provider-endpoint';
import { sanitizeText, validateSeo, validateSections, type StoredSection } from '../sections';
import {
  AiProviderError,
  type GeneratedPage,
  type GeneratedSitePlan,
  type SiteGenerationProvider,
} from './types';

export interface LlmProviderConfig {
  apiStyle: 'openai' | 'anthropic';
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  timeoutMs?: number;
}

const SYSTEM_PROMPT = `You are the CloudHost247 AI Website Builder. You return a complete website plan as STRICT JSON.
Rules you must follow:
- Return JSON only. No markdown, no commentary, no code fences.
- Never invent facts about the business: no testimonials, no statistics, no client names, no awards, no prices.
  If information is missing, write clearly-worded guidance text the owner can replace.
- Use only these section types, with exactly these properties:
  hero{heading,subheading,align,imageUrl,imageAlt,buttons[{label,href,style}]}
  rich_text{heading,body,align}
  features{heading,intro,items[{title,description,icon}]}
  image_text{heading,body,imageUrl,imageAlt,imagePosition,ctaLabel,ctaHref}
  gallery{heading,columns,images[{url,alt,caption}]}
  cta{heading,body,buttonLabel,buttonHref}
  faq{heading,items[{question,answer}]}
  contact_form{heading,body,formId}
  footer{about,copyright,columns[{title,links}]}
- URLs must be https:// links, internal /paths, mailto: addresses or #anchors. Never javascript:.
- Each page ends with a footer section.`;
const OUTPUT_SHAPE = `{
  "name": string,
  "summary": string,
  "theme": { "primary": "#RRGGBB", "accent": "#RRGGBB" },
  "pages": [ { "title": string, "path": "/...", "isHome": boolean,
               "seo": { "title": string, "description": string, "keywords": [string] },
               "sections": [ { "type": "...", "props": { ... } } ] } ],
  "imageSuggestions": [ { "sectionKey": string, "description": string, "searchTerms": [string] } ]
}`;

/** Provider bodies may echo prompts or secrets. Never persist them in generation errors. */
function classifyHttpStatus(status: number): AiProviderError {
  const error = status === 429
    ? new AiProviderError('RATE_LIMITED', 'Provider rate limited the request', true)
    : status === 401 || status === 403
      ? new AiProviderError('CONFIGURATION_REQUIRED', 'Provider authentication or permissions need attention')
      : status === 413
        ? new AiProviderError('REQUEST_TOO_LARGE', 'Provider input limit exceeded')
        : status === 400 || status === 422
          ? new AiProviderError('INVALID_REQUEST', 'Provider did not accept the request contract')
          : status === 404
            ? new AiProviderError('CONFIGURATION_REQUIRED', 'Provider endpoint or model was not found')
            : new AiProviderError('PROVIDER_ERROR', 'Provider request failed', status >= 500 && status <= 599);
  error.httpStatus = status;
  return error;
}

export function createLlmProvider(config: LlmProviderConfig): SiteGenerationProvider {
  const label = config.model ? `External model (${config.model})` : 'External model';

  return {
    engine: config.apiStyle === 'anthropic' ? 'anthropic' : 'llm',
    label,
    isConfigured() {
      if (!config.baseUrl) {
        return { configured: false, reason: 'No model endpoint is configured (AI_LLM_BASE_URL).' };
      }
      if (!config.apiKey) {
        return { configured: false, reason: 'No model API key is configured (AI_LLM_API_KEY).' };
      }
      if (!config.model) {
        return { configured: false, reason: 'No model name is configured (AI_LLM_MODEL).' };
      }
      try {
        providerEndpoint(config.baseUrl, config.apiStyle);
      } catch {
        return { configured: false, reason: 'The model endpoint must be a valid HTTP(S) API root without credentials, query or fragment.' };
      }
      return { configured: true, reason: null };
    },

    async generate({ brief, onProviderReference }) {
      const configuration = this.isConfigured();
      if (!configuration.configured) {
        throw new AiProviderError('CONFIGURATION_REQUIRED', configuration.reason ?? 'Model provider is not configured');
      }

      const userPrompt = [
        `Business name: ${brief.businessName}`,
        brief.industry ? `Industry: ${brief.industry}` : '',
        `What the business does: ${brief.description}`,
        brief.audience ? `Audience: ${brief.audience}` : '',
        brief.goals?.length ? `Goals: ${brief.goals.join('; ')}` : '',
        brief.tone ? `Tone: ${brief.tone}` : '',
        brief.language ? `Language: ${brief.language}` : '',
        brief.keywords?.length ? `Keywords: ${brief.keywords.join(', ')}` : '',
        `Pages to produce: ${(brief.pages?.length ? brief.pages : ['home', 'about', 'services', 'contact']).join(', ')}`,
        '',
        `Return JSON in exactly this shape: ${OUTPUT_SHAPE}`,
      ]
        .filter(Boolean)
        .join('\n');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 60_000);

      try {
        const url = providerEndpoint(config.baseUrl!, config.apiStyle);
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (config.apiStyle === 'anthropic') {
          headers['x-api-key'] = config.apiKey!;
          headers['anthropic-version'] = '2023-06-01';
        } else {
          headers.authorization = `Bearer ${config.apiKey}`;
        }
        const payload =
          config.apiStyle === 'anthropic'
            ? {
                model: config.model,
                max_tokens: 8000,
                system: SYSTEM_PROMPT,
                messages: [{ role: 'user', content: userPrompt }],
              }
            : {
                model: config.model,
                temperature: 0.4,
                response_format: { type: 'json_object' },
                messages: [
                  { role: 'system', content: SYSTEM_PROMPT },
                  { role: 'user', content: userPrompt },
                ],
              };

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          // Discard, rather than retain, an untrusted error body that may contain private input.
          await response.body?.cancel().catch(() => undefined);
          throw classifyHttpStatus(response.status);
        }

        let json: Record<string, unknown>;
        let text: string;
        try {
          const parsed: unknown = await response.json();
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid envelope');
          json = parsed as Record<string, unknown>;
          const content = config.apiStyle === 'anthropic'
            ? (Array.isArray(json.content)
              ? json.content.find((part) => part && typeof part === 'object' && part.type === 'text')?.text
              : undefined)
            : (Array.isArray(json.choices) ? json.choices[0]?.message?.content : undefined);
          if (typeof content !== 'string') throw new Error('Invalid content');
          text = content;
        } catch (error) {
          if (controller.signal.aborted) throw error;
          throw new AiProviderError('INVALID_RESPONSE', 'Provider returned invalid JSON or an unsupported response envelope');
        }

        if (!text.trim()) {
          throw new AiProviderError('INVALID_RESPONSE', 'The model returned an empty response');
        }
        onProviderReference?.(
          String((json.id as string | undefined) ?? (json.model as string | undefined) ?? 'model-response').slice(0, 160)
        );

        return parseModelPlan(text);
      } catch (error) {
        if (error instanceof AiProviderError) throw error;
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          throw new AiProviderError('TIMEOUT', 'The model provider did not respond in time', true);
        }
        throw new AiProviderError(
          'PROVIDER_ERROR',
          'Provider transport failed',
          true
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/**
 * Parses a model response into the platform's own plan shape. The JSON is expected to be a single
 * object; anything inside code fences is unwrapped first because models routinely add them even
 * when told not to. Every section then passes `validateSections`, so the model cannot widen the
 * platform's vocabulary or smuggle markup in.
 */
export function parseModelPlan(raw: string): GeneratedSitePlan {
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    // Last resort: take the outermost object in the text.
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new AiProviderError('INVALID_RESPONSE', 'The model response was not valid JSON');
    }
    try {
      parsed = JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      throw new AiProviderError('INVALID_RESPONSE', 'The model response was not valid JSON');
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new AiProviderError('INVALID_RESPONSE', 'The model response was not an object');
  }
  const record = parsed as Record<string, unknown>;
  const rawPages = Array.isArray(record.pages) ? record.pages : [];
  if (rawPages.length === 0) {
    throw new AiProviderError('INVALID_RESPONSE', 'The model returned no pages');
  }
  if (rawPages.length > 12) {
    throw new AiProviderError('INVALID_RESPONSE', 'The model returned more pages than a generated site may contain');
  }

  const pages: GeneratedPage[] = rawPages.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new AiProviderError('INVALID_RESPONSE', `Page ${index + 1} was not an object`);
    }
    const page = entry as Record<string, unknown>;
    let sections: StoredSection[];
    try {
      sections = validateSections(page.sections);
    } catch (error) {
      throw new AiProviderError(
        'INVALID_RESPONSE',
        'The model returned content that failed section validation'
      );
    }
    if (sections.length === 0) {
      throw new AiProviderError('INVALID_RESPONSE', `Page ${index + 1} contained no usable sections`);
    }
    const rawPath = typeof page.path === 'string' ? page.path : `/${index === 0 ? '' : `page-${index + 1}`}`;
    const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    if (!/^\/[A-Za-z0-9._~/-]*$/.test(path)) {
      throw new AiProviderError('INVALID_RESPONSE', `Page ${index + 1} had an invalid path`);
    }
    return {
      title: sanitizeText(String(page.title ?? `Page ${index + 1}`), 200) || `Page ${index + 1}`,
      path: path.replace(/\/{2,}/g, '/').toLowerCase() || '/',
      isHome: page.isHome === true || index === 0,
      seo: validateSeo(page.seo),
      sections,
    };
  });

  // Exactly one home page, and it is the first page if the model did not nominate one.
  let homeSeen = false;
  for (const page of pages) {
    if (page.isHome && !homeSeen) homeSeen = true;
    else page.isHome = false;
  }
  if (!homeSeen) pages[0]!.isHome = true;

  const theme = (record.theme ?? {}) as Record<string, unknown>;
  const color = (value: unknown, fallback: string): string =>
    typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;

  const suggestions = Array.isArray(record.imageSuggestions) ? record.imageSuggestions : [];
  return {
    name: sanitizeText(String(record.name ?? 'Generated website'), 160) || 'Generated website',
    summary: sanitizeText(String(record.summary ?? 'Generated by the connected model provider.'), 600),
    theme: { primary: color(theme.primary, '#16704b'), accent: color(theme.accent, '#7ff0b4') },
    pages,
    imageSuggestions: suggestions.slice(0, 20).flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const suggestion = entry as Record<string, unknown>;
      const description = sanitizeText(String(suggestion.description ?? ''), 500);
      if (!description) return [];
      return [
        {
          sectionKey: sanitizeText(String(suggestion.sectionKey ?? 'general'), 80) || 'general',
          description,
          searchTerms: Array.isArray(suggestion.searchTerms)
            ? suggestion.searchTerms.filter((term): term is string => typeof term === 'string').slice(0, 8).map((term) => sanitizeText(term, 60))
            : [],
        },
      ];
    }),
    engine: 'llm',
    engineLabel: 'External model',
  };
}
