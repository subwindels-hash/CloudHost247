import { BaseControlPanelAdapter } from './base';
import type {
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  FirewallPortRule,
} from '../types';

export class DokployAdapter extends BaseControlPanelAdapter {
  readonly slug = 'dokploy';
  readonly name = 'Dokploy';
  readonly category: ControlPanelCategory = 'APPLICATION_DEPLOYMENT_PLATFORM';
  readonly installationMethod: ControlPanelInstallationMethod = 'DOCKER';
  readonly defaultPort = 3000;
  readonly defaultProtocol = 'http' as const;
  readonly defaultPath = '/';
  readonly supportedOs = ['ubuntu', 'debian'];
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
    docker: true,
    docker_compose: true,
    traefik: true,
    git_deploy: true,
    multi_user: true,
    app_templates: true,
  };

  getRequiredFirewallPorts(): FirewallPortRule[] {
    return [
      { port: 80, protocol: 'tcp', description: 'HTTP / Traefik reverse proxy' },
      { port: 443, protocol: 'tcp', description: 'HTTPS / SSL termination' },
      { port: 3000, protocol: 'tcp', description: 'Dokploy dashboard' },
    ];
  }

  getInstallCommands(options: ControlPanelInstallOptions): string[] {
    return [
      '# Install Docker if not present',
      `if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  systemctl enable docker
  systemctl start docker
fi`,
      '# Run Dokploy installation script',
      'curl -sSL https://dokploy.com/setup.sh | sh',
    ];
  }
}
