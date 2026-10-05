/**
 * Storage facade — picks a backend from configuration and exposes one API.
 *
 *   DATABASE_URL set   -> PgStore   (pg@8.16.3, the platform's only dependency)
 *   DATABASE_URL unset -> JsonStore (zero dependencies, files under DATA_DIR)
 *
 * Every domain module talks to `store.table('users')` etc., so switching backends needs no
 * change in application code. See MIGRATION.md for the differences that matter in practice.
 */
'use strict';

const path = require('node:path');
const { JsonStore } = require('./json-store');
const schema = require('./schema');

async function createStore(config, logger) {
  if (config.usingPostgres) {
    // Required lazily so a JSON-store deployment never loads `pg` at all.
    const { PgStore } = require('./pg-store');
    const store = new PgStore({ config, logger });
    await store.connect();
    logger.info('storage: postgres');
    return store;
  }

  const dir = path.resolve(config.DATA_DIR);
  const store = new JsonStore({ dir, logger });
  await store.connect();
  logger.info({ dir }, 'storage: json file store (set DATABASE_URL to use PostgreSQL)');
  return store;
}

module.exports = { createStore, schema };
