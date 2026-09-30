import { BaseControlPanelAdapter } from './base';
import type {
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  FirewallPortRule,
} from '../types';

export class CyberPanelAdapter extends BaseControlPanelAdapter {
  readonly slug = 'cyberpanel';
  readonly name = 'CyberPanel';
  readonly category: ControlPanelCategory = 'SERVER_PANEL';
  readonly installationMethod: ControlPanelInstallationMethod = 'SCRIPT';
  readonly defaultPort = 8090;
  readonly defaultProtocol = 'https' as const;
  readonly defaultPath = '/';
  readonly supportedOs = ['almalinux', 'ubuntu'];
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
    multi_user: true,
    backups: true,
  };

  getRequiredFirewallPorts(): FirewallPortRule[] {
    return [
      { port: 8090, protocol: 'tcp', description: 'CyberPanel Admin Portal' },
      { port: 7080, protocol: 'tcp', description: 'OpenLiteSpeed Admin WebGUI' },
      { port: 80, protocol: 'tcp', description: 'HTTP' },
      { port: 443, protocol: 'tcp', description: 'HTTPS / QUIC' },
      { port: 443, protocol: 'udp', description: 'HTTP/3 / QUIC UDP' },
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
      '# Run CyberPanel unattended automated installation',
      'sh <(curl -fsSL https://cyberpanel.net/install.sh || wget -O - -q https://cyberpanel.net/install.sh)',
    ];
  }
}
