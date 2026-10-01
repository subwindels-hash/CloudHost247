<?php
/**
 * Provisioned account state (mod_hostx_email_accounts).
 *
 * The remote account id persisted here is what makes provisioning idempotent:
 * once it exists, CreateAccount will never create a second remote user for the
 * same WHMCS service.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

namespace CloudHost247\Email\Repository;

use CloudHost247\Email\Support\Logger;
use WHMCS\Database\Capsule;

final class AccountRepository
{
    const TABLE = 'mod_hostx_email_accounts';

    const STATUS_PENDING     = 'pending';
    const STATUS_ACTIVE      = 'active';
    const STATUS_SUSPENDED   = 'suspended';
    const STATUS_TERMINATED  = 'terminated';
    const STATUS_FAILED      = 'failed';
    const STATUS_RECONCILE   = 'needs_reconcile';

    /**
     * @return object|null
     */
    public static function find(int $serviceId)
    {
        if ($serviceId <= 0) {
            return null;
        }

        try {
            return Capsule::table(self::TABLE)->where('service_id', $serviceId)->first();
        } catch (\Throwable $e) {
            Logger::error('account.lookup_failed', ['service_id' => $serviceId, 'error' => $e->getMessage()]);

            return null;
        }
    }

    /**
     * Create the row if it is missing, then return it.
     *
     * @param  array<string,mixed> $data
     * @return object|null
     */
    public static function ensure(int $serviceId, array $data)
    {
        $existing = self::find($serviceId);

        if ($existing) {
            return $existing;
        }

        try {
            Capsule::table(self::TABLE)->insert([
                'service_id' => $serviceId,
                'client_id'  => (int) ($data['client_id'] ?? 0),
                'provider'   => (string) ($data['provider'] ?? ''),
                'email'      => (string) ($data['email'] ?? ''),
                'domain'     => (string) ($data['domain'] ?? ''),
                'plan_tier'  => (string) ($data['plan_tier'] ?? ''),
                'plan_sku'   => (string) ($data['plan_sku'] ?? ''),
                'status'     => self::STATUS_PENDING,
                'created_at' => date('Y-m-d H:i:s'),
                'updated_at' => date('Y-m-d H:i:s'),
            ]);
        } catch (\Throwable $e) {
            // Unique key on service_id: a concurrent call won the race.
            Logger::debug('account.insert_race', ['service_id' => $serviceId, 'error' => $e->getMessage()]);
        }

        return self::find($serviceId);
    }

    /**
     * @param array<string,mixed> $values
     */
    public static function update(int $serviceId, array $values): bool
    {
        if ($serviceId <= 0 || !$values) {
            return false;
        }

        $values['updated_at'] = date('Y-m-d H:i:s');

        try {
            Capsule::table(self::TABLE)->where('service_id', $serviceId)->update($values);

            return true;
        } catch (\Throwable $e) {
            Logger::error('account.update_failed', ['service_id' => $serviceId, 'error' => $e->getMessage()]);

            return false;
        }
    }

    /**
     * Flag a service whose remote state is unknown. Nothing is retried
     * automatically: the reconciler inspects the provider and repairs it.
     */
    public static function markForReconciliation(int $serviceId, string $reason): void
    {
        self::update($serviceId, [
            'needs_reconcile'  => 1,
            'reconcile_reason' => substr($reason, 0, 255),
            'status'           => self::STATUS_RECONCILE,
        ]);

        Logger::warning('account.marked_for_reconciliation', [
            'service_id' => $serviceId,
            'reason'     => $reason,
        ]);
    }

    public static function clearReconciliation(int $serviceId, string $status): void
    {
        self::update($serviceId, [
            'needs_reconcile'  => 0,
            'reconcile_reason' => null,
            'status'           => $status,
        ]);
    }

    /**
     * Metadata blob (non-sensitive provider facts: sku names, region, ...).
     *
     * @param array<string,mixed> $metadata
     */
    public static function mergeMetadata(int $serviceId, array $metadata): void
    {
        $account = self::find($serviceId);
        $current = [];

        if ($account && !empty($account->metadata_json)) {
            $decoded = json_decode((string) $account->metadata_json, true);
            $current = is_array($decoded) ? $decoded : [];
        }

        $merged = array_merge($current, $metadata);
        $encoded = json_encode(\CloudHost247\Email\Support\Redactor::redact($merged));

        self::update($serviceId, ['metadata_json' => substr($encoded === false ? '{}' : $encoded, 0, 60000)]);
    }

    /**
     * @return array<string,mixed>
     */
    public static function metadata(int $serviceId): array
    {
        $account = self::find($serviceId);

        if (!$account || empty($account->metadata_json)) {
            return [];
        }

        $decoded = json_decode((string) $account->metadata_json, true);

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * Services due for a bounded status synchronisation.
     *
     * @return array<int,object>
     */
    public static function dueForSync(int $limit, int $staleMinutes = 360): array
    {
        try {
            $threshold = date('Y-m-d H:i:s', strtotime('-' . max(1, $staleMinutes) . ' minutes'));

            return Capsule::table(self::TABLE)
                ->whereIn('status', [self::STATUS_ACTIVE, self::STATUS_SUSPENDED, self::STATUS_PENDING])
                ->where(function ($query) use ($threshold) {
                    $query->whereNull('last_sync_at')->orWhere('last_sync_at', '<', $threshold);
                })
                ->orderByRaw('last_sync_at IS NOT NULL, last_sync_at ASC')
                ->limit(max(1, min($limit, 200)))
                ->get()
                ->all();
        } catch (\Throwable $e) {
            return [];
        }
    }

    /**
     * @return array<int,object>
     */
    public static function needingReconciliation(int $limit = 25): array
    {
        try {
            return Capsule::table(self::TABLE)
                ->where('needs_reconcile', 1)
                ->orderBy('updated_at', 'asc')
                ->limit(max(1, min($limit, 100)))
                ->get()
                ->all();
        } catch (\Throwable $e) {
            return [];
        }
    }

    /**
     * Ownership check: does this service belong to this client?
     *
     * Used by every client-area action before anything is displayed or changed.
     */
    public static function isOwnedBy(int $serviceId, int $clientId): bool
    {
        if ($serviceId <= 0 || $clientId <= 0) {
            return false;
        }

        try {
            return Capsule::table('tblhosting')
                ->where('id', $serviceId)
                ->where('userid', $clientId)
                ->exists();
        } catch (\Throwable $e) {
            Logger::error('account.ownership_check_failed', [
                'service_id' => $serviceId,
                'error'      => $e->getMessage(),
            ]);

            return false;
        }
    }
}
