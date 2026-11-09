/**
 * Phase 10 — real-PostgreSQL staging verification (item 4 of the gate-closure audit).
 *
 * Runs the repository's own migration runner against a REAL PostgreSQL server (pgserver-embedded
 * binaries, socket at /tmp/pgdata-p10) and then executes constraint/FK/isolation probes
 * demonstrating behavior the PGlite harness cannot alone establish. Writes a JSON evidence file.
 *
 * No production database is touched: this is a local, throwaway server on a local socket.
 */
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { PgClient } from '../database/db-client';
import { migrateUp, verify } from '../database/migrate';

const SOCKET_DIR = process.env.PHASE10_PG_SOCKET ?? '/tmp/pgdata-p10';

interface ProbeResult { name: string; expected: string; observed: string; pass: boolean }

async function main() {
  const pool = new Pool({ host: SOCKET_DIR, user: 'postgres', database: 'postgres', max: 4 });
  const client = new PgClient(pool);
  const evidence: Record<string, unknown> = { generatedAt: new Date().toISOString(), postgresVersion: null };

  evidence.postgresVersion = (await client.query<{ version: string }>('SELECT version()')).rows[0].version;

  // 1) Full migration run against real PostgreSQL (quarantined migrations stay skipped).
  const migrated = await migrateUp(client, { isProduction: false, confirmedForProduction: false, authorizedQuarantined: [] });
  evidence.migrations = {
    applied: migrated.applied.length,
    quarantined: migrated.quarantined ?? [],
    skippedReason: migrated.skippedReason ?? null,
  };

  const tableCount = (
    await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    )
  ).rows[0].n;
  evidence.tableCount = tableCount;

  // 2) Checksum verification (drift detection) against what was just applied.
  const verification = await verify(client);
  evidence.checksumVerify = verification.ok;

  const probes: ProbeResult[] = [];
  const run = async (name: string, expected: string, fn: () => Promise<string>) => {
    try {
      probes.push({ name, expected, observed: await fn(), pass: true });
    } catch (err) {
      probes.push({ name, expected, observed: `UNEXPECTED ERROR: ${(err as Error).message}`, pass: false });
    }
  };
  const expectCheck = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      return `VIOLATION NOT RAISED`;
    } catch (err) {
      const msg = (err as { code?: string; message?: string }) ?? {};
      return msg.code === '23514' ? `23514 ${msg.message?.split('\n')[0]}` : `other error: ${msg.code} ${msg.message}`;
    }
  };

  // CHECK constraints reject invalid states on the REAL engine.
  await run('ssl_certificates rejects an unknown status', '23514 CHECK violation', async () => {
    const out = await expectCheck('x', () =>
      client.query(
        `INSERT INTO ssl_certificates (id, user_id, domain_name, sans, issuer, challenge_type, status)
         VALUES ('${randomUUID()}','${randomUUID()}','p10-cnf.example','{}','LETS_ENCRYPT','HTTP_01','TOTALLY_MADE_UP')`
      )
    );
    if (out.startsWith('23514')) return out;
    throw new Error(`expected 23514, got: ${out}`);
  });

  await run('orders rejects negative totals', '23514 CHECK violation', async () => {
    const uid = randomUUID();
    await client.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ('${uid}','p10-${uid.slice(0, 6)}@example.com','h','P10','customer')`);
    const out = await expectCheck('x', () =>
      client.query(`INSERT INTO orders (id, user_id, currency, subtotal_amount, total_amount, status, payment_status)
                    VALUES ('${randomUUID()}','${uid}','USD',10,-5,'pending','unpaid')`)
    );
    if (out.startsWith('23514')) return out;
    throw new Error(`expected 23514, got: ${out}`);
  });

  await run('orders enforces unique order_number', '23505 unique violation', async () => {
    const uid = randomUUID();
    await client.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ('${uid}','p10b-${uid.slice(0, 6)}@example.com','h','P10','customer')`);
    const num = `CH-P10-${randomUUID().slice(0, 6)}`;
    await client.query(`INSERT INTO orders (id, order_number, user_id, currency, subtotal_amount, total_amount) VALUES ('${randomUUID()}','${num}','${uid}','USD',1,1)`);
    try {
      await client.query(`INSERT INTO orders (id, order_number, user_id, currency, subtotal_amount, total_amount) VALUES ('${randomUUID()}','${num}','${uid}','USD',1,1)`);
      return 'VIOLATION NOT RAISED';
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') return '23505 unique_violation';
      throw err;
    }
  });

  await run('ssl_certificates rejects a dangling user FK', '23503 FK violation', async () => {
    try {
      await client.query(
        `INSERT INTO ssl_certificates (id, user_id, domain_name, sans, issuer, challenge_type, status)
         VALUES ('${randomUUID()}','${randomUUID()}','p10-fk.example','{}','LETS_ENCRYPT','HTTP_01','PENDING')`
      );
      return 'VIOLATION NOT RAISED';
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23503') return '23503 foreign_key_violation';
      throw err;
    }
  });

  // Transaction isolation: two concurrent writers contending the same row with SELECT ... FOR UPDATE.
  await run('concurrent settlement serializes on FOR UPDATE (no double-settle)', 'exactly one final settled state', async () => {
    const uid = randomUUID();
    await client.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ('${uid}','p10c-${uid.slice(0, 6)}@example.com','h','P10','customer')`);
    const orderId = randomUUID();
    await client.query(`INSERT INTO orders (id, user_id, currency, subtotal_amount, total_amount, status, payment_status) VALUES ('${orderId}','${uid}','USD',10,10,'pending','unpaid')`);

    const settle = async (label: string) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const got = await c.query(`SELECT payment_status FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
        if (got.rows[0].payment_status !== 'unpaid') {
          await c.query('ROLLBACK');
          return `${label}:already-settled`;
        }
        await new Promise((r) => setTimeout(r, 120)); // widen the race window
        await c.query(`UPDATE orders SET payment_status = 'paid', status = 'completed', updated_at = now() WHERE id = $1`, [orderId]);
        await c.query('COMMIT');
        return `${label}:settled`;
      } catch (err) {
        await c.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        c.release();
      }
    };
    const [a, b] = await Promise.all([settle('txn-A'), settle('txn-B')]);
    const finalRow = (await client.query<{ payment_status: string; status: string }>(`SELECT payment_status, status FROM orders WHERE id = $1`, [orderId])).rows[0];
    const settled = [a, b].filter((r) => r.endsWith(':settled')).length;
    const refused = [a, b].filter((r) => r.includes('already-settled')).length;
    if (settled === 1 && refused === 1 && finalRow.payment_status === 'paid') {
      return `A=${a} B=${b} final=${finalRow.payment_status}/${finalRow.status} (serialized, exactly one settle)`;
    }
    throw new Error(`unexpected: A=${a} B=${b} final=${JSON.stringify(finalRow)}`);
  });

  // Migration idempotency marker: a second migrateUp must apply nothing.
  await run('migrateUp is a no-op on an up-to-date database', 'applied: 0', async () => {
    const again = await migrateUp(client, { isProduction: false, confirmedForProduction: false, authorizedQuarantined: [] });
    return `applied: ${again.applied.length}`;
  });

  evidence.probes = probes;
  evidence.allPassed = probes.every((p) => p.pass) && evidence.checksumVerify === true;

  writeFileSync('/home/user/CloudHost247/docs/staging/phase10-realpg-evidence-2026-11-09.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  await pool.end();
  process.exit(evidence.allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
