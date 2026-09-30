import { BaseControlPanelAdapter } from './base';
import type {
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  FirewallPortRule,
} from '../types';

export class FastpanelAdapter extends BaseControlPanelAdapter {
  readonly slug = 'fastpanel';
  readonly name = 'FASTPANEL';
  readonly category: ControlPanelCategory = 'SERVER_PANEL';
  readonly installationMethod: ControlPanelInstallationMethod = 'SCRIPT';
  readonly defaultPort = 8888;
  readonly defaultProtocol = 'https' as const;
  readonly defaultPath = '/';
  readonly supportedOs = ['debian', 'ubuntu', 'almalinux', 'rocky-linux'];
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
      { port: 8888, protocol: 'tcp', description: 'FASTPANEL Admin UI' },
      { port: 80, protocol: 'tcp', description: 'HTTP' },
      { port: 443, protocol: 'tcp', description: 'HTTPS' },
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
      '# Run FASTPANEL installer',
      'wget -q http://repo.fastpanel.direct/install_fastpanel.sh -O - | bash -',
    ];
  }
}
