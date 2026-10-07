/**
 * Standalone database-diagnosis CLI: `npm run db:doctor` (or `node dist/src/config/db-doctor.js`).
 *
 * Why this exists: `npm run env:check` validates the *shape* of the environment and deliberately
 * does not touch the network, while `GET /ready` reports only a boolean — it never says *why* the
 * database is unreachable, on purpose, because that endpoint is public. On a real deployment the
 * operator is therefore left with "database: error" and no next step. This CLI fills that gap: it
 * runs on the server, prints a plain-language cause and the specific fix for the failure it finds,
 * and never prints the password.
 *
 * It is read-only: it connects, reads the server version, and reports migration state through the
 * existing `status()` helper (which only creates the bookkeeping table if it is absent, exactly as
 * `migrate status` does). It never applies a migration and never writes application data.
 *
 * Exit codes: 0 = database reachable, 1 = not reachable (or environment invalid).
 * It does NOT verify provider credentials, email delivery, or whether the account is licensed for
 * anything — a reachable database is not a working platform.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { loadEnv, EnvValidationError, type Env } from './env';
import { PgClient } from '../../database/db-client';
import { status } from '../../database/migrate';

const line = (): void => {
  // eslint-disable-next-line no-console
  console.log('');
};
const say = (message: string): void => {
  // eslint-disable-next-line no-console
  console.log(message);
};

/** Placeholder values that ship in `.env.example`; seeing them means nobody edited the file. */
const PLACEHOLDER_PASSWORDS = new Set(['password', 'pass', 'changeme', 'change-me', 'secret', 'placeholder', 'example', 'yourpassword', 'your-password', 'dbpassword']);
const PLACEHOLDER_USERS = new Set(['user', 'username', 'dbuser', 'postgres', 'admin']);
const PLACEHOLDER_DATABASES = new Set(['mydb', 'database', 'db', 'test', 'cloudhost247', 'database_name']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

interface Target {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  hasSslParam: boolean;
}

/** Parses DATABASE_URL for display. The password is kept only to compare it against placeholders. */
export function parseTarget(raw: string): Target | null {
  try {
    const url = new URL(raw);
    return {
      host: url.hostname,
      port: url.port || '5432',
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      hasSslParam: url.searchParams.get('sslmode') !== null,
    };
  } catch {
    return null;
  }
}

export function placeholderSignals(target: Target): string[] {
  const signals: string[] = [];
  if (PLACEHOLDER_PASSWORDS.has(target.password.toLowerCase())) signals.push('password');
  if (target.password.length === 0) signals.push('password (empty)');
  if (PLACEHOLDER_USERS.has(target.user.toLowerCase())) signals.push('user');
  if (PLACEHOLDER_DATABASES.has(target.database.toLowerCase())) signals.push('database name');
  return signals;
}

/** Maps the driver's error to the actual cause a human can act on. */
export function diagnose(err: NodeJS.ErrnoException & { code?: string }, target: Target): string[] {
  const code = String(err.code ?? '');
  const message = String(err.message ?? '');
  const has = (text: string): boolean => message.toLowerCase().includes(text.toLowerCase());

  // --- Transport-level failures: nothing to do with credentials --------------------------------
  if (code === 'ENOTFOUND') {
    return [
      `DNS: the host "${target.host}" does not resolve from this server.`,
      'Fix: check the hostname for a typo, and confirm the database provider still exists.',
    ];
  }
  if (code === 'EAI_AGAIN') {
    return [
      `DNS: lookup of "${target.host}" timed out (temporary resolver failure).`,
      'Fix: retry; if it persists, ask the hosting provider whether outbound DNS works on this account.',
    ];
  }
  if (code === 'ECONNREFUSED') {
    return [
      `Nothing is accepting connections at ${target.host}:${target.port}.`,
      'Fix: confirm the port, and that the database service is running. On cPanel-hosted PostgreSQL,',
      'confirm the account actually has a PostgreSQL database (cPanel → PostgreSQL Databases).',
    ];
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || has('timeout expired') || has('timed out')) {
    return [
      `The connection to ${target.host}:${target.port} timed out — the host or a firewall dropped it.`,
      'Fix: most managed providers (Supabase, Neon, RDS, DigitalOcean) require allowlisting the',
      "connecting IP in the provider's dashboard; also confirm outbound connections on this port are",
      'permitted, and that the provider is not suspended for inactivity.',
    ];
  }
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH' || code === 'EPROTO') {
    return [
      `The network path to ${target.host}:${target.port} is unreachable from this server.`,
      'Fix: confirm the host/port and whether this shared-hosting account may make outbound database',
      'connections at all (ask the hosting provider — some block them).',
    ];
  }

  // --- TLS: the server answered, the certificate did not satisfy the client --------------------
  if (has('self signed certificate') || has('self-signed certificate') || has('unable to verify the first certificate') || code === 'SELF_SIGNED_CERT_IN_CHAIN' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
    return [
      'The database answered, but its TLS certificate could not be verified.',
      'Fix: prefer a provider CA bundle. Only if the provider requires it, set',
      'DATABASE_SSL_REJECT_UNAUTHORIZED=false and record why in your operations notes.',
    ];
  }
  if (has('does not support ssl') || has('server does not support SSL')) {
    return [
      'The server does not support TLS, but DATABASE_SSL=true is set.',
      'Fix: set DATABASE_SSL=false for this provider, then Restart the application.',
    ];
  }

  // --- The server answered as a database: authentication and target errors ----------------------
  if (code === '28P01' || has('password authentication failed') || has('authentication failed')) {
    return [
      `Authentication failed for user "${target.user}".`,
      'Fix: copy the exact connection string (and password) from the provider/cPanel again — special',
      'characters must be URL-encoded — then Restart the application so it re-reads the environment.',
    ];
  }
  if (code === '28000') {
    return [
      `The server refused the connection for user "${target.user}" (pg_hba/role policy).`,
      'Fix: confirm the user exists and is permitted to connect from this host; cPanel-created users',
      'are normally restricted to localhost.',
    ];
  }
  if (code === '3D000' || has('does not exist') && has('database')) {
    return [
      `The database "${target.database}" does not exist on this server.`,
      'Fix: create it (cPanel → PostgreSQL Databases) or correct the database name in DATABASE_URL.',
    ];
  }
  if (code === '53300') {
    return [
      'The server is out of connection slots for this user.',
      'Fix: lower DATABASE_POOL_MAX, and close idle clients on the provider side.',
    ];
  }
  if (code === '42501' || has('permission denied')) {
    return [
      `The user "${target.user}" lacks permission on "${target.database}".`,
      'Fix: grant the user on the database, or use a connection string that owns it.',
    ];
  }

  return [
    `The database reported: ${message}`,
    'Fix: this error is not one of the recognisable cases — check the provider status page and the',
    'exact connection string, then run this command again.',
  ];
}

async function main(): Promise<number> {
  let env: Env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      say('The environment is not valid, so no connection can be attempted:');
      say(err.message);
      say('');
      say('Fix the values above (in cPanel Environment Variables, or in .env) and re-run:');
      say('  npm run db:doctor');
      return 1;
    }
    throw err;
  }

  const target = parseTarget(env.DATABASE_URL);
  if (!target) {
    say('DATABASE_URL is set but cannot be parsed as a connection URL.');
    say('Expected the form: postgresql://USER:PASSWORD@HOST:PORT/DATABASE');
    return 1;
  }

  say('CloudHost247 database doctor');
  line();
  say('Target (read from DATABASE_URL; the password is never printed):');
  say(`  host      ${target.host}:${target.port}`);
  say(`  database  ${target.database}`);
  say(`  user      ${target.user}`);
  say(`  password  ${target.password.length > 0 ? '<set, hidden>' : '<empty>'}`);
  say(`  TLS       ${env.DATABASE_SSL ? `on (rejectUnauthorized=${env.DATABASE_SSL_REJECT_UNAUTHORIZED})` : 'off'}`);
  say(`  pool max  ${env.DATABASE_POOL_MAX}`);
  if (target.hasSslParam) {
    say('  note      DATABASE_URL contains its own sslmode parameter; DATABASE_SSL above also applies');
  }

  const signals = placeholderSignals(target);
  if (signals.length > 0) {
    line();
    say(`This DATABASE_URL looks like the .env.example placeholder (${signals.join(', ')}).`);
    say('Replace it with the real connection string before relying on this database.');
  }
  if (LOOPBACK_HOSTS.has(target.host)) {
    // Not a placeholder verdict on its own: a cPanel account that hosts its own PostgreSQL really
    // does connect over localhost. It is worth saying out loud anyway, because pointing a managed
    // provider's connection string at localhost is a common copy/paste mistake.
    line();
    say('Note: the host is localhost, which only works if this cPanel account hosts PostgreSQL');
    say('itself. If you are connecting to a managed provider, this host is wrong.');
  }

  line();
  say('Connecting…');
  const client = new Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    ...(env.DATABASE_SSL ? { ssl: { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED } } : {}),
  });

  try {
    await client.connect();
  } catch (err) {
    const failure = err as NodeJS.ErrnoException;
    line();
    say('RESULT: the database is NOT reachable.');
    line();
    for (const text of diagnose(failure, target)) say(text);
    line();
    say('What this means for the deployment: the website itself will still render (the marketing');
    say('pages are compiled and issue no query), but the catalogue, account and pricing surfaces will');
    say('show their empty/error states, and no migration can run. See');
    say('docs/website-rebuild/LIVE-SITE-DEPLOYMENT.md §0.');
    return 1;
  }

  try {
    const who = await client.query<{ version: string; database: string; user: string }>(
      'SELECT current_database() AS database, current_user AS user, version() AS version',
    );
    const row = who.rows[0];
    line();
    say('RESULT: the database IS reachable.');
    line();
    say(`  connected as  ${row?.user ?? target.user} to ${row?.database ?? target.database}`);
    say(`  server        ${(row?.version ?? 'unknown').split(' ').slice(0, 2).join(' ')}`);

    // Migration state, read through the migration runner's own helper so this cannot disagree with
    // `migrate status`. `status()` creates the bookkeeping table if it is absent; that is the same
    // behaviour as `migrate status` and applies no application DDL.
    const rows = await status(new PgClient(client));
    const applied = rows.filter((r) => r.applied).length;
    const pending = rows.filter((r) => !r.applied);
    const drift = rows.filter((r) => r.applied && r.checksumMatches === false);
    line();
    say(`  migrations    ${applied} applied, ${pending.length} pending (of ${rows.length})`);
    if (drift.length > 0) {
      say(`  DRIFT         ${drift.length} applied migration(s) no longer match their file checksums`);
      say(`                ${drift.map((d) => d.version).join(', ')} — investigate before migrating`);
    }
    if (pending.length === 0) {
      say('  next          nothing to migrate; verify with: node dist/database/migrate.js verify');
    } else {
      const first = pending[0];
      const quarantinedPending = pending.filter((p) => p.quarantined);
      say(`  next          node dist/database/migrate.js status   (read-only)`);
      say(`                node dist/database/migrate.js up       (applies ${first?.version} … ${pending[pending.length - 1]?.version})`);
      if (quarantinedPending.length > 0) {
        line();
        say(`  WARNING       ${quarantinedPending.length} pending migration(s) are under a standing production`);
        say(`                quarantine: ${quarantinedPending.map((p) => p.version).join(', ')}. A production run refuses`);
        say('                unless they are authorized for that run — see CPANEL_DEPLOYMENT.md §0a:');
        say(`                CONFIRM_MIGRATION=yes AUTHORIZED_MIGRATIONS=${quarantinedPending.map((p) => p.version).join(',')} \\`);
        say('                  node dist/database/migrate.js up');
      }
    }
    line();
    say('Not checked here: provider credentials, email delivery, or application-level permissions.');
    return 0;
  } catch (err) {
    line();
    say('RESULT: the connection opened but the database could not be read.');
    const failure = err as NodeJS.ErrnoException;
    for (const text of diagnose(failure, target)) say(text);
    return 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

// Executed as a program (npm run db:doctor / node dist/src/config/db-doctor.js). Guarded so the
// exported helpers below can be imported by tests without opening a database connection.
if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(`db:doctor failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    });
}
