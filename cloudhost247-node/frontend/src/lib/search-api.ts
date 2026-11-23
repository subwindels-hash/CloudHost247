/**
 * Typed wrapper around the public site-search endpoint.
 *
 * The corpus is published content only (marketing pages, documentation, tools, FAQ); the query is
 * sent to the server because the index lives there. Nothing is stored: see the privacy note in
 * src/routes/search.ts.
 */
import { apiFetch } from './api';

/** Below this the server returns nothing rather than the whole corpus; mirrored in the UI. */
export const SITE_SEARCH_MIN_QUERY_LENGTH = 2;

export const SITE_SEARCH_DEBOUNCE_MS = 250;

export interface SiteSearchResult {
  href: string;
  title: string;
  category: string;
  description: string;
  snippet: string;
  score: number;
}

export interface SiteSearchResponse {
  query: string;
  results: SiteSearchResult[];
  total: number;
  limit: number;
}

export function searchSite(query: string, limit = 20) {
  const params = new URLSearchParams({ q: query });
  if (limit !== 20) params.set('limit', String(limit));
  return apiFetch<SiteSearchResponse>(`/api/v1/search?${params.toString()}`);
}
