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
import {
  ControlPanelOperationError,
  controlPanelOperationNotImplemented,
} from '../errors';

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
   * Generates a shell bootstrap template with logging. A zero exit from its commands is not
   * provider acceptance or proof that the panel is installed and healthy.
   */
  generateInstallScript(options: ControlPanelInstallOptions): string {
    const commands = this.getInstallCommands(options);
    const logPath = '/var/log/cloudhost247-panel-install.log';

    return `#!/bin/bash
set -euo pipefail
exec > >(tee -a ${logPath}) 2>&1

echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Starting automated installation for ${this.name} (${this.slug})..."

mkdir -p /var/lib/cloudhost247
export DEBIAN_FRONTEND=noninteractive

${commands.join('\n\n')}

echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Bootstrap command sequence exited successfully; panel installation and provider acceptance remain unverified."
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
   *
   * This is a local check over the static capability catalogue, not an upstream call. It stays for
   * subclasses that override an operation and still want to gate it, and it fails closed with a
   * typed, non-retryable error rather than a plain `Error`.
   */
  protected assertCapability(capability: keyof ControlPanelCapabilities, operationName: string): void {
    if (!this.capabilities[capability]) {
      throw new ControlPanelOperationError(
        this.slug,
        operationName,
        'UNSUPPORTED_OPERATION',
        `Operation '${operationName}' is not supported by ${this.name} (${this.slug}). Capability '${String(capability)}' is false.`
      );
    }
  }

  /**
   * Every management operation below fails closed with `NOT_IMPLEMENTED`.
   *
   * None of them is wired to a real panel upstream in this build, so answering `success: true`,
   * `ACTIVE` or `healthy: true` would fabricate a result no provider produced — a caller would
   * believe an account was created, a domain configured or a certificate issued when nothing was
   * ever contacted. The local, read-only surfaces above (`generateInstallScript`, `getAccessInfo`,
   * `validateCompatibility`, `getRequiredFirewallPorts`) remain usable; everything that would
   * mutate or read a real panel refuses by name, with the reason on the record.
   */

  async install(options: ControlPanelInstallOptions): Promise<ControlPanelOperationResult> {
    void options;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'install',
      hint: 'The installation payload can still be generated locally with generateInstallScript(); it is neither executed nor verified upstream.',
    });
  }

  async uninstall(options: { serverIp: string }): Promise<ControlPanelOperationResult> {
    void options;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'uninstall',
    });
  }

  async configure(options: Record<string, unknown>): Promise<ControlPanelOperationResult> {
    void options;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'configure',
    });
  }

  async getStatus(target: { serverIp: string }): Promise<{ status: string; version?: string }> {
    void target;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'getStatus',
    });
  }

  async healthCheck(target: { serverIp: string }): Promise<{ healthy: boolean; details?: string }> {
    void target;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'healthCheck',
    });
  }

  async createAccount(options: Record<string, unknown>): Promise<ControlPanelOperationResult> {
    void options;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'createAccount',
    });
  }

  async suspendAccount(options: Record<string, unknown>): Promise<ControlPanelOperationResult> {
    void options;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'suspendAccount',
    });
  }

  async unsuspendAccount(options: Record<string, unknown>): Promise<ControlPanelOperationResult> {
    void options;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'unsuspendAccount',
    });
  }

  async terminateAccount(options: Record<string, unknown>): Promise<ControlPanelOperationResult> {
    void options;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'terminateAccount',
    });
  }

  async createDomain(options: { domain: string; serverIp?: string }): Promise<ControlPanelOperationResult> {
    void options;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'createDomain',
    });
  }

  async deleteDomain(options: { domain: string }): Promise<ControlPanelOperationResult> {
    void options;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'deleteDomain',
    });
  }

  async createSubdomain(options: { domain: string; subdomain: string }): Promise<ControlPanelOperationResult> {
    void options;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'createSubdomain',
    });
  }

  async createDatabase(options: { databaseName: string; user?: string }): Promise<ControlPanelOperationResult> {
    void options;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'createDatabase',
    });
  }

  async deleteDatabase(options: { databaseName: string }): Promise<ControlPanelOperationResult> {
    void options;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'deleteDatabase',
    });
  }

  async createEmailAccount(options: { email: string; quotaMb?: number }): Promise<ControlPanelOperationResult> {
    void options;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'createEmailAccount',
    });
  }

  async deleteEmailAccount(options: { email: string }): Promise<ControlPanelOperationResult> {
    void options;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'deleteEmailAccount',
    });
  }

  async createDNSRecord(options: Record<string, unknown>): Promise<ControlPanelOperationResult> {
    void options;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'createDNSRecord',
    });
  }

  async deleteDNSRecord(options: Record<string, unknown>): Promise<ControlPanelOperationResult> {
    void options;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'deleteDNSRecord',
    });
  }

  async issueSSL(options: { domain: string }): Promise<ControlPanelOperationResult> {
    void options;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'issueSSL',
    });
  }

  async renewSSL(options: { domain: string }): Promise<ControlPanelOperationResult> {
    void options;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'renewSSL',
    });
  }

  async getUsage(target: { serverIp: string }): Promise<Record<string, unknown>> {
    void target;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'getUsage',
    });
  }

  async restartService(serviceName: string): Promise<ControlPanelOperationResult> {
    void serviceName;
    throw controlPanelOperationNotImplemented({
      panelSlug: this.slug,
      panelName: this.name,
      operation: 'restartService',
    });
  }
}
