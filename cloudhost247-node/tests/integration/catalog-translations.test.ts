import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { migrateUp } from '../../database/migrate';
import { PgliteClient } from '../../database/db-client';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { signAuthToken } from '../../src/lib/jwt';
import { createProduct, updateProduct } from '../../src/db/catalog-products';

it('publishes reviewed product translations without modifying source or exposing drafts, stale copy or private products', async () => {
  const db = new PGlite();
  await migrateUp(new PgliteClient(db), { isProduction: false });
  const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://user:pass@localhost/db', JWT_SECRET: 'x'.repeat(32) } as NodeJS.ProcessEnv);
  const product = await createProduct(db, { id: randomUUID(), slug: 'demo-product', name: 'Hosting', description: 'Original description', productType: 'hosting', status: 'active', visibility: 'public' });
  const privateProduct = await createProduct(db, { id: randomUUID(), slug: 'private-product', name: 'Private', productType: 'hosting', status: 'active', visibility: 'private' });
  const admin = randomUUID();
  const customer = randomUUID();
  for (const [id, role] of [[admin, 'super_admin'], [customer, 'customer']] as const) {
    await db.query('INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,$3,$4,$5)', [id, `${id}@example.test`, 'unused', 'Tester', role]);
  }
  const token = (id: string, role: string) => signAuthToken(env, { sub: id, role, email: `${id}@example.test` });
  const app = buildApp(env, { serveFrontend: false, pool: db });
  const path = `/api/v1/admin/catalog/products/${product.id}/translations/fr`;
  const body = { name: 'Hébergement', description: 'Description française', status: 'draft', sourceName: 'Hosting', sourceDescription: 'Original description' };
  try {
    expect((await app.inject({ method: 'PUT', url: path, payload: body })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: path, headers: { authorization: `Bearer ${token(customer, 'customer')}` }, payload: body })).statusCode).toBe(403);
    const headers = { authorization: `Bearer ${token(admin, 'super_admin')}` };
    expect((await app.inject({ method: 'PUT', url: path, headers, payload: body })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/catalog?lang=fr' })).json().products[0].name).toBe('Hosting');
    expect((await app.inject({ method: 'PUT', url: path, headers, payload: { ...body, status: 'published', description: null } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: path, headers, payload: { ...body, status: 'published' } })).statusCode).toBe(200);
    for (const url of ['/api/v1/catalog?lang=fr', '/api/v1/catalog/products?type=hosting&lang=fr', '/api/v1/catalog/products/demo-product?lang=fr', '/api/v1/catalog/products/demo-product/plans?lang=fr']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      const data = response.json();
      const translated = data.products?.[0] ?? data.product;
      expect(translated.name).toBe('Hébergement');
      expect(translated.description).toBe('Description française');
      expect(translated.slug).toBe('demo-product');
      expect(translated).not.toHaveProperty('id');
    }
    expect((await app.inject({ method: 'GET', url: '/api/v1/catalog?lang=de' })).json().products[0].name).toBe('Hosting');
    expect((await app.inject({ method: 'GET', url: '/api/v1/catalog?lang=xx' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/api/v1/catalog/products/${privateProduct.slug}?lang=fr` })).statusCode).toBe(404);
    await updateProduct(db, product.id, { description: 'Changed source' });
    const translated = await app.inject({ method: 'GET', url: '/api/v1/catalog?lang=fr' });
    expect(translated.json().products[0].description).toBe('Changed source');
    expect(translated.json().products[0].name).toBe('Hosting');
    const list = await app.inject({ method: 'GET', url: `/api/v1/admin/catalog/products/${product.id}/translations`, headers });
    expect(list.json().translations[0].stale).toBe(true);
    expect((await app.inject({ method: 'PUT', url: path, headers, payload: { ...body, status: 'published' } })).statusCode).toBe(400);
  } finally {
    await app.close();
    await db.close();
  }
}, 90000);
