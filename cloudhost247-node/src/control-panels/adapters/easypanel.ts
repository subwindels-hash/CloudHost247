import { BaseControlPanelAdapter } from './base';
import type {
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  FirewallPortRule,
} from '../types';

export class EasypanelAdapter extends BaseControlPanelAdapter {
  readonly slug = 'easypanel';
  readonly name = 'Easypanel';
  readonly category: ControlPanelCategory = 'APPLICATION_DEPLOYMENT_PLATFORM';
  readonly installationMethod: ControlPanelInstallationMethod = 'DOCKER';
  readonly defaultPort = 3000;
  readonly defaultProtocol = 'http' as const;
  readonly defaultPath = '/';
  readonly supportedOs = ['ubuntu', 'debian'];
  readonly minimumRequirements: ControlPanelMinimumRequirements = {
    ramMb: 1024,
    cpuCores: 1,
    diskGb: 20,
  };
  readonly capabilities: ControlPanelCapabilities = {
    domains: true,
    databases: true,
    email: false,
    dns: false,
    ssl: true,
    docker: true,
    docker_compose: true,
    traefik: true,
    git_deploy: true,
    app_templates: true,
  };

  getRequiredFirewallPorts(): FirewallPortRule[] {
    return [
      { port: 80, protocol: 'tcp', description: 'HTTP / Traefik' },
      { port: 443, protocol: 'tcp', description: 'HTTPS / Traefik SSL' },
      { port: 3000, protocol: 'tcp', description: 'Easypanel Web Dashboard' },
    ];
  }

  getInstallCommands(options: ControlPanelInstallOptions): string[] {
    return [
      '# Run Easypanel Docker-based installation',
      'curl -sSL https://get.easypanel.io | sh',
    ];
  }
}
