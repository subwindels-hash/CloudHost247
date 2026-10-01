/**
 * Control Panel Adapter Types & Interfaces (Phase 4).
 *
 * Defines the unified contract across all 18 hosting control panels, PaaS engines,
 * and server management platforms supported by CloudHost247.
 */

export type ControlPanelCategory =
  | 'SERVER_PANEL'
  | 'APPLICATION_DEPLOYMENT_PLATFORM'
  | 'SERVER_MANAGEMENT'
  | 'OTHER';

export type ControlPanelInstallationMethod =
  | 'SCRIPT'
  | 'CLOUD_INIT'
  | 'AGENT'
  | 'DOCKER'
  | 'API'
  | 'MANUAL';

export interface ControlPanelCapabilities {
  domains?: boolean;
  databases?: boolean;
  email?: boolean;
  dns?: boolean;
  ssl?: boolean;
  docker?: boolean;
  docker_compose?: boolean;
  traefik?: boolean;
  git_deploy?: boolean;
  reseller?: boolean;
  multi_user?: boolean;
  backups?: boolean;
  file_manager?: boolean;
  php_version_switch?: boolean;
  wordpress_toolkit?: boolean;
  nodejs?: boolean;
  python?: boolean;
  system_monitoring?: boolean;
  remote_management?: boolean;
  app_templates?: boolean;
  [key: string]: boolean | undefined;
}

export interface ControlPanelMinimumRequirements {
  ramMb: number;
  cpuCores: number;
  diskGb: number;
}

export interface ControlPanelInstallOptions {
  hostname: string;
  serverIp?: string;
  adminEmail?: string;
  adminPassword?: string;
  licenseKey?: string;
  sshPort?: number;
  osSlug: string;
  osVersion: string;
  architecture: 'x86_64' | 'arm64';
  agentId?: string;
  agentSecret?: string;
  controlUrl?: string;
}

export interface FirewallPortRule {
  port: number;
  protocol: 'tcp' | 'udp';
  description: string;
}

export interface ControlPanelAccessInfo {
  panelName: string;
  defaultPort: number;
  protocol: 'http' | 'https';
  path: string;
  url: string;
  defaultUsername: string;
  credentialsLocation?: string;
  notes?: string[];
  firewallPorts: FirewallPortRule[];
}

export interface CompatibilityCheckResult {
  compatible: boolean;
  reasons: string[];
}

export interface ControlPanelOperationResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

export interface ControlPanelAdapter {
  readonly slug: string;
  readonly name: string;
  readonly category: ControlPanelCategory;
  readonly installationMethod: ControlPanelInstallationMethod;
  readonly defaultPort: number;
  readonly defaultProtocol: 'http' | 'https';
  readonly defaultPath: string;
  readonly supportedOs: string[];
  readonly minimumRequirements: ControlPanelMinimumRequirements;
  readonly capabilities: ControlPanelCapabilities;

  /**
   * Generates the shell install script or cloud-init execution payload.
   */
  generateInstallScript(options: ControlPanelInstallOptions): string;

  /**
   * Returns access information (URL, port, username, notes) for a provisioned server.
   */
  getAccessInfo(ipOrHostname: string, options?: Partial<ControlPanelInstallOptions>): ControlPanelAccessInfo;

  /**
   * Returns the list of firewall ports required for this panel to function.
   */
  getRequiredFirewallPorts(): FirewallPortRule[];

  /**
   * Validates whether a target OS and hardware specification meet the platform requirements.
   */
  validateCompatibility(
    osSlug: string,
    ramMb: number,
    cpuCores: number,
    diskGb: number
  ): CompatibilityCheckResult;

  /**
   * Standard control panel management operations (Section 7 & 8).
   * Capability-aware and fails closed if API/agent integration is unavailable.
   */
  install?(options: ControlPanelInstallOptions): Promise<ControlPanelOperationResult>;
  uninstall?(options: { serverIp: string }): Promise<ControlPanelOperationResult>;
  configure?(options: Record<string, unknown>): Promise<ControlPanelOperationResult>;
  getStatus?(target: { serverIp: string }): Promise<{ status: string; version?: string }>;
  healthCheck?(target: { serverIp: string }): Promise<{ healthy: boolean; details?: string }>;
  createAccount?(options: Record<string, unknown>): Promise<ControlPanelOperationResult>;
  suspendAccount?(options: Record<string, unknown>): Promise<ControlPanelOperationResult>;
  unsuspendAccount?(options: Record<string, unknown>): Promise<ControlPanelOperationResult>;
  terminateAccount?(options: Record<string, unknown>): Promise<ControlPanelOperationResult>;
  createDomain?(options: { domain: string; serverIp?: string }): Promise<ControlPanelOperationResult>;
  deleteDomain?(options: { domain: string }): Promise<ControlPanelOperationResult>;
  createSubdomain?(options: { domain: string; subdomain: string }): Promise<ControlPanelOperationResult>;
  createDatabase?(options: { databaseName: string; user?: string }): Promise<ControlPanelOperationResult>;
  deleteDatabase?(options: { databaseName: string }): Promise<ControlPanelOperationResult>;
  createEmailAccount?(options: { email: string; quotaMb?: number }): Promise<ControlPanelOperationResult>;
  deleteEmailAccount?(options: { email: string }): Promise<ControlPanelOperationResult>;
  createDNSRecord?(options: Record<string, unknown>): Promise<ControlPanelOperationResult>;
  deleteDNSRecord?(options: Record<string, unknown>): Promise<ControlPanelOperationResult>;
  issueSSL?(options: { domain: string }): Promise<ControlPanelOperationResult>;
  renewSSL?(options: { domain: string }): Promise<ControlPanelOperationResult>;
  getUsage?(target: { serverIp: string }): Promise<Record<string, unknown>>;
  restartService?(serviceName: string): Promise<ControlPanelOperationResult>;
}
