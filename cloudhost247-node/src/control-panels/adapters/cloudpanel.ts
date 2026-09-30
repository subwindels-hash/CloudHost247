import { BaseControlPanelAdapter } from './base';
import type {
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  FirewallPortRule,
} from '../types';

export class CloudPanelAdapter extends BaseControlPanelAdapter {
  readonly slug = 'cloudpanel';
  readonly name = 'CloudPanel';
  readonly category: ControlPanelCategory = 'SERVER_PANEL';
  readonly installationMethod: ControlPanelInstallationMethod = 'SCRIPT';
  readonly defaultPort = 8443;
  readonly defaultProtocol = 'https' as const;
  readonly defaultPath = '/';
  readonly supportedOs = ['ubuntu', 'debian'];
  readonly minimumRequirements: ControlPanelMinimumRequirements = {
    ramMb: 1024,
    cpuCores: 1,
    diskGb: 15,
  };
  readonly capabilities: ControlPanelCapabilities = {
    domains: true,
    databases: true,
    email: false,
    dns: false,
    ssl: true,
    docker: true,
    multi_user: true,
    nodejs: true,
    python: true,
    php_version_switch: true,
  };

  getRequiredFirewallPorts(): FirewallPortRule[] {
    return [
      { port: 80, protocol: 'tcp', description: 'HTTP' },
      { port: 443, protocol: 'tcp', description: 'HTTPS' },
      { port: 8443, protocol: 'tcp', description: 'CloudPanel Admin UI' },
      { port: 3306, protocol: 'tcp', description: 'MySQL Database (optional remote)' },
    ];
  }

  getInstallCommands(options: ControlPanelInstallOptions): string[] {
    return [
      '# Download and run CloudPanel v2 installer',
      'curl -sS https://installer.cloudpanel.io/ce/v2/install.sh -o /tmp/cloudpanel_install.sh',
      'bash /tmp/cloudpanel_install.sh',
    ];
  }
}
