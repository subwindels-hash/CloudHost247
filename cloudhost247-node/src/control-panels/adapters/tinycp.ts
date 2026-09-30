import { BaseControlPanelAdapter } from './base';
import type {
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  FirewallPortRule,
} from '../types';

export class TinyCPAdapter extends BaseControlPanelAdapter {
  readonly slug = 'tinycp';
  readonly name = 'TinyCP';
  readonly category: ControlPanelCategory = 'SERVER_PANEL';
  readonly installationMethod: ControlPanelInstallationMethod = 'SCRIPT';
  readonly defaultPort = 8080;
  readonly defaultProtocol = 'http' as const;
  readonly defaultPath = '/';
  readonly supportedOs = ['ubuntu', 'debian'];
  readonly minimumRequirements: ControlPanelMinimumRequirements = {
    ramMb: 512,
    cpuCores: 1,
    diskGb: 5,
  };
  readonly capabilities: ControlPanelCapabilities = {
    domains: true,
    databases: true,
    email: true,
    dns: false,
    ssl: true,
    docker: false,
    multi_user: false,
  };

  getRequiredFirewallPorts(): FirewallPortRule[] {
    return [
      { port: 8080, protocol: 'tcp', description: 'TinyCP Web Interface' },
      { port: 80, protocol: 'tcp', description: 'HTTP' },
      { port: 443, protocol: 'tcp', description: 'HTTPS' },
      { port: 25, protocol: 'tcp', description: 'SMTP' },
      { port: 587, protocol: 'tcp', description: 'SMTP Submission' },
      { port: 993, protocol: 'tcp', description: 'IMAPS' },
    ];
  }

  getInstallCommands(options: ControlPanelInstallOptions): string[] {
    return [
      '# Download and run TinyCP installer',
      'curl -fsSL https://tinycp.com/download.sh -o /tmp/tinycp-download.sh',
      'bash /tmp/tinycp-download.sh',
    ];
  }
}
