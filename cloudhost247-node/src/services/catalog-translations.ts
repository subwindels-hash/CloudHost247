import type { Queryable } from '../db/types';
import type { PublicProductSummaryDTO } from '../dto/catalog';

export const CONTENT_LOCALES = ['en', 'fr', 'de', 'es', 'pt', 'it', 'nl', 'pl', 'ru', 'ar', 'zh', 'ja', 'ko'] as const;
export type ContentLocale = typeof CONTENT_LOCALES[number];

/** Apply only reviewed, current translations to products already vetted by the public catalogue.
 * Slugs and all commerce fields stay unchanged. Missing/stale copy falls back to its original. */
export async function localizeProducts<T extends PublicProductSummaryDTO>(pool: Queryable, products: T[], locale: ContentLocale): Promise<T[]> {
  if (locale === 'en' || products.length === 0) return products;
  const { rows } = await pool.query<{ slug: string; name: string; description: string | null }>(
    `SELECT p.slug, t.name, t.description FROM products p
     JOIN catalog_product_translations t ON t.product_id = p.id
     WHERE p.slug = ANY($1::text[]) AND p.visibility = 'public' AND p.status <> 'disabled'
       AND t.locale = $2 AND t.status = 'published'
       AND t.source_name = p.name AND t.source_description IS NOT DISTINCT FROM p.description
       AND (p.description IS NULL OR t.description IS NOT NULL)`,
    [products.map((product) => product.slug), locale]
  );
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  return products.map((product) => {
    const translation = bySlug.get(product.slug);
    return translation ? { ...product, name: translation.name, description: translation.description } : product;
  });
}
