import { BaseControlPanelAdapter } from './base';
import type {
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  FirewallPortRule,
} from '../types';

export class KusanagiAdapter extends BaseControlPanelAdapter {
  readonly slug = 'kusanagi';
  readonly name = 'Kusanagi';
  readonly category: ControlPanelCategory = 'SERVER_PANEL';
  readonly installationMethod: ControlPanelInstallationMethod = 'SCRIPT';
  readonly defaultPort = 8443;
  readonly defaultProtocol = 'https' as const;
  readonly defaultPath = '/';
  readonly supportedOs = ['almalinux', 'rocky-linux', 'centos'];
  readonly minimumRequirements: ControlPanelMinimumRequirements = {
    ramMb: 2048,
    cpuCores: 1,
    diskGb: 20,
  };
  readonly capabilities: ControlPanelCapabilities = {
    domains: true,
    databases: true,
    email: false,
    dns: false,
    ssl: true,
    docker: false,
    multi_user: false,
  };

  getRequiredFirewallPorts(): FirewallPortRule[] {
    return [
      { port: 80, protocol: 'tcp', description: 'HTTP' },
      { port: 443, protocol: 'tcp', description: 'HTTPS' },
      { port: 8443, protocol: 'tcp', description: 'Kusanagi Web Manager' },
    ];
  }

  getInstallCommands(options: ControlPanelInstallOptions): string[] {
    return [
      '# Setup Kusanagi repository and initialize high-speed stack',
      'dnf install -y https://repo.prime-strategy.co.jp/kusanagi/kusanagi-release-latest.noarch.rpm || yum install -y https://repo.prime-strategy.co.jp/kusanagi/kusanagi-release-latest.noarch.rpm',
      'dnf install -y kusanagi || yum install -y kusanagi',
      'kusanagi init --passwd root --noprompt || true',
    ];
  }
}
