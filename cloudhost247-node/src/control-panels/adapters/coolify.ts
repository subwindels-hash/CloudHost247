import { BaseControlPanelAdapter } from './base';
import type {
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  FirewallPortRule,
} from '../types';

export class CoolifyAdapter extends BaseControlPanelAdapter {
  readonly slug = 'coolify';
  readonly name = 'Coolify';
  readonly category: ControlPanelCategory = 'APPLICATION_DEPLOYMENT_PLATFORM';
  readonly installationMethod: ControlPanelInstallationMethod = 'DOCKER';
  readonly defaultPort = 8000;
  readonly defaultProtocol = 'http' as const;
  readonly defaultPath = '/';
  readonly supportedOs = ['ubuntu', 'debian'];
  readonly minimumRequirements: ControlPanelMinimumRequirements = {
    ramMb: 2048,
    cpuCores: 2,
    diskGb: 30,
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
    multi_user: true,
    backups: true,
    app_templates: true,
  };

  getRequiredFirewallPorts(): FirewallPortRule[] {
    return [
      { port: 80, protocol: 'tcp', description: 'HTTP / Traefik Web' },
      { port: 443, protocol: 'tcp', description: 'HTTPS / Traefik WebSecure' },
      { port: 8000, protocol: 'tcp', description: 'Coolify UI dashboard' },
      { port: 6001, protocol: 'tcp', description: 'Coolify WebSocket / Realtime' },
    ];
  }

  getInstallCommands(options: ControlPanelInstallOptions): string[] {
    return [
      '# Run official Coolify automated installer',
      'curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash',
    ];
  }
}
