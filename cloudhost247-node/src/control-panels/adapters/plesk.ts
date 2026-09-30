import { BaseControlPanelAdapter } from './base';
import type {
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  FirewallPortRule,
} from '../types';

export class PleskAdapter extends BaseControlPanelAdapter {
  readonly slug = 'plesk';
  readonly name = 'Plesk Obsidian';
  readonly category: ControlPanelCategory = 'SERVER_PANEL';
  readonly installationMethod: ControlPanelInstallationMethod = 'SCRIPT';
  readonly defaultPort = 8443;
  readonly defaultProtocol = 'https' as const;
  readonly defaultPath = '/';
  readonly supportedOs = ['ubuntu', 'debian', 'almalinux', 'rocky-linux'];
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
    docker: true,
    reseller: true,
    multi_user: true,
    backups: true,
    wordpress_toolkit: true,
    nodejs: true,
  };

  getRequiredFirewallPorts(): FirewallPortRule[] {
    return [
      { port: 8443, protocol: 'tcp', description: 'Plesk Admin Panel (HTTPS)' },
      { port: 8880, protocol: 'tcp', description: 'Plesk Admin Panel (HTTP)' },
      { port: 8447, protocol: 'tcp', description: 'Plesk Autoinstaller' },
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
    return [
      '# Download and run Plesk one-click installer',
      'sh <(curl -fsSL https://autoinstall.plesk.com/one-click-installer || wget -O - -q https://autoinstall.plesk.com/one-click-installer)',
    ];
  }
}
