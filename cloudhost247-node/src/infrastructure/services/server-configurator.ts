/**
 * Server configuration inputs (spec §8, §16 steps 14-18).
 *
 * Produces the per-server secrets and cloud-init payload used at provider create/reinstall time:
 * the agent identity (stored encrypted), the customer's selected SSH keys, the hostname, the
 * security marker and the optional control panel bootstrap. No secret produced here is ever
 * returned to a route, DTO, log line, or notification.
 */
import { buildServerCloudInitWithControlPanel } from '../../control-panels/registry';
import { getCredential, storeCredential } from '../../db/servers';
import type { CustomerServerDetailRow } from '../../db/server-provisioning';
import type { Queryable } from '../../db/types';
import { generateSecret } from '../../lib/crypto';
import { getKeyRing } from '../../lib/keyring';
import { ProviderError } from '../providers/types';

export interface ServerConfigurationOptions {
  source?: NodeJS.ProcessEnv;
}

export interface AgentIdentity {
  id: string;
  secret: string;
  userData: string;
}

/** Loads the customer's selected SSH keys, verifying they still belong to that customer. */
export async function getServerSshKeys(db: Queryable, server: CustomerServerDetailRow): Promise<string[]> {
  const raw = server.metadata.sshKeyIds;
  const ids = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  if (ids.length === 0) throw new ProviderError('INVALID_CONFIGURATION', 'Server has no SSH key selection', false);
  const { rows } = await db.query<{ public_key: string }>(
    `SELECT public_key FROM customer_ssh_keys WHERE user_id=$1 AND id=ANY($2::uuid[])`,
    [server.customer_id, ids]
  );
  if (rows.length !== ids.length) {
    throw new ProviderError('INVALID_CONFIGURATION', 'A selected SSH key is no longer available', false);
  }
  return rows.map((row) => row.public_key);
}

/**
 * Ensures the server has an agent identity and returns the cloud-init user data that installs
 * the agent, applies the hostname, injects SSH keys, writes the security marker, and optionally
 * installs the selected control panel. Fails closed when the control-plane URL or the
 * operator-published installer URL is missing: a server must never be reported READY without a
 * real monitoring agent.
 */
export async function ensureAgentIdentity(
  db: Queryable,
  server: CustomerServerDetailRow,
  options: ServerConfigurationOptions = {}
): Promise<AgentIdentity> {
  const source = options.source ?? process.env;
  const controlUrl = source.APP_URL;
  const installerUrl = source.SERVER_AGENT_INSTALL_URL;
  if (!controlUrl || !installerUrl) {
    throw new ProviderError(
      'CONFIGURATION_REQUIRED',
      'APP_URL and SERVER_AGENT_INSTALL_URL are required for monitored server provisioning',
      false
    );
  }
  const id = server.agent_id ?? `agent-${generateSecret(12).toLowerCase()}`;
  let secret = server.agent_id ? await getCredential(db, getKeyRing(), server.id, 'agent_secret') : null;
  if (!secret) {
    secret = generateSecret(32);
    await storeCredential(db, getKeyRing(), server.id, 'agent_secret', secret);
  }
  if (!server.agent_id) await db.query(`UPDATE servers SET agent_id=$2,updated_at=now() WHERE id=$1`, [server.id, id]);
  const sshKeys = await getServerSshKeys(db, server);

  let controlPanelSlug: string | null = null;
  if (server.control_panel_id) {
    const panel = await db.query<{ slug: string }>(`SELECT slug FROM control_panels WHERE id=$1`, [server.control_panel_id]);
    controlPanelSlug = panel.rows[0]?.slug ?? null;
  }

  return {
    id,
    secret,
    userData: buildServerCloudInitWithControlPanel({
      hostname: server.hostname,
      sshKeys,
      agentId: id,
      agentSecret: secret,
      controlUrl,
      installerUrl,
      controlPanelSlug,
      architecture: server.architecture as 'x86_64' | 'arm64',
    }),
  };
}
