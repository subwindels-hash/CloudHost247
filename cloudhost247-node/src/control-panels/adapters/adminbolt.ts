import { BaseControlPanelAdapter } from './base';
import type {
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  ControlPanelAccessInfo,
  FirewallPortRule,
} from '../types';

export class AdminBoltAdapter extends BaseControlPanelAdapter {
  readonly slug = 'adminbolt';
  readonly name = 'AdminBolt';
  readonly category: ControlPanelCategory = 'SERVER_MANAGEMENT';
  readonly installationMethod: ControlPanelInstallationMethod = 'AGENT';
  readonly defaultPort = 443;
  readonly defaultProtocol = 'https' as const;
  readonly defaultPath = '/';
  readonly supportedOs = ['ubuntu', 'debian', 'almalinux', 'rocky-linux'];
  readonly minimumRequirements: ControlPanelMinimumRequirements = {
    ramMb: 512,
    cpuCores: 1,
    diskGb: 5,
  };
  readonly capabilities: ControlPanelCapabilities = {
    domains: false,
    databases: false,
    email: false,
    dns: false,
    ssl: false,
    docker: false,
    system_monitoring: true,
    remote_management: true,
  };

  getRequiredFirewallPorts(): FirewallPortRule[] {
    // AdminBolt connects outbound over HTTPS to CloudHost247 Telemetry Ingest; no incoming ports required
    return [];
  }

  getAccessInfo(ipOrHostname: string, options?: Partial<ControlPanelInstallOptions>): ControlPanelAccessInfo {
    return {
      panelName: this.name,
      defaultPort: this.defaultPort,
      protocol: this.defaultProtocol,
      path: '/dashboard/servers',
      url: `https://app.cloudhost247.com/dashboard/servers`,
      defaultUsername: options?.adminEmail ?? 'root',
      notes: ['AdminBolt telemetry is integrated directly into your CloudHost247 server management dashboard.'],
      firewallPorts: this.getRequiredFirewallPorts(),
    };
  }

  getInstallCommands(options: ControlPanelInstallOptions): string[] {
    const token = options.agentSecret ?? 'default';
    const controlUrl = options.controlUrl ?? 'https://app.cloudhost247.com';
    return [
      '# Install and activate AdminBolt Telemetry Daemon',
      `curl -fsSL https://agent.cloudhost247.com/install.sh -o /tmp/adminbolt-install.sh || true`,
      `if [ -f /tmp/adminbolt-install.sh ]; then bash /tmp/adminbolt-install.sh --token ${this.shellQuote(token)} --url ${this.shellQuote(controlUrl)}; fi`,
    ];
  }
}
