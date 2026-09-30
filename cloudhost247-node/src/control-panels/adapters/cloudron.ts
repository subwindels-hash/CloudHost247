import { BaseControlPanelAdapter } from './base';
import type {
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  FirewallPortRule,
} from '../types';

export class CloudronAdapter extends BaseControlPanelAdapter {
  readonly slug = 'cloudron';
  readonly name = 'Cloudron';
  readonly category: ControlPanelCategory = 'APPLICATION_DEPLOYMENT_PLATFORM';
  readonly installationMethod: ControlPanelInstallationMethod = 'SCRIPT';
  readonly defaultPort = 443;
  readonly defaultProtocol = 'https' as const;
  readonly defaultPath = '/';
  readonly supportedOs = ['ubuntu'];
  readonly minimumRequirements: ControlPanelMinimumRequirements = {
    ramMb: 2048,
    cpuCores: 2,
    diskGb: 20,
  };
  readonly capabilities: ControlPanelCapabilities = {
    domains: true,
    databases: true,
    email: true,
    dns: true,
    ssl: true,
    docker: true,
    backups: true,
    app_templates: true,
  };

  getRequiredFirewallPorts(): FirewallPortRule[] {
    return [
      { port: 80, protocol: 'tcp', description: 'HTTP' },
      { port: 443, protocol: 'tcp', description: 'HTTPS / Cloudron Dashboard' },
      { port: 25, protocol: 'tcp', description: 'SMTP' },
      { port: 587, protocol: 'tcp', description: 'SMTP Submission' },
      { port: 465, protocol: 'tcp', description: 'SMTPS' },
      { port: 993, protocol: 'tcp', description: 'IMAPS' },
    ];
  }

  getInstallCommands(options: ControlPanelInstallOptions): string[] {
    return [
      '# Download and run Cloudron setup utility',
      'wget -q https://cloudron.io/cloudron-setup -O /tmp/cloudron-setup',
      'chmod +x /tmp/cloudron-setup',
      '/tmp/cloudron-setup --provider generic',
    ];
  }
}
