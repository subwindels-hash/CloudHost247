import legalJson from './legal.generated.json';
import type { LegalDocument } from './registry';

/**
 * Legal documents, in their own module on purpose.
 *
 * They are the largest content set on the site (about 150 KB of policy text) and they are needed
 * by exactly three routes: the policy centre, an individual policy, and the sitemap. Importing
 * them here rather than from `content/registry.ts` keeps them out of the bundle a visitor
 * downloads to read the homepage.
 */
const documents = (legalJson as { documents: LegalDocument[] }).documents;
const byRoute = new Map(documents.map((document) => [document.spa, document]));

export const LEGAL_DOCUMENTS: LegalDocument[] = documents;

export function findLegal(route: string): LegalDocument | undefined {
  return byRoute.get(route.replace(/\/$/, ''));
}

export const LEGAL_COUNT = documents.length;
