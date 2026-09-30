/**
 * Central Control Panel Adapter Registry (Phase 4).
 *
 * Manages instantiated adapters for all 18 platforms and provides unified utilities
 * for cloud-init script generation, firewall configuration, and compatibility checks.
 */

import type { ControlPanelAdapter, ControlPanelInstallOptions, FirewallPortRule } from './types';
import { DokployAdapter } from './adapters/dokploy';
import { CoolifyAdapter } from './adapters/coolify';
import { CloudPanelAdapter } from './adapters/cloudpanel';
import { CPanelAdapter } from './adapters/cpanel';
import { PleskAdapter } from './adapters/plesk';
import { DirectAdminAdapter } from './adapters/directadmin';
import { CyberPanelAdapter } from './adapters/cyberpanel';
import { HestiaCPAdapter } from './adapters/hestiacp';
import { FastpanelAdapter } from './adapters/fastpanel';
import { AaPanelAdapter } from './adapters/aapanel';
import { EasypanelAdapter } from './adapters/easypanel';
import { CosmosAdapter } from './adapters/cosmos';
import { CloudronAdapter } from './adapters/cloudron';
import { WebuzoAdapter } from './adapters/webuzo';
import { WebminAdapter } from './adapters/webmin';
import { TinyCPAdapter } from './adapters/tinycp';
import { KusanagiAdapter } from './adapters/kusanagi';
import { AdminBoltAdapter } from './adapters/adminbolt';

const ADAPTER_INSTANCES: ControlPanelAdapter[] = [
  new DokployAdapter(),
  new CoolifyAdapter(),
  new CloudPanelAdapter(),
  new CPanelAdapter(),
  new PleskAdapter(),
  new DirectAdminAdapter(),
  new CyberPanelAdapter(),
  new HestiaCPAdapter(),
  new FastpanelAdapter(),
  new AaPanelAdapter(),
  new EasypanelAdapter(),
  new CosmosAdapter(),
  new CloudronAdapter(),
  new WebuzoAdapter(),
  new WebminAdapter(),
  new TinyCPAdapter(),
  new KusanagiAdapter(),
  new AdminBoltAdapter(),
];

const ADAPTER_MAP = new Map<string, ControlPanelAdapter>();

for (const adapter of ADAPTER_INSTANCES) {
  ADAPTER_MAP.set(adapter.slug.toLowerCase(), adapter);
}

/**
 * Returns the adapter instance for a given panel slug, or null if not registered.
 */
export function getControlPanelAdapter(slug: string): ControlPanelAdapter | null {
  return ADAPTER_MAP.get(slug.toLowerCase().trim()) ?? null;
}

/**
 * Returns the adapter instance or throws an error if unknown.
 */
export function requireControlPanelAdapter(slug: string): ControlPanelAdapter {
  const adapter = getControlPanelAdapter(slug);
  if (!adapter) {
    throw new Error(`Unsupported control panel platform: '${slug}'`);
  }
  return adapter;
}

/**
 * Lists all 18 registered control panel adapters.
 */
export function listControlPanelAdapters(): ControlPanelAdapter[] {
  return [...ADAPTER_INSTANCES];
}

/**
 * Generates an augmented Cloud-Init user-data payload that sets up hostname, SSH keys,
 * CloudHost247 agent telemetry, and the target control panel's automated installer.
 */
export function buildServerCloudInitWithControlPanel(input: {
  hostname: string;
  sshKeys: string[];
  agentId: string;
  agentSecret: string;
  controlUrl: string;
  installerUrl: string;
  controlPanelSlug?: string | null;
  controlPanelOptions?: Partial<ControlPanelInstallOptions>;
  osSlug?: string;
  osVersion?: string;
  architecture?: 'x86_64' | 'arm64';
}): string {
  const keys = input.sshKeys.map((key) => `      - ${JSON.stringify(key)}`).join('\n');
  
  const baseInstall = [
    `curl -fsSL '${input.installerUrl.replace(/'/g, `'\\''`)}' -o /tmp/cloudhost247-agent-install`,
    'chmod 0700 /tmp/cloudhost247-agent-install',
    `CH247_AGENT_ID='${input.agentId}' CH247_AGENT_SECRET='${input.agentSecret}' CH247_CONTROL_URL='${input.controlUrl.replace(/'/g, `'\\''`)}' /tmp/cloudhost247-agent-install`,
    'install -d -m 700 /var/lib/cloudhost247 && install -m 600 /dev/null /var/lib/cloudhost247/security-configured',
  ];

  let panelRunCmd = '';
  if (input.controlPanelSlug) {
    const adapter = getControlPanelAdapter(input.controlPanelSlug);
    if (adapter) {
      const panelScript = adapter.generateInstallScript({
        hostname: input.hostname,
        agentId: input.agentId,
        agentSecret: input.agentSecret,
        controlUrl: input.controlUrl,
        osSlug: input.osSlug ?? 'ubuntu',
        osVersion: input.osVersion ?? '24.04',
        architecture: input.architecture ?? 'x86_64',
        ...input.controlPanelOptions,
      });

      // Write script to /var/lib/cloudhost247/install-panel.sh and execute
      baseInstall.push(
        `cat << 'EOF' > /var/lib/cloudhost247/install-panel.sh\n${panelScript}\nEOF`,
        'chmod 0700 /var/lib/cloudhost247/install-panel.sh',
        '/var/lib/cloudhost247/install-panel.sh > /var/log/cloudhost247-panel-bootstrap.log 2>&1'
      );
    }
  }

  const installCmd = baseInstall.join(' && ');

  return `#cloud-config
hostname: ${input.hostname}
manage_etc_hosts: true
ssh_pwauth: false
disable_root: false
users:
  - default
  - name: root
    ssh_authorized_keys:
${keys}
package_update: true
packages:
  - curl
  - ca-certificates
  - tar
  - gzip
runcmd:
  - [ sh, -lc, ${JSON.stringify(installCmd)} ]
`;
}
