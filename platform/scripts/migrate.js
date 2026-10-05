#!/usr/bin/env node
/**
 * PostgreSQL schema migration for the platform.
 *
 *   node scripts/migrate.js up      create every table/index from src/store/schema.js
 *   node scripts/migrate.js status  report whether the database is reachable
 *
 * This is the only code path that needs the `pg` dependency, and only when DATABASE_URL is set.
 * The JSON store needs no migration — it creates files on first write.
 */
'use strict';

const { loadConfig } = require('../src/core/config');
const { createLogger } = require('../src/core/logger');
const { createStore } = require('../src/store');

async function main() {
  const command = process.argv[2] ?? 'up';
  const { config, warnings } = loadConfig({ cwd: require('node:path').join(__dirname, '..') });
  const logger = createLogger({ level: config.LOG_LEVEL, base: { tool: 'migrate' } });
  for (const w of warnings) logger.warn(w);

  if (!config.usingPostgres) {
    logger.warn('DATABASE_URL is not set — nothing to migrate. The JSON file store needs no migration.');
    return;
  }

  const store = await createStore(config, logger);

  if (command === 'status') {
    const ok = await store.ping();
    logger.info({ reachable: ok }, 'database status');
    process.exitCode = ok ? 0 : 1;
  } else if (command === 'up') {
    const count = await store.migrate();
    logger.info({ statements: count }, 'schema applied');
  } else {
    logger.error({ command }, 'unknown command (expected: up | status)');
    process.exitCode = 2;
  }

  await store.close();
}

main().catch((err) => {
  process.stderr.write(`[migrate] fatal: ${err.message}\n`);
  process.exit(1);
});
