/**
 * CloudHost247 Server Agent — configuration (environment-driven, no secrets in files by default).
 *
 * Required:
 *   CH247_AGENT_ID       the agent id issued when the server was registered in the admin portal
 *   CH247_AGENT_SECRET   the agent secret (shown once at registration/rotation)
 *   CH247_CONTROL_URL    control plane base URL, for metric reports and health pushes
 *
 * Optional:
 *   CH247_PORT           listen port for inbound signed API calls (default 8787) — bind behind
 *                        Traefik/tls, or restrict with a firewall to the control plane IPs
 *   CH247_BIND           listen address (default 127.0.0.1; set 0.0.0.0 only behind a proxy)
 *   CH247_APPS_DIR       deployment root (default /opt/cloudhost247/apps)
 *   CH247_BACKUP_DIR     backup archive root (default /opt/cloudhost247/backups)
 *   CH247_REPORT_SECONDS metrics report interval (default 60; 0 disables)
 *   CH247_MAX_SKEW       signature timestamp tolerance in seconds (default 60)
 */
import process from 'node:process';

export class AgentConfigError extends Error {
  constructor(missing) {
    super(`Missing required configuration: ${missing.join(', ')}`);
    this.name = 'AgentConfigError';
  }
}

export function loadConfig(env = process.env) {
  const missing = ['CH247_AGENT_ID', 'CH247_AGENT_SECRET', 'CH247_CONTROL_URL'].filter((key) => !env[key]);
  if (missing.length > 0) throw new AgentConfigError(missing);
  return {
    agentId: env.CH247_AGENT_ID,
    agentSecret: env.CH247_AGENT_SECRET,
    controlUrl: env.CH247_CONTROL_URL.replace(/\/$/, ''),
    port: Number.parseInt(env.CH247_PORT ?? '8787', 10),
    bind: env.CH247_BIND ?? '127.0.0.1',
    appsDir: env.CH247_APPS_DIR ?? '/opt/cloudhost247/apps',
    backupDir: env.CH247_BACKUP_DIR ?? '/opt/cloudhost247/backups',
    reportSeconds: Number.parseInt(env.CH247_REPORT_SECONDS ?? '60', 10),
    maxSkewSeconds: Number.parseInt(env.CH247_MAX_SKEW ?? '60', 10),
  };
}

export const AGENT_VERSION = '1.0.0';
