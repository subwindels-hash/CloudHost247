/**
 * Phase 6 — worker-side database access. A thin re-export layer so the worker module depends on
 * one obvious place instead of scattering imports; also hosts the couple of queries that only
 * the worker needs (guarded status transition for claiming, subscription sweeps, health scheduling).
 */
import type { Queryable } from '../db/types';
import {
  appendDeploymentEvent,
  claimNextDeployment,
  completeDeployment,
  enqueueDeployment,
  failDeployment,
  findDeploymentById,
  listDeployments,
  reclaimExpiredDeployments,
  renewDeploymentLease,
  type DeploymentRow,
} from '../db/deployments';
import { listInstallationsForServer, listAllInstallations } from '../db/application-installations';

export {
  appendDeploymentEvent,
  claimNextDeployment,
  completeDeployment,
  enqueueDeployment,
  failDeployment,
  findDeploymentById,
  listDeployments,
  reclaimExpiredDeployments,
  renewDeploymentLease,
};
export type { DeploymentRow };

/**
 * Claim-time status transition: pending/queued/failed → deploying, but ONLY if the installation
 * is still in one of those states — a customer cancelling between enqueue and claim must win.
 */
export async function setInstallationStatusIfCurrent(
  db: Queryable,
  installationId: string,
  expectedStatuses: string[],
  next: string
): Promise<boolean> {
  const { rows } = await db.query(
    `UPDATE application_installations
     SET status = $2, updated_at = now()
     WHERE id = $1 AND status = ANY($3::text[])
     RETURNING id`,
    [installationId, next, expectedStatuses]
  );
  return rows.length > 0;
}

/** Active (non-deleted) installations eligible for periodic health checks, oldest first. */
export function listInstallationsForHealthChecks(db: Queryable): Promise<
  Array<{ id: string; server_id: string | null; last_health_check_at: string | null; circuit_open_until: string | null; status: string }>
> {
  return listAllInstallations(db, {}).then((rows) =>
    rows
      .filter((r) => ['healthy', 'unhealthy', 'starting'].includes(r.status))
      .map((r) => ({
        id: r.id,
        server_id: r.server_id,
        last_health_check_at: r.last_health_check_at,
        circuit_open_until: r.circuit_open_until,
        status: r.status,
      }))
  );
}

export { listInstallationsForServer };
