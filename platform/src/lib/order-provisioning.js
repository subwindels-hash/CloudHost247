/**
 * Paid-Order Provisioning Pipeline & Worker.
 *
 * Links settled billing orders to infrastructure and application deployment:
 * 1. Upon order payment, locates pending application installations linked to the order.
 * 2. Enqueues an idempotent 'install' deployment in the deployments table.
 * 3. Transitions application_installations to 'queued' and runs the deployment pipeline
 *    via executeDeployment to reach 'running' and 'healthy' status.
 * 4. Links and activates customer_services associated with the order.
 */
'use strict';

const { uuidv7 } = require('./ids');
const { executeDeployment } = require('./deployment-worker');

/**
 * Provision resources for an order whose payment has succeeded.
 *
 * @param {object} store Data store (or transaction store)
 * @param {string} orderId
 * @param {object} [options]
 * @param {boolean} [options.autoExecute=true]
 * @returns {Promise<{ installationsQueued: string[], installationsExecuted: string[], servicesProvisioned: string[] }>}
 */
async function provisionPaidOrder(store, orderId, options = {}) {
  const { autoExecute = true } = options;
  const results = {
    orderId,
    installationsQueued: [],
    installationsExecuted: [],
    servicesProvisioned: [],
  };

  if (!orderId) return results;

  // 1. Pending application installations linked to this order
  const allInstallations = await store.table('application_installations').all();
  const pendingInsts = allInstallations.filter(
    (inst) => inst.order_id === orderId && ['pending', 'queued'].includes(inst.status)
  );

  for (const inst of pendingInsts) {
    // Check if an install deployment already exists for this installation
    const existingDeployments = (await store.table('deployments').all())
      .filter((d) => d.installation_id === inst.id && d.action === 'install');

    let deployment = existingDeployments[0];
    if (!deployment) {
      const deploymentId = uuidv7();
      deployment = await store.table('deployments').insert({
        id: deploymentId,
        user_id: inst.user_id,
        installation_id: inst.id,
        server_id: inst.server_id ?? null,
        action: 'install',
        idempotency_key: `install:${inst.id}:${orderId}`,
        requested_by: inst.user_id,
        payload: {
          applicationId: inst.application_id,
          versionId: inst.version_id,
          domain: inst.domain,
          config: inst.config,
        },
        status: 'queued',
        source: `app:${inst.application_id}`,
        ref: inst.version_id || 'latest',
      });
    }

    await store.table('application_installations').updateById(inst.id, {
      status: 'queued',
      updated_at: new Date().toISOString(),
    });
    results.installationsQueued.push(inst.id);

    if (autoExecute && deployment && deployment.status === 'queued') {
      try {
        await executeDeployment(store, deployment);
        results.installationsExecuted.push(inst.id);
      } catch (err) {
        // Log failure but continue processing remaining items
        console.error(`Failed to execute deployment for installation ${inst.id}:`, err);
      }
    }
  }

  // 2. Customer services linked to this order
  const allServices = await store.table('customer_services').all();
  const pendingServices = allServices.filter(
    (s) => s.order_id === orderId && ['pending', 'awaiting_payment'].includes(s.status)
  );

  for (const s of pendingServices) {
    await store.table('customer_services').updateById(s.id, {
      status: 'active',
      updated_at: new Date().toISOString(),
    });
    results.servicesProvisioned.push(s.id);
  }

  return results;
}

/**
 * Sweep for any paid orders with pending application installations or services
 * that have not yet been provisioned.
 *
 * @param {object} store
 * @param {object} [options]
 * @returns {Promise<{ sweptOrders: number, provisionedCount: number }>}
 */
async function sweepPaidOrders(store, options = {}) {
  const allOrders = await store.table('orders').all();
  const paidOrders = allOrders.filter((o) => o.status === 'paid');

  let provisionedCount = 0;
  for (const order of paidOrders) {
    const outcome = await provisionPaidOrder(store, order.id, options);
    provisionedCount += outcome.installationsExecuted.length + outcome.servicesProvisioned.length;
  }

  return {
    sweptOrders: paidOrders.length,
    provisionedCount,
  };
}

module.exports = {
  provisionPaidOrder,
  sweepPaidOrders,
};
