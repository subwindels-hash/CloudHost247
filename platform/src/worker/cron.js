/**
 * Scheduler tick — the crontab entry point for `platform/`.
 *
 * One invocation runs every timer-driven cycle exactly once and prints the JSON report to stdout,
 * exactly like this repo's `crons/*.php` scripts: schedule it from the system crontab, for example
 *
 *   * * * * *  cd /path/to/CloudHost247/platform && /usr/bin/node src/worker/cron.js >> /var/log/ch247-platform-cron.log 2>&1
 *
 * Overlapping ticks are safe (every cycle underneath is claim/CAS idempotent), so a one-minute
 * line is fine; a busier deployment can run it less often. Exit code is 0 when every sweep
 * completed (individual job/transfer outcomes are inside the report) and 1 when a sweep itself
 * failed to run.
 */
'use strict';

const path = require('node:path');
const { loadConfig } = require('../core/config');
const { buildApp } = require('../app');
const { runDueSweeps } = require('../lib/scheduler');

async function main() {
  const { config } = loadConfig({ cwd: path.join(__dirname, '..', '..') });
  const app = await buildApp(config);
  try {
    const report = await runDueSweeps(app.deps);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.errors.length > 0 ? 1 : 0;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
