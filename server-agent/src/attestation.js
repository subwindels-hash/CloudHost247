/**
 * CloudHost247 Server Agent — provisioning attestation.
 *
 * These fields are not telemetry: the control plane's provisioning health gate refuses to hand a
 * server to a customer until it has seen `securityConfigured === true` AND `monitoringRunning ===
 * true` in a fresh, authenticated agent report
 * (cloudhost247-node/src/infrastructure/services/health-checker.ts).
 *
 * That gate is only worth anything if the two fields are evidence. `securityConfigured` has always
 * been evidence — the host-hardening cloud-init step leaves a marker file. `monitoringRunning` was
 * the literal `true`, returned by every host, forever, including a host with no monitoring of any
 * kind; nothing in this repository installs a monitoring agent, so the gate's "monitoring" condition
 * was satisfied by a constant. It is now derived from what the agent can actually observe about this
 * host, and a host where those readings are unavailable is reported as not monitored.
 *
 * This module is separate from server.js so it can be tested: importing server.js starts a listener.
 */
import { existsSync, readFileSync } from 'node:fs';
import { hostname as osHostname } from 'node:os';

/** Marker file written by the host-hardening step (see control-panels/registry.ts). */
export const SECURITY_MARKER = '/var/lib/cloudhost247/security-configured';

/**
 * Whether the agent can produce the readings the platform's monitoring pipeline consumes: container
 * counts from Docker, and CPU/memory from /proc. Both come out of the same `systemReport()` call that
 * is attached to this attestation, so the field describes evidence gathered on this very report
 * rather than an assumption about the host.
 *
 * `!= null` (not `!== null`) is deliberate: a report that omits the key entirely — an older agent, or
 * a crashed collection — must read as "not monitored", never as `undefined !== null → true`.
 */
export function monitoringIsRunning(report) {
  return report?.dockerContainers != null && report?.cpuPercent != null;
}

/** Reads the os-release fields the control plane matches against the ordered OS image. */
function readOsRelease(deps) {
  let text;
  try {
    text = deps.readFile('/etc/os-release', 'utf8');
  } catch {
    // The control plane treats missing OS fields as an incomplete health check; never invent them.
    return {};
  }
  return Object.fromEntries(
    text
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, '')];
      })
  );
}

/**
 * @param {object} report  the system report this attestation is attached to (see systemReport()).
 * @param {object} [deps]  injectable for tests: { readFile, exists, hostname }.
 */
export function provisioningAttestation(report, deps = {}) {
  const readFile = deps.readFile ?? ((file, encoding) => readFileSync(file, encoding));
  const exists = deps.exists ?? ((file) => existsSync(file));
  const hostname = deps.hostname ?? (() => osHostname());

  const fields = readOsRelease({ readFile });
  return {
    osId: fields.ID,
    osVersion: fields.VERSION_ID ?? fields.BUILD_ID,
    hostname: hostname(),
    securityConfigured: exists(SECURITY_MARKER),
    monitoringRunning: monitoringIsRunning(report),
  };
}
