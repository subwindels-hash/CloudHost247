/**
 * Control-panel operation errors.
 *
 * The control-panel adapters expose a management surface (install, account lifecycle, DNS, SSL,
 * usage, service restart) that this build does not execute against a real panel: no WHM/cPanel
 * (or other panel) upstream adapter is wired, so every one of those operations must fail closed
 * instead of returning a fabricated success.
 *
 * This is a live honesty hazard, not a cosmetic one. A stub that answers `{ success: true }` for
 * `createAccount` or `{ status: 'ACTIVE' }` for `getStatus` tells a caller an account was created
 * or a panel is healthy when nothing was ever contacted — the same defect class as a provider
 * adapter claiming a capability it refuses. The capability catalogue (`generateInstallScript`,
 * `getAccessInfo`, `validateCompatibility`, `getRequiredFirewallPorts`) is local and read-only, so
 * it stays usable; everything that would mutate or read a real panel refuses by name.
 */

export type ControlPanelOperationErrorCode =
  | 'NOT_IMPLEMENTED'
  | 'UNSUPPORTED_OPERATION'
  | 'CONFIGURATION_REQUIRED';

export class ControlPanelOperationError extends Error {
  readonly code: ControlPanelOperationErrorCode;
  /** These refusals are never retryable: only a build change (a real upstream adapter) or an
   * operator configuration change can make the operation exist. */
  readonly retryable = false;
  readonly panelSlug: string;
  readonly operation: string;

  constructor(
    panelSlug: string,
    operation: string,
    code: ControlPanelOperationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ControlPanelOperationError';
    this.panelSlug = panelSlug;
    this.operation = operation;
    this.code = code;
  }
}

/**
 * Throws the fail-closed refusal for a control-panel operation that has no real upstream
 * implementation in this build. Returns `never` so a subclass that forgets to return cannot fall
 * through to a fabricated success.
 *
 * `hint` names the honest alternative when one exists (for example, the local install-script
 * generator), so the refusal is actionable rather than a dead end.
 */
export function controlPanelOperationNotImplemented(input: {
  panelSlug: string;
  panelName: string;
  operation: string;
  hint?: string;
}): never {
  const suffix = input.hint ? ` ${input.hint}` : '';
  throw new ControlPanelOperationError(
    input.panelSlug,
    input.operation,
    'NOT_IMPLEMENTED',
    `${input.panelName} (${input.panelSlug}) cannot perform "${input.operation}" yet: no real upstream ` +
      `control-panel adapter is wired in this build, so the operation is refused instead of reporting ` +
      `a success that never happened.${suffix}`
  );
}
