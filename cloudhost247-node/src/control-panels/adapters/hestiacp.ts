import { BaseControlPanelAdapter } from './base';
import type {
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  FirewallPortRule,
} from '../types';

export class HestiaCPAdapter extends BaseControlPanelAdapter {
  readonly slug = 'hestiacp';
  readonly name = 'HestiaCP';
  readonly category: ControlPanelCategory = 'SERVER_PANEL';
  readonly installationMethod: ControlPanelInstallationMethod = 'SCRIPT';
  readonly defaultPort = 8083;
  readonly defaultProtocol = 'https' as const;
  readonly defaultPath = '/';
  readonly supportedOs = ['debian', 'ubuntu'];
  readonly minimumRequirements: ControlPanelMinimumRequirements = {
    ramMb: 1024,
    cpuCores: 1,
    diskGb: 10,
  };
  readonly capabilities: ControlPanelCapabilities = {
    domains: true,
    databases: true,
    email: true,
    dns: true,
    ssl: true,
    docker: false,
    multi_user: true,
    backups: true,
    php_version_switch: true,
  };

  getRequiredFirewallPorts(): FirewallPortRule[] {
    return [
      { port: 8083, protocol: 'tcp', description: 'HestiaCP Admin Panel' },
      { port: 80, protocol: 'tcp', description: 'HTTP' },
      { port: 443, protocol: 'tcp', description: 'HTTPS' },
      { port: 53, protocol: 'tcp', description: 'DNS TCP' },
      { port: 53, protocol: 'udp', description: 'DNS UDP' },
      { port: 25, protocol: 'tcp', description: 'SMTP' },
      { port: 587, protocol: 'tcp', description: 'SMTP Submission' },
      { port: 465, protocol: 'tcp', description: 'SMTPS' },
      { port: 993, protocol: 'tcp', description: 'IMAPS' },
      { port: 995, protocol: 'tcp', description: 'POP3S' },
    ];
  }

  getInstallCommands(options: ControlPanelInstallOptions): string[] {
    const email = options.adminEmail ?? 'admin@example.com';
    const password = options.adminPassword ? `--password ${this.shellQuote(options.adminPassword)}` : '';
    return [
      '# Download and run HestiaCP non-interactive installer',
      'wget -q https://raw.githubusercontent.com/hestiacp/hestiacp/release/install/hst-install.sh -O /tmp/hst-install.sh',
      `bash /tmp/hst-install.sh --interactive no --email ${this.shellQuote(email)} --hostname ${this.shellQuote(options.hostname)} -f -y no ${password}`,
    ];
  }
}
