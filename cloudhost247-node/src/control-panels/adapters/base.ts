import type {
  ControlPanelAdapter,
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  ControlPanelAccessInfo,
  FirewallPortRule,
  CompatibilityCheckResult,
} from '../types';

export abstract class BaseControlPanelAdapter implements ControlPanelAdapter {
  abstract readonly slug: string;
  abstract readonly name: string;
  abstract readonly category: ControlPanelCategory;
  abstract readonly installationMethod: ControlPanelInstallationMethod;
  abstract readonly defaultPort: number;
  abstract readonly defaultProtocol: 'http' | 'https';
  abstract readonly defaultPath: string;
  abstract readonly supportedOs: string[];
  abstract readonly minimumRequirements: ControlPanelMinimumRequirements;
  abstract readonly capabilities: ControlPanelCapabilities;

  abstract getRequiredFirewallPorts(): FirewallPortRule[];
  abstract getInstallCommands(options: ControlPanelInstallOptions): string[];

  /**
   * Helper to quote shell arguments securely.
   */
  protected shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  }

  /**
   * Returns default access information for the provisioned server.
   */
  getAccessInfo(ipOrHostname: string, options?: Partial<ControlPanelInstallOptions>): ControlPanelAccessInfo {
    const portStr = (this.defaultProtocol === 'http' && this.defaultPort === 80) ||
                    (this.defaultProtocol === 'https' && this.defaultPort === 443)
                    ? ''
                    : `:${this.defaultPort}`;
    const cleanPath = this.defaultPath.startsWith('/') ? this.defaultPath : `/${this.defaultPath}`;
    const url = `${this.defaultProtocol}://${ipOrHostname}${portStr}${cleanPath === '/' ? '' : cleanPath}`;

    return {
      panelName: this.name,
      defaultPort: this.defaultPort,
      protocol: this.defaultProtocol,
      path: this.defaultPath,
      url,
      defaultUsername: options?.adminEmail ?? 'root',
      firewallPorts: this.getRequiredFirewallPorts(),
    };
  }

  /**
   * Generates a complete, idempotent shell installation script with logging and status reporting.
   */
  generateInstallScript(options: ControlPanelInstallOptions): string {
    const commands = this.getInstallCommands(options);
    const logPath = '/var/log/cloudhost247-panel-install.log';
    const statusFile = '/var/lib/cloudhost247/panel-installed';

    return `#!/bin/bash
set -euo pipefail
exec > >(tee -a ${logPath}) 2>&1

echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Starting automated installation for ${this.name} (${this.slug})..."

mkdir -p /var/lib/cloudhost247
export DEBIAN_FRONTEND=noninteractive

${commands.join('\n\n')}

echo "${this.slug}" > ${statusFile}
echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] ${this.name} installation completed successfully."
`;
  }

  /**
   * Validates OS and hardware compatibility.
   */
  validateCompatibility(
    osSlug: string,
    ramMb: number,
    cpuCores: number,
    diskGb: number
  ): CompatibilityCheckResult {
    const reasons: string[] = [];

    // Check OS
    const normalizedOs = osSlug.toLowerCase();
    const osSupported = this.supportedOs.some(
      (os) => normalizedOs.includes(os) || os.includes(normalizedOs)
    );
    if (!osSupported) {
      reasons.push(
        `Operating system '${osSlug}' is not in the supported list (${this.supportedOs.join(', ')}).`
      );
    }

    // Check RAM
    if (ramMb < this.minimumRequirements.ramMb) {
      reasons.push(
        `Server RAM (${ramMb} MB) is below the minimum required (${this.minimumRequirements.ramMb} MB).`
      );
    }

    // Check CPU
    if (cpuCores < this.minimumRequirements.cpuCores) {
      reasons.push(
        `Server CPU cores (${cpuCores}) is below the minimum required (${this.minimumRequirements.cpuCores}).`
      );
    }

    // Check Disk
    if (diskGb < this.minimumRequirements.diskGb) {
      reasons.push(
        `Server storage (${diskGb} GB) is below the minimum required (${this.minimumRequirements.diskGb} GB).`
      );
    }

    return {
      compatible: reasons.length === 0,
      reasons,
    };
  }
}
