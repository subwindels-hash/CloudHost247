import { BaseControlPanelAdapter } from './base';
import type {
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  FirewallPortRule,
} from '../types';

export class CosmosAdapter extends BaseControlPanelAdapter {
  readonly slug = 'cosmos';
  readonly name = 'Cosmos Cloud';
  readonly category: ControlPanelCategory = 'APPLICATION_DEPLOYMENT_PLATFORM';
  readonly installationMethod: ControlPanelInstallationMethod = 'DOCKER';
  readonly defaultPort = 3443;
  readonly defaultProtocol = 'https' as const;
  readonly defaultPath = '/';
  readonly supportedOs = ['ubuntu', 'debian'];
  readonly minimumRequirements: ControlPanelMinimumRequirements = {
    ramMb: 1024,
    cpuCores: 1,
    diskGb: 10,
  };
  readonly capabilities: ControlPanelCapabilities = {
    domains: true,
    databases: false,
    email: false,
    dns: false,
    ssl: true,
    docker: true,
    app_templates: true,
  };

  getRequiredFirewallPorts(): FirewallPortRule[] {
    return [
      { port: 80, protocol: 'tcp', description: 'HTTP' },
      { port: 443, protocol: 'tcp', description: 'HTTPS' },
      { port: 3443, protocol: 'tcp', description: 'Cosmos Cloud Admin Console' },
    ];
  }

  getInstallCommands(options: ControlPanelInstallOptions): string[] {
    return [
      '# Install Docker if missing',
      `if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi`,
      '# Launch Cosmos Server Container',
      `docker run -d --network host --privileged --name cosmos-server \\
  -v /var/run/docker.sock:/var/run/docker.sock \\
  -v /:/rootfs:ro \\
  -v /var/lib/cosmos:/config \\
  --restart always \\
  azukaar/cosmos-server:latest`,
    ];
  }
}
