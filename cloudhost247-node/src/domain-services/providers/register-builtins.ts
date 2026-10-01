/**
 * Registers the built-in domain provider adapters exactly once per process. Adapters are compiled
 * code — an adapter that is not in this list does not exist, no matter what the database says,
 * which is the fail-closed contract the registry enforces.
 */
import { registerDomainProviderAdapter } from './registry';
import { NamecheapAdapter } from './namecheap-adapter';
import { GoDaddyAdapter } from './godaddy-adapter';
import { RdapAdapter } from './rdap-adapter';
import { GoValueAppraisalAdapter } from './govalue-appraisal-adapter';
import type { DomainProviderAdapter, DomainProviderConfig } from './types';

let registered = false;

export function registerBuiltInDomainProviderAdapters(): void {
  if (registered) return;
  registerDomainProviderAdapter('namecheap', (config: DomainProviderConfig): DomainProviderAdapter => new NamecheapAdapter(config));
  registerDomainProviderAdapter('godaddy', (config: DomainProviderConfig): DomainProviderAdapter => new GoDaddyAdapter(config));
  registerDomainProviderAdapter('rdap', (config: DomainProviderConfig): DomainProviderAdapter => new RdapAdapter(config));
  registerDomainProviderAdapter('godaddy-govalue', (config: DomainProviderConfig): DomainProviderAdapter => new GoValueAppraisalAdapter(config));
  registered = true;
}
