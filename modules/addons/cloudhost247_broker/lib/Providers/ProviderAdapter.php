<?php
namespace CloudHost247\Broker\Providers;

/**
 * Contract every domain-acquisition provider adapter implements.
 *
 * The broker engine (Routing\AcquisitionRouter) and every controller talk to
 * providers only through this interface, so a new provider is added by
 * writing one adapter class — the customer dashboard and the core engine
 * never change. See docs/independent-rebuild/DOMAIN-BROKER.md section
 * "Provider capability system".
 */
interface ProviderAdapter
{
    /** Stable key, matches a CloudHost247\Integrations provider key where one exists. */
    public function key();

    public function label();

    /** True when this adapter needs no external integration (manual broker). */
    public function isManual();

    /**
     * Capabilities this provider could support once fully connected and
     * commercially approved. Never used directly to decide what to show a
     * customer — see activeCapabilities().
     *
     * @return string[] Capability::* constants
     */
    public function declaredCapabilities();

    /**
     * Capabilities this provider genuinely supports right now: the
     * integration (if any) is configured, enabled and last tested Connected,
     * and any required partner/commercial confirmation has been recorded by
     * an administrator. Never fabricated.
     *
     * @return string[] Capability::* constants
     */
    public function activeCapabilities();

    public function supports($capability);

    /**
     * Real, current connection state. One of the ConnectionState::* constants
     * — never reports "Connected" merely because configuration fields are
     * filled in.
     */
    public function connectionState();

    /** Human-safe detail for the current connection state (no payloads, no secrets). */
    public function connectionDetail();

    /**
     * Non-secret connection facts for the admin Providers table:
     * array(environment, last_checked_at, configured). Never contains
     * credentials or provider payloads.
     */
    public function integrationSummary();

    /** Documentation string describing partner/commercial requirements, for the admin UI. */
    public function accessRequirements();
}
