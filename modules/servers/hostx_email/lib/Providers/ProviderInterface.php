<?php
/**
 * Provider contract.
 *
 * Every adapter implements the same surface; capabilities() declares what the
 * underlying API genuinely supports, and the provisioner refuses to call an
 * operation a provider has not advertised rather than faking a success.
 *
 * Every method returns a Result envelope (see Support\Result).
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

namespace CloudHost247\Email\Providers;

use CloudHost247\Email\Dns\RecordSet;

interface ProviderInterface
{
    /** Machine key: professional | microsoft365 | google */
    public function key(): string;

    /** Human label for the UI. */
    public function label(): string;

    /**
     * Supported operations.
     *
     * @return array<string,bool> e.g. ['create'=>true,'usage'=>false, ...]
     */
    public function capabilities(): array;

    /**
     * Static configuration check - credentials present and well formed. No
     * network access.
     *
     * @return array<string,mixed>
     */
    public function validateConfiguration(): array;

    /**
     * Live check: authenticate and read something harmless.
     *
     * @return array<string,mixed>
     */
    public function testConnection(): array;

    /**
     * Confirm the plan/SKU exists and has a free seat.
     *
     * @return array<string,mixed>
     */
    public function checkAvailability(string $sku): array;

    /**
     * @param  array<string,mixed> $spec email, display_name, password, sku, usage_location, force_change
     * @return array<string,mixed> data: remote_id, email, status
     */
    public function createAccount(array $spec): array;

    /**
     * @param array<string,mixed> $account remote_id, email
     */
    public function suspendAccount(array $account): array;

    /**
     * @param array<string,mixed> $account
     */
    public function unsuspendAccount(array $account): array;

    /**
     * @param array<string,mixed> $account
     */
    public function terminateAccount(array $account): array;

    /**
     * @param array<string,mixed> $account
     */
    public function changePassword(array $account, string $password, bool $forceChange = false): array;

    /**
     * @param array<string,mixed> $account
     */
    public function assignLicense(array $account, string $sku): array;

    /**
     * @param array<string,mixed> $account
     */
    public function removeLicense(array $account, string $sku): array;

    /**
     * Read the remote account state (used by cron sync and reconciliation).
     *
     * @param  array<string,mixed> $account
     * @return array<string,mixed> data: exists, status, remote_id, license_state, storage_used_mb, storage_quota_mb
     */
    public function getStatus(array $account): array;

    /**
     * Find an account by address - the reconciliation path after an uncertain
     * create.
     *
     * @return array<string,mixed>
     */
    public function findByEmail(string $email): array;

    /**
     * Plans/SKUs available on the tenant, for admin mapping.
     *
     * @return array<string,mixed> data: plans[]
     */
    public function listPlans(): array;

    /**
     * DNS records required for the domain, as reported by the provider or as
     * configured by an administrator.
     *
     * @return array<string,mixed> data: records (RecordSet), verified (bool|null)
     */
    public function dnsRecords(string $domain): array;

    /**
     * Provider login URL for the customer (Outlook / Gmail / webmail).
     *
     * @param array<string,mixed> $account
     */
    public function loginUrl(array $account): string;

    /**
     * Does this provider document authenticated webhooks that this module can
     * verify?
     */
    public function supportsWebhooks(): bool;
}
