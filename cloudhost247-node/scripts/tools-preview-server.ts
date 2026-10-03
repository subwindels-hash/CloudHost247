/**
 * Tools Center preview server (development only).
 *
 * Boots the REAL application — the same `buildApp` the platform runs in production — against an
 * in-memory PGlite database with every migration applied, and serves the built SPA from `public/`.
 * That means the Tools Center can be exercised end to end (catalogue, execution, history, reports,
 * monitors, admin control center) without provisioning PostgreSQL.
 *
 * What it is NOT:
 *   - not a production server (in-memory data disappears when it stops),
 *   - not a source of network results: this process's outbound network is whatever the host allows,
 *     and every tool reports honestly when a query fails.
 *
 * Usage:  npx tsx scripts/tools-preview-server.ts [port]
 * Then sign in with one of the printed demo accounts.
 */
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// Environment must be complete before any module that reads it is imported.
process.env.NODE_ENV = 'development';
process.env.DATABASE_URL ??= 'postgresql://preview:preview@localhost:5432/cloudhost247_preview';
process.env.JWT_SECRET ??= 'preview-only-secret-preview-only-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);
process.env.APP_URL ??= `http://localhost:${process.argv[2] ?? 3000}`;
process.env.LOG_LEVEL ??= 'warn';

async function main(): Promise<void> {
  const path = await import('node:path');
  const { loadEnv } = await import('../src/config/env');
  const { buildApp } = await import('../src/app');
  const { PgliteClient } = await import('../database/db-client');
  const { migrateUp } = await import('../database/migrate');
  const { hashPassword } = await import('../src/lib/password');

  const port = Number(process.argv[2] ?? process.env.PORT ?? 3000);
  const env = loadEnv(process.env as NodeJS.ProcessEnv);

  const db = new PGlite();
  const client = new PgliteClient(db);
  await migrateUp(client, { allowProduction: false });

  const accounts = [
    { email: 'demo@cloudhost247.test', password: 'demo-tools-247', name: 'Demo Customer', role: 'customer' },
    { email: 'admin@cloudhost247.test', password: 'admin-tools-247', name: 'Demo Administrator', role: 'super_admin' },
  ];

  for (const account of accounts) {
    await client.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status) VALUES ($1,$2,$3,$4,$5,'active')`,
      [randomUUID(), account.email, await hashPassword(account.password), account.name, account.role]
    );
  }

  // `serveFrontend` needs the built SPA directory. In a compiled deployment this resolves from
  // dist/; when run through tsx it has to be pointed at the repository's own `public/`.
  const publicDir = path.resolve(__dirname, '..', 'public');
  const app = buildApp(env, { serveFrontend: true, publicDir, pool: client as never });

  /**
   * The platform's production CSP sends `frame-ancestors 'self'` (helmet's default), which is correct
   * for a hosted platform but blocks this preview when it is embedded by the sandbox proxy. The
   * relaxation lives here, in the dev harness — never in src/. Everything else about the app,
   * including authentication, authorization and the tool execution pipeline, is untouched.
   */
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.removeHeader('x-frame-options');
    const csp = reply.getHeader('content-security-policy');
    if (typeof csp === 'string') {
      reply.header(
        'content-security-policy',
        csp
          .split(';')
          .map((directive) => directive.trim())
          .filter((directive) => directive.length > 0 && !directive.startsWith('frame-ancestors'))
          .concat("frame-ancestors 'self' https:")
          .join('; ')
      );
    }
    return payload;
  });

  await app.listen({ port, host: '0.0.0.0' });

  console.log('');
  console.log('CloudHost247 Tools Center preview');
  console.log(`  URL        http://localhost:${port}/tools`);
  console.log(`  Admin      http://localhost:${port}/admin/tools`);
  console.log('  Accounts (in-memory demo data — reset every restart):');
  for (const account of accounts) {
    console.log(`    ${account.role.padEnd(11)} ${account.email}  /  ${account.password}`);
  }
  console.log('');
  console.log('  Note: this sandbox has no outbound network, so resolver/provider-backed tools will');
  console.log('  report typed failures (DNS_LOOKUP_FAILED / TIMEOUT / CONFIGURATION_REQUIRED) instead of');
  console.log('  answers. Pure tools (JSON, encoding, subnet maths, passwords, colours, text, QR, …) work');
  console.log('  fully, which is exactly the honest behaviour the API is designed to have.');
  console.log('');

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }
}

main().catch((error) => {
  console.error('The Tools Center preview failed to start:', error);
  process.exit(1);
});
