import { BaseControlPanelAdapter } from './base';
import type {
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  FirewallPortRule,
} from '../types';

export class DirectAdminAdapter extends BaseControlPanelAdapter {
  readonly slug = 'directadmin';
  readonly name = 'DirectAdmin';
  readonly category: ControlPanelCategory = 'SERVER_PANEL';
  readonly installationMethod: ControlPanelInstallationMethod = 'SCRIPT';
  readonly defaultPort = 2222;
  readonly defaultProtocol = 'https' as const;
  readonly defaultPath = '/';
  readonly supportedOs = ['almalinux', 'rocky-linux', 'debian', 'ubuntu'];
  readonly minimumRequirements: ControlPanelMinimumRequirements = {
    ramMb: 1024,
    cpuCores: 1,
    diskGb: 20,
  };
  readonly capabilities: ControlPanelCapabilities = {
    domains: true,
    databases: true,
    email: true,
    dns: true,
    ssl: true,
    docker: false,
    reseller: true,
    multi_user: true,
    backups: true,
  };

  getRequiredFirewallPorts(): FirewallPortRule[] {
    return [
      { port: 2222, protocol: 'tcp', description: 'DirectAdmin Control Panel' },
      { port: 80, protocol: 'tcp', description: 'HTTP' },
      { port: 443, protocol: 'tcp', description: 'HTTPS' },
      { port: 53, protocol: 'tcp', description: 'DNS TCP' },
      { port: 53, protocol: 'udp', description: 'DNS UDP' },
      { port: 25, protocol: 'tcp', description: 'SMTP' },
      { port: 587, protocol: 'tcp', description: 'SMTP Submission' },
      { port: 465, protocol: 'tcp', description: 'SMTPS' },
      { port: 993, protocol: 'tcp', description: 'IMAPS' },
      { port: 995, protocol: 'tcp', description: 'POP3S' },
      { port: 21, protocol: 'tcp', description: 'FTP' },
    ];
  }

  getInstallCommands(options: ControlPanelInstallOptions): string[] {
    const licenseArg = options.licenseKey ? ` --license=${this.shellQuote(options.licenseKey)}` : '';
    return [
      '# Run DirectAdmin automated setup script',
      `bash <(curl -fsSL https://download.directadmin.com/setup.sh || wget -O - -q https://download.directadmin.com/setup.sh)${licenseArg}`,
    ];
  }
}
