import { BaseControlPanelAdapter } from './base';
import type {
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  FirewallPortRule,
} from '../types';

export class AaPanelAdapter extends BaseControlPanelAdapter {
  readonly slug = 'aapanel';
  readonly name = 'aaPanel';
  readonly category: ControlPanelCategory = 'SERVER_PANEL';
  readonly installationMethod: ControlPanelInstallationMethod = 'SCRIPT';
  readonly defaultPort = 7800;
  readonly defaultProtocol = 'https' as const;
  readonly defaultPath = '/';
  readonly supportedOs = ['ubuntu', 'debian', 'almalinux', 'rocky-linux'];
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
    docker: true,
    multi_user: false,
    backups: true,
    file_manager: true,
  };

  getRequiredFirewallPorts(): FirewallPortRule[] {
    return [
      { port: 7800, protocol: 'tcp', description: 'aaPanel Admin Interface' },
      { port: 8888, protocol: 'tcp', description: 'aaPanel Default Alternate Port' },
      { port: 80, protocol: 'tcp', description: 'HTTP' },
      { port: 443, protocol: 'tcp', description: 'HTTPS' },
      { port: 21, protocol: 'tcp', description: 'FTP' },
      { port: 3306, protocol: 'tcp', description: 'MySQL' },
    ];
  }

  getInstallCommands(options: ControlPanelInstallOptions): string[] {
    return [
      '# Run aaPanel automated install script',
      'wget -O /tmp/aapanel_install.sh http://www.aapanel.com/script/install-ubuntu_6.0_en.sh',
      'echo "y" | bash /tmp/aapanel_install.sh aapanel',
    ];
  }
}
