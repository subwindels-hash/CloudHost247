import { BaseControlPanelAdapter } from './base';
import type {
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  FirewallPortRule,
} from '../types';

export class WebminAdapter extends BaseControlPanelAdapter {
  readonly slug = 'webmin';
  readonly name = 'Webmin';
  readonly category: ControlPanelCategory = 'SERVER_PANEL';
  readonly installationMethod: ControlPanelInstallationMethod = 'SCRIPT';
  readonly defaultPort = 10000;
  readonly defaultProtocol = 'https' as const;
  readonly defaultPath = '/';
  readonly supportedOs = ['ubuntu', 'debian', 'almalinux', 'rocky-linux', 'fedora-cloud', 'centos', 'opensuse'];
  readonly minimumRequirements: ControlPanelMinimumRequirements = {
    ramMb: 512,
    cpuCores: 1,
    diskGb: 5,
  };
  readonly capabilities: ControlPanelCapabilities = {
    domains: false,
    databases: true,
    email: false,
    dns: true,
    ssl: true,
    docker: false,
    multi_user: true,
    system_monitoring: true,
  };

  getRequiredFirewallPorts(): FirewallPortRule[] {
    return [
      { port: 10000, protocol: 'tcp', description: 'Webmin Web Interface' },
    ];
  }

  getInstallCommands(options: ControlPanelInstallOptions): string[] {
    return [
      '# Download and run Webmin repository setup script',
      'curl -o /tmp/setup-repos.sh -fsSL https://raw.githubusercontent.com/webmin/webmin/master/setup-repos.sh',
      'sh /tmp/setup-repos.sh -y',
      'if command -v apt-get &> /dev/null; then apt-get update && apt-get install -y --install-recommends webmin; elif command -v dnf &> /dev/null; then dnf install -y webmin; elif command -v yum &> /dev/null; then yum install -y webmin; fi',
    ];
  }
}
