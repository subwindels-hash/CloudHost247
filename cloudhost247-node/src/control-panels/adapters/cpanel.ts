import { BaseControlPanelAdapter } from './base';
import type {
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  FirewallPortRule,
} from '../types';

export class CPanelAdapter extends BaseControlPanelAdapter {
  readonly slug = 'cpanel';
  readonly name = 'cPanel & WHM';
  readonly category: ControlPanelCategory = 'SERVER_PANEL';
  readonly installationMethod: ControlPanelInstallationMethod = 'SCRIPT';
  readonly defaultPort = 2087;
  readonly defaultProtocol = 'https' as const;
  readonly defaultPath = '/';
  readonly supportedOs = ['almalinux', 'rocky-linux', 'ubuntu', 'cloudlinux'];
  readonly minimumRequirements: ControlPanelMinimumRequirements = {
    ramMb: 2048,
    cpuCores: 1,
    diskGb: 40,
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
    file_manager: true,
    php_version_switch: true,
  };

  getRequiredFirewallPorts(): FirewallPortRule[] {
    return [
      { port: 2087, protocol: 'tcp', description: 'WHM WebHost Manager (SSL)' },
      { port: 2083, protocol: 'tcp', description: 'cPanel User Portal (SSL)' },
      { port: 2086, protocol: 'tcp', description: 'WHM (Non-SSL)' },
      { port: 2082, protocol: 'tcp', description: 'cPanel (Non-SSL)' },
      { port: 2096, protocol: 'tcp', description: 'Webmail (SSL)' },
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
      '# Prepare directory and fetch official cPanel installer',
      'cd /home',
      'curl -o /home/latest -L https://securedownloads.cpanel.net/latest',
      'sh /home/latest --skip-cloudlinux',
    ];
  }
}
