/**
 * Provider-backed readiness policy for control-panel operations.
 *
 * Registered adapters can generate bootstrap scripts, and some may declare local method
 * overrides. Neither is proof that a real provider accepted the bootstrap or that CloudHost247
 * verified an installed panel. This build has no provider-acceptance evidence store or completed
 * panel-management acceptance run, so both verification signals deliberately fail closed.
 */
import { BaseControlPanelAdapter } from './adapters/base';
import { getControlPanelAdapter } from './registry';

export const CORE_CONTROL_PANEL_MANAGEMENT_METHODS = ['install', 'getStatus', 'healthCheck'] as const;
export type ControlPanelManagementMethod =
  | 'install' | 'uninstall' | 'configure' | 'getStatus' | 'healthCheck'
  | 'createAccount' | 'suspendAccount' | 'unsuspendAccount' | 'terminateAccount'
  | 'createDomain' | 'deleteDomain' | 'createSubdomain'
  | 'createDatabase' | 'deleteDatabase' | 'createEmailAccount' | 'deleteEmailAccount'
  | 'createDNSRecord' | 'deleteDNSRecord' | 'issueSSL' | 'renewSSL' | 'getUsage' | 'restartService';

export function controlPanelMethodImplemented(slug: string, method: ControlPanelManagementMethod): boolean {
  const adapter = getControlPanelAdapter(slug);
  if (!adapter) return false;
  const instanceMethods = adapter as unknown as Record<string, unknown>;
  const baseMethods = BaseControlPanelAdapter.prototype as unknown as Record<string, unknown>;
  return instanceMethods[method] !== baseMethods[method];
}

export interface ControlPanelReadiness {
  hasPanelBootstrapAdapter: boolean;
  panelBootstrapProviderVerified: boolean;
  panelManagementAvailable: boolean;
  panelManagementProviderVerified: boolean;
  /** All checks needed before an order can describe the panel as an operational integration. */
  operationallySupported: boolean;
}

export function getControlPanelReadiness(slug: string): ControlPanelReadiness {
  const adapter = getControlPanelAdapter(slug);
  const hasPanelBootstrapAdapter = Boolean(adapter);
  const panelManagementAvailable = CORE_CONTROL_PANEL_MANAGEMENT_METHODS.every(
    (method) => controlPanelMethodImplemented(slug, method)
  );

  // There is no persisted provider acceptance result or per-panel verification workflow in this
  // build. Keep these explicit negatives rather than deriving them from catalogue or method data.
  const panelBootstrapProviderVerified = false;
  const panelManagementProviderVerified = false;

  return {
    hasPanelBootstrapAdapter,
    panelBootstrapProviderVerified,
    panelManagementAvailable,
    panelManagementProviderVerified,
    operationallySupported: hasPanelBootstrapAdapter
      && panelBootstrapProviderVerified
      && panelManagementAvailable
      && panelManagementProviderVerified,
  };
}
