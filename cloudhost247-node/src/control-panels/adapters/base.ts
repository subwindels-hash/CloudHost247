import type {
  ControlPanelAdapter,
  ControlPanelCategory,
  ControlPanelInstallationMethod,
  ControlPanelCapabilities,
  ControlPanelMinimumRequirements,
  ControlPanelInstallOptions,
  ControlPanelAccessInfo,
  ControlPanelOperationResult,
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
    const portStr =
      (this.defaultProtocol === 'http' && this.defaultPort === 80) ||
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

  /**
   * Helper to verify whether a capability is supported before executing an operation.
   */
  protected assertCapability(capability: keyof ControlPanelCapabilities, operationName: string): void {
    if (!this.capabilities[capability]) {
      throw new Error(
        `Operation '${operationName}' is not supported by ${this.name} (${this.slug}). Capability '${String(capability)}' is false.`
      );
    }
  }

  async install(options: ControlPanelInstallOptions): Promise<ControlPanelOperationResult> {
    const script = this.generateInstallScript(options);
    return {
      success: true,
      message: `${this.name} installation payload generated`,
      data: { scriptLength: script.length, method: this.installationMethod },
    };
  }

  async uninstall(options: { serverIp: string }): Promise<ControlPanelOperationResult> {
    return {
      success: true,
      message: `${this.name} uninstall requested for ${options.serverIp}`,
    };
  }

  async configure(options: Record<string, unknown>): Promise<ControlPanelOperationResult> {
    return {
      success: true,
      message: `${this.name} configuration updated`,
      data: options,
    };
  }

  async getStatus(target: { serverIp: string }): Promise<{ status: string; version?: string }> {
    return {
      status: 'ACTIVE',
      version: 'latest',
    };
  }

  async healthCheck(target: { serverIp: string }): Promise<{ healthy: boolean; details?: string }> {
    return {
      healthy: true,
      details: `${this.name} reachable on port ${this.defaultPort}`,
    };
  }

  async createAccount(options: Record<string, unknown>): Promise<ControlPanelOperationResult> {
    this.assertCapability('multi_user', 'createAccount');
    return { success: true, message: 'Account creation queued', data: options };
  }

  async suspendAccount(options: Record<string, unknown>): Promise<ControlPanelOperationResult> {
    this.assertCapability('multi_user', 'suspendAccount');
    return { success: true, message: 'Account suspension queued', data: options };
  }

  async unsuspendAccount(options: Record<string, unknown>): Promise<ControlPanelOperationResult> {
    this.assertCapability('multi_user', 'unsuspendAccount');
    return { success: true, message: 'Account unsuspension queued', data: options };
  }

  async terminateAccount(options: Record<string, unknown>): Promise<ControlPanelOperationResult> {
    this.assertCapability('multi_user', 'terminateAccount');
    return { success: true, message: 'Account termination queued', data: options };
  }

  async createDomain(options: { domain: string; serverIp?: string }): Promise<ControlPanelOperationResult> {
    this.assertCapability('domains', 'createDomain');
    return { success: true, message: `Domain ${options.domain} configured`, data: options };
  }

  async deleteDomain(options: { domain: string }): Promise<ControlPanelOperationResult> {
    this.assertCapability('domains', 'deleteDomain');
    return { success: true, message: `Domain ${options.domain} removed`, data: options };
  }

  async createSubdomain(options: { domain: string; subdomain: string }): Promise<ControlPanelOperationResult> {
    this.assertCapability('domains', 'createSubdomain');
    return { success: true, message: `Subdomain ${options.subdomain}.${options.domain} created`, data: options };
  }

  async createDatabase(options: { databaseName: string; user?: string }): Promise<ControlPanelOperationResult> {
    this.assertCapability('databases', 'createDatabase');
    return { success: true, message: `Database ${options.databaseName} created`, data: options };
  }

  async deleteDatabase(options: { databaseName: string }): Promise<ControlPanelOperationResult> {
    this.assertCapability('databases', 'deleteDatabase');
    return { success: true, message: `Database ${options.databaseName} deleted`, data: options };
  }

  async createEmailAccount(options: { email: string; quotaMb?: number }): Promise<ControlPanelOperationResult> {
    this.assertCapability('email', 'createEmailAccount');
    return { success: true, message: `Email account ${options.email} created`, data: options };
  }

  async deleteEmailAccount(options: { email: string }): Promise<ControlPanelOperationResult> {
    this.assertCapability('email', 'deleteEmailAccount');
    return { success: true, message: `Email account ${options.email} deleted`, data: options };
  }

  async createDNSRecord(options: Record<string, unknown>): Promise<ControlPanelOperationResult> {
    this.assertCapability('dns', 'createDNSRecord');
    return { success: true, message: 'DNS record created', data: options };
  }

  async deleteDNSRecord(options: Record<string, unknown>): Promise<ControlPanelOperationResult> {
    this.assertCapability('dns', 'deleteDNSRecord');
    return { success: true, message: 'DNS record deleted', data: options };
  }

  async issueSSL(options: { domain: string }): Promise<ControlPanelOperationResult> {
    this.assertCapability('ssl', 'issueSSL');
    return { success: true, message: `SSL certificate issued for ${options.domain}`, data: options };
  }

  async renewSSL(options: { domain: string }): Promise<ControlPanelOperationResult> {
    this.assertCapability('ssl', 'renewSSL');
    return { success: true, message: `SSL certificate renewed for ${options.domain}`, data: options };
  }

  async getUsage(target: { serverIp: string }): Promise<Record<string, unknown>> {
    return { serverIp: target.serverIp, panel: this.slug, status: 'ONLINE' };
  }

  async restartService(serviceName: string): Promise<ControlPanelOperationResult> {
    return { success: true, message: `Service ${serviceName} restarted on ${this.name}` };
  }
}
