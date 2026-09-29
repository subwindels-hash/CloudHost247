<?php
namespace CloudHost247\Broker\Providers;

use CloudHost247\Broker\Repositories\ProviderConfigRepository;
use CloudHost247\Integrations\Services\IntegrationManager;
use CloudHost247\Integrations\Support\Environment;
use CloudHost247\Integrations\Support\ResultCode;

/**
 * Shared plumbing for adapters that sit on top of a central
 * CloudHost247\Integrations provider (GoDaddy, Sedo, Afternic, DomainAgents).
 *
 * Connection state and capability activation are always read from the
 * central integration record — never duplicated locally — so a provider is
 * reported Connected only when its own real, recorded health check last
 * succeeded (requirement #19). The broker-owned provider row only stores
 * broker-specific policy: whether this route is enabled for routing, its
 * priority, and whether an administrator has confirmed the commercial/partner
 * agreement a provider's aftermarket capabilities require.
 */
abstract class AbstractIntegrationAdapter implements ProviderAdapter
{
    /** @var ProviderConfigRepository */
    protected $configRepository;

    public function __construct(ProviderConfigRepository $configRepository = null)
    {
        $this->configRepository = $configRepository ?: new ProviderConfigRepository();
    }

    public function isManual() { return false; }

    /** Capability keys that require an administrator-confirmed partner agreement before use. */
    protected function agreementGatedCapabilities() { return array(); }

    private function integrationRow()
    {
        try {
            if (!IntegrationManager::installed()) { return null; }
            return IntegrationManager::repository()->findFor($this->key(), Environment::active());
        } catch (\Throwable $error) {
            return null;
        }
    }

    public function activeCapabilities()
    {
        $broker = $this->configRepository->find($this->key());
        if ($broker && !$broker->enabled) { return array(); }
        if ($this->connectionState() !== ConnectionState::CONNECTED) { return array(); }
        $agreementConfirmed = $broker ? (bool) $broker->partner_agreement_confirmed : false;
        $active = array();
        foreach ($this->declaredCapabilities() as $capability) {
            if (in_array($capability, $this->agreementGatedCapabilities(), true) && !$agreementConfirmed) {
                continue;
            }
            $active[] = $capability;
        }
        return $active;
    }

    public function supports($capability)
    {
        return in_array($capability, $this->activeCapabilities(), true);
    }

    public function connectionState()
    {
        $row = $this->integrationRow();
        if (!$row || (int) $row->enabled !== 1) { return ConnectionState::NOT_CONFIGURED; }
        if (!$row->last_checked_at) { return ConnectionState::NOT_CONFIGURED; }
        return ConnectionState::fromIntegrationResultCode((string) $row->status);
    }

    public function connectionDetail()
    {
        $row = $this->integrationRow();
        if (!$row) { return 'Not configured in API & Integrations.'; }
        if (!$row->last_checked_at) { return 'Configured but never tested. Use Test Connection before relying on this route.'; }
        return ResultCode::label((string) $row->status) . ($row->last_failure_reason ? ' — ' . (string) $row->last_failure_reason : '');
    }

    /**
     * Non-secret facts for the admin Providers table (requirement #17): which
     * environment the connection record belongs to and when its last real
     * health check ran. Never contains credentials or provider payloads.
     */
    public function integrationSummary()
    {
        $environment = 'development';
        try { $environment = Environment::active(); } catch (\Throwable $error) { /* default */ }
        $row = $this->integrationRow();
        return array(
            'environment' => $environment,
            'last_checked_at' => $row && isset($row->last_checked_at) ? (string) $row->last_checked_at : '',
            'configured' => (bool) $row,
        );
    }

    public function accessRequirements()
    {
        return 'Configure and test this provider from Super Admin -> API & Integrations, then confirm the commercial/partner agreement from Super Admin -> Domain Brokerage -> Providers.';
    }
}
