import { BaseControlPanelAdapter } from './base';
import type {
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  FirewallPortRule,
} from '../types';

export class WebuzoAdapter extends BaseControlPanelAdapter {
  readonly slug = 'webuzo';
  readonly name = 'Webuzo';
  readonly category: ControlPanelCategory = 'SERVER_PANEL';
  readonly installationMethod: ControlPanelInstallationMethod = 'SCRIPT';
  readonly defaultPort = 2004;
  readonly defaultProtocol = 'https' as const;
  readonly defaultPath = '/';
  readonly supportedOs = ['almalinux', 'rocky-linux', 'ubuntu'];
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
  };

  getRequiredFirewallPorts(): FirewallPortRule[] {
    return [
      { port: 2004, protocol: 'tcp', description: 'Webuzo Admin Portal (SSL)' },
      { port: 2002, protocol: 'tcp', description: 'Webuzo Admin Portal (Non-SSL)' },
      { port: 2005, protocol: 'tcp', description: 'Webuzo Enduser Panel (SSL)' },
      { port: 2003, protocol: 'tcp', description: 'Webuzo Enduser Panel (Non-SSL)' },
      { port: 80, protocol: 'tcp', description: 'HTTP' },
      { port: 443, protocol: 'tcp', description: 'HTTPS' },
      { port: 21, protocol: 'tcp', description: 'FTP' },
      { port: 25, protocol: 'tcp', description: 'SMTP' },
      { port: 587, protocol: 'tcp', description: 'SMTP Submission' },
    ];
  }

  getInstallCommands(options: ControlPanelInstallOptions): string[] {
    return [
      '# Download and run Webuzo automated installer',
      'wget -N -q http://files.webuzo.com/install.sh -O /tmp/webuzo-install.sh',
      'chmod 0755 /tmp/webuzo-install.sh',
      'bash /tmp/webuzo-install.sh',
    ];
  }
}
