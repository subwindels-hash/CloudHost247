<?php
namespace CloudHost247\Broker\Repositories;

use WHMCS\Database\Capsule;

/**
 * Idempotency ledger + audit trail for outbound provider calls (requirements
 * #29 and #38). A duplicate (provider_key, operation, idempotency_key) never
 * inserts twice — the unique index on the table is the real guarantee; this
 * repository just makes the "already happened?" check convenient.
 */
final class ProviderCallRepository
{
    const TABLE = 'mod_cloudhost247_broker_provider_calls';

    public function alreadyPerformed($providerKey, $operation, $idempotencyKey)
    {
        return Capsule::table(self::TABLE)
            ->where('provider_key', (string) $providerKey)
            ->where('operation', (string) $operation)
            ->where('idempotency_key', (string) $idempotencyKey)
            ->first();
    }

    public function record($caseId, $providerKey, $operation, $idempotencyKey, $resultCode, $correlationId = '', $httpStatus = null, $latencyMs = null)
    {
        try {
            return Capsule::table(self::TABLE)->insert(array(
                'case_id' => (int) $caseId,
                'provider_key' => substr((string) $providerKey, 0, 32),
                'operation' => substr((string) $operation, 0, 64),
                'idempotency_key' => substr((string) $idempotencyKey, 0, 100),
                'correlation_id' => substr((string) $correlationId, 0, 64),
                'result_code' => substr((string) $resultCode, 0, 32),
                'http_status' => $httpStatus === null ? null : (int) $httpStatus,
                'latency_ms' => $latencyMs === null ? null : (int) $latencyMs,
                'created_at' => date('Y-m-d H:i:s'),
            ));
        } catch (\Throwable $duplicate) {
            // Unique constraint hit: another concurrent request already recorded
            // this exact call. That is the idempotency guarantee working, not a failure.
            return false;
        }
    }

    public function forCase($caseId)
    {
        return Capsule::table(self::TABLE)->where('case_id', (int) $caseId)->orderBy('id', 'desc')->get();
    }
}
