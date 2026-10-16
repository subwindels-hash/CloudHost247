/**
 * Scheduler — one tick of every timer-driven platform cycle.
 *
 * The audit's §7 gap: the sweep entry points existed (admin routes, callable by hand) but nothing
 * ran them on a timer, so a domain transfer advanced only when an operator pressed Refresh and a
 * queued job sat until someone noticed. This module is the platform equivalent of the audited
 * Node build's `worker/` sweeps and of this repo's `crons/` scripts: one call runs each cycle once.
 * `src/worker/cron.js` invokes it from a system crontab; overlapping ticks are safe because every
 * cycle underneath is claim/compare-and-swap idempotent.
 *
 * One broken sweep never stops the others: each is isolated and any failure is recorded in the
 * report's `errors` instead of thrown. A registrar that cannot be reached during a transfer poll
 * is not a sweep failure — `refreshTransfer` records the evidence on the row and the poll counts
 * as `failed`, and the tick continues.
 */
'use strict';

const { runProvisioningCycle } = require('./provisioning-worker');
const { runDeploymentCycle } = require('./deployment-worker');
const { sweepPaidOrders } = require('./order-provisioning');
const { refreshTransfer } = require('./domain-transfer-service');

/** A transfer in any of these statuses is still in flight and wants registrar polling. */
const IN_FLIGHT_TRANSFER_STATUSES = [
  'pending', 'authorization_required', 'transfer_initiated', 'transfer_in_progress', 'pending_registry',
];

async function isolated(name, fn, errors) {
  try {
    return await fn();
  } catch (error) {
    const message = error?.message ?? String(error);
    errors.push({ sweep: name, message });
    return { error: message };
  }
}

/**
 * Poll every in-flight domain transfer once. Completed and failed rows leave the in-flight set;
 * a poll that could not reach the registrar leaves the status where it was and is counted as
 * `failed` (the evidence is already written onto the row by refreshTransfer).
 */
async function refreshDueTransfers(store, deps) {
  const rows = await store.table('domain_transfers').all();
  const due = rows.filter((t) => IN_FLIGHT_TRANSFER_STATUSES.includes(t.status));
  const report = { due: due.length, polled: 0, completed: 0, failed: 0 };
  for (const transfer of due) {
    report.polled += 1;
    try {
      const result = await refreshTransfer(store, transfer, deps);
      if (result?.completed) report.completed += 1;
    } catch {
      // refreshTransfer records the failure on the row as evidence before rethrowing.
      report.failed += 1;
    }
  }
  return report;
}

/**
 * Run every timer-driven cycle once.
 *
 * @param {object} deps  the app's deps ({ store, config, logger, ... })
 * @param {object} [options] `{ limit }` for the provisioning cycle
 * @returns {Promise<object>} report — `{ ranAt, finishedAt, sweeps, errors }`
 */
async function runDueSweeps(deps, options = {}) {
  const { store } = deps;
  const errors = [];
  const startedAt = new Date().toISOString();

  // Sequential on purpose: cycles share one store and a registrar with one connection, and the
  // tick runs on a timer — parallelism here buys seconds and costs provider rate limits.
  const sweeps = {
    provisioning: await isolated('provisioning', () => runProvisioningCycle(deps, { limit: options.limit ?? 25 }), errors),
    deployments: await isolated('deployments', () => runDeploymentCycle(store, options.deployments ?? {}), errors),
    orders: await isolated('orders', () => sweepPaidOrders(store, { autoExecute: true }), errors),
    transfers: await isolated('transfers', () => refreshDueTransfers(store, deps), errors),
  };

  return {
    ranAt: startedAt,
    finishedAt: new Date().toISOString(),
    sweeps,
    errors,
  };
}

module.exports = {
  runDueSweeps,
  refreshDueTransfers,
  IN_FLIGHT_TRANSFER_STATUSES,
};
