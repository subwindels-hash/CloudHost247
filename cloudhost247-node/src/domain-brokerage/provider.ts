/** Provider-neutral brokerage contract. Adapters must report only operations they genuinely support. */
export type BrokerageCapability = 'domainAvailability' | 'domainSearch' | 'forSaleLookup' | 'brokerageRequest' | 'ownerContact' | 'offerSubmission' | 'counteroffer' | 'negotiation' | 'payment' | 'escrow' | 'transfer' | 'transferStatus' | 'domainDelivery';
export interface ProviderHealth { status: 'connected' | 'auth_failed' | 'invalid_configuration' | 'unavailable' | 'timeout' | 'permission_denied' | 'not_configured'; checkedAt: string; message?: string; }
export interface BrokerageProvider { readonly key: string; readonly capabilities: ReadonlySet<BrokerageCapability>; healthCheck(): Promise<ProviderHealth>; }
/** No provider is enabled by default. Manual cases are a workflow, not a fabricated provider connection. */
export class ProviderRegistry {
  private readonly providers = new Map<string, BrokerageProvider>();
  register(provider: BrokerageProvider): void { this.providers.set(provider.key, provider); }
  get(key: string): BrokerageProvider | undefined { return this.providers.get(key); }
  available(capability: BrokerageCapability): BrokerageProvider[] { return [...this.providers.values()].filter((p) => p.capabilities.has(capability)); }
}
