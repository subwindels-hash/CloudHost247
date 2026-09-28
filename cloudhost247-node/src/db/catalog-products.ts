import type { Queryable } from './types';

export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  product_type: string;
  status: string;
  visibility: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export type ProductType = 'hosting' | 'domain' | 'service';
export type CatalogStatus = 'draft' | 'active' | 'disabled';
export type Visibility = 'public' | 'private';

/** Any product visible to the public catalog API at all — draft-but-public products are included
 * here (they're shown as "coming soon"); fully private or disabled products never are. */
export async function listPubliclyListableProducts(pool: Queryable, productType?: ProductType): Promise<ProductRow[]> {
  const params: unknown[] = ['public', 'disabled'];
  let sql = `SELECT * FROM products WHERE visibility = $1 AND status <> $2`;
  if (productType) {
    params.push(productType);
    sql += ` AND product_type = $${params.length}`;
  }
  sql += ' ORDER BY display_order ASC, name ASC';
  const { rows } = await pool.query<ProductRow>(sql, params);
  return rows;
}

export async function findPubliclyListableProductBySlug(pool: Queryable, slug: string): Promise<ProductRow | null> {
  const { rows } = await pool.query<ProductRow>(
    `SELECT * FROM products WHERE lower(slug) = lower($1) AND visibility = 'public' AND status <> 'disabled' LIMIT 1`,
    [slug]
  );
  return rows[0] ?? null;
}

export async function listAllProducts(pool: Queryable): Promise<ProductRow[]> {
  const { rows } = await pool.query<ProductRow>('SELECT * FROM products ORDER BY display_order ASC, name ASC');
  return rows;
}

export async function findProductById(pool: Queryable, id: string): Promise<ProductRow | null> {
  const { rows } = await pool.query<ProductRow>('SELECT * FROM products WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ?? null;
}

export async function findProductBySlugAnyStatus(pool: Queryable, slug: string): Promise<ProductRow | null> {
  const { rows } = await pool.query<ProductRow>('SELECT * FROM products WHERE lower(slug) = lower($1) LIMIT 1', [slug]);
  return rows[0] ?? null;
}

export interface CreateProductInput {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  productType: ProductType;
  status?: CatalogStatus;
  visibility?: Visibility;
  displayOrder?: number;
}

export async function createProduct(pool: Queryable, input: CreateProductInput): Promise<ProductRow> {
  const { rows } = await pool.query<ProductRow>(
    `INSERT INTO products (id, slug, name, description, product_type, status, visibility, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.id,
      input.slug,
      input.name,
      input.description ?? null,
      input.productType,
      input.status ?? 'draft',
      input.visibility ?? 'private',
      input.displayOrder ?? 0,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to create product');
  return row;
}

export interface UpdateProductInput {
  name?: string;
  description?: string | null;
  productType?: ProductType;
  visibility?: Visibility;
  displayOrder?: number;
}

export async function updateProduct(pool: Queryable, id: string, patch: UpdateProductInput): Promise<ProductRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.name !== undefined) {
    params.push(patch.name);
    sets.push(`name = $${params.length}`);
  }
  if (patch.description !== undefined) {
    params.push(patch.description);
    sets.push(`description = $${params.length}`);
  }
  if (patch.productType !== undefined) {
    params.push(patch.productType);
    sets.push(`product_type = $${params.length}`);
  }
  if (patch.visibility !== undefined) {
    params.push(patch.visibility);
    sets.push(`visibility = $${params.length}`);
  }
  if (patch.displayOrder !== undefined) {
    params.push(patch.displayOrder);
    sets.push(`display_order = $${params.length}`);
  }

  if (sets.length === 0) {
    return findProductById(pool, id);
  }

  sets.push('updated_at = now()');
  params.push(id);
  const { rows } = await pool.query<ProductRow>(
    `UPDATE products SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

export async function setProductStatus(pool: Queryable, id: string, status: CatalogStatus): Promise<ProductRow | null> {
  const { rows } = await pool.query<ProductRow>(
    `UPDATE products SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [status, id]
  );
  return rows[0] ?? null;
}
