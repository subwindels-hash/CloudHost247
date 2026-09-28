<?php
/**
 * Idempotency + reconciliation ledger (mod_hostx_email_operations).
 *
 * Every remote mutation is wrapped in begin()/finish(). The unique key on
 * idempotency_key means a replayed WHMCS action (double click, retried cron,
 * duplicate webhook) is recognised before the provider is called.
 *
 * The critical rule: if a call times out AFTER the request was sent, the
 * operation is closed as `needs_reconcile`, never as `failed`. A failed
 * operation may be retried; an uncertain one must be inspected first, otherwise
 * a second mailbox could be created and billed.
 *
 * @package    WHMCS
 * @subpackage hostx_email
 */

namespace HostxEmail\Repository;

use HostxEmail\Support\Logger;
use WHMCS\Database\Capsule;

final class OperationRepository
{
    const TABLE = 'mod_hostx_email_operations';

    const STATE_IN_PROGRESS = 'in_progress';
    const STATE_SUCCEEDED   = 'succeeded';
    const STATE_FAILED      = 'failed';
    const STATE_RECONCILE   = 'needs_reconcile';

    /**
     * Deterministic idempotency key.
     *
     * The same logical operation on the same service with the same inputs
     * always produces the same key, so a replay is detected even across
     * processes and servers.
     *
     * Pure helper (unit tested).
     *
     * @param array<string,mixed> $inputs
     */
    public static function key(int $serviceId, string $operation, array $inputs = []): string
    {
        ksort($inputs);

        $material = $serviceId . '|' . $operation . '|' . json_encode($inputs);

        return substr($operation, 0, 24) . '-' . $serviceId . '-' . substr(hash('sha256', $material), 0, 32);
    }

    /**
     * Claim an operation.
     *
     * @param  array<string,mixed> $inputs
     * @return array{claimed:bool,state:string,row:object|null,key:string}
     */
    public static function begin(int $serviceId, string $provider, string $operation, array $inputs = []): array
    {
        $key = self::key($serviceId, $operation, $inputs);
        $existing = self::findByKey($key);

        if ($existing) {
            // Already recorded. Only a previously failed attempt may be retried.
            if ($existing->state === self::STATE_FAILED) {
                self::update($key, [
                    'state'          => self::STATE_IN_PROGRESS,
                    'attempts'       => (int) $existing->attempts + 1,
                    'correlation_id' => Logger::correlationId(),
                ]);

                return ['claimed' => true, 'state' => self::STATE_IN_PROGRESS, 'row' => self::findByKey($key), 'key' => $key];
            }

            return ['claimed' => false, 'state' => (string) $existing->state, 'row' => $existing, 'key' => $key];
        }

        try {
            Capsule::table(self::TABLE)->insert([
                'service_id'      => $serviceId,
                'provider'        => substr($provider, 0, 32),
                'operation'       => substr($operation, 0, 48),
                'idempotency_key' => $key,
                'state'           => self::STATE_IN_PROGRESS,
                'attempts'        => 1,
                'correlation_id'  => Logger::correlationId(),
                'created_at'      => date('Y-m-d H:i:s'),
                'updated_at'      => date('Y-m-d H:i:s'),
            ]);
        } catch (\Throwable $e) {
            // Unique violation: another process claimed it microseconds ago.
            $row = self::findByKey($key);

            return [
                'claimed' => false,
                'state'   => $row ? (string) $row->state : self::STATE_IN_PROGRESS,
                'row'     => $row,
                'key'     => $key,
            ];
        }

        return ['claimed' => true, 'state' => self::STATE_IN_PROGRESS, 'row' => self::findByKey($key), 'key' => $key];
    }

    /**
     * Close an operation with the outcome of the provider call.
     *
     * @param array<string,mixed> $result Result envelope
     */
    public static function finish(string $key, array $result, string $remoteId = ''): string
    {
        $uncertain = !empty($result['uncertain']);
        $success = !empty($result['success']);

        $state = $success
            ? self::STATE_SUCCEEDED
            : ($uncertain ? self::STATE_RECONCILE : self::STATE_FAILED);

        self::update($key, [
            'state'          => $state,
            'result_code'    => substr((string) ($result['code'] ?? ''), 0, 48),
            'result_message' => substr((string) ($result['message'] ?? ''), 0, 500),
            'remote_id'      => $remoteId !== '' ? substr($remoteId, 0, 191) : null,
        ]);

        return $state;
    }

    /**
     * @return object|null
     */
    public static function findByKey(string $key)
    {
        try {
            return Capsule::table(self::TABLE)->where('idempotency_key', $key)->first();
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * @param array<string,mixed> $values
     */
    public static function update(string $key, array $values): void
    {
        $values['updated_at'] = date('Y-m-d H:i:s');

        try {
            Capsule::table(self::TABLE)->where('idempotency_key', $key)->update($values);
        } catch (\Throwable $e) {
            Logger::error('operation.update_failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * The most recent successful operation of a kind for a service.
     *
     * @return object|null
     */
    public static function lastSuccessful(int $serviceId, string $operation)
    {
        try {
            return Capsule::table(self::TABLE)
                ->where('service_id', $serviceId)
                ->where('operation', $operation)
                ->where('state', self::STATE_SUCCEEDED)
                ->orderBy('id', 'desc')
                ->first();
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Operations stuck in progress for longer than $minutes - a crashed
     * process. They are moved to needs_reconcile rather than retried.
     */
    public static function sweepStale(int $minutes = 30): int
    {
        try {
            $threshold = date('Y-m-d H:i:s', strtotime('-' . max(5, $minutes) . ' minutes'));

            $stale = Capsule::table(self::TABLE)
                ->where('state', self::STATE_IN_PROGRESS)
                ->where('updated_at', '<', $threshold)
                ->get();

            foreach ($stale as $operation) {
                self::update((string) $operation->idempotency_key, [
                    'state'          => self::STATE_RECONCILE,
                    'result_code'    => 'uncertain',
                    'result_message' => 'Operation did not complete; queued for reconciliation.',
                ]);

                AccountRepository::markForReconciliation(
                    (int) $operation->service_id,
                    'Stalled ' . $operation->operation . ' operation'
                );
            }

            return count($stale);
        } catch (\Throwable $e) {
            return 0;
        }
    }

    /**
     * @return array<int,object>
     */
    public static function forService(int $serviceId, int $limit = 25): array
    {
        try {
            return Capsule::table(self::TABLE)
                ->where('service_id', $serviceId)
                ->orderBy('id', 'desc')
                ->limit(max(1, min($limit, 100)))
                ->get()
                ->all();
        } catch (\Throwable $e) {
            return [];
        }
    }
}
