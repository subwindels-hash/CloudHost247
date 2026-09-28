<?php
namespace CloudHost247\Smm\Repositories;

use CloudHost247\Smm\Contracts\ApiRecorder;
use CloudHost247\Smm\Support\Redactor;
use WHMCS\Database\Capsule;

/**
 * Redacted API execution log.
 *
 * Redaction rules enforced before anything is written:
 *  - request form field "key" (the provider API key) is replaced with "***"
 *  - any other credential-shaped field (api_key, token, secret, password) too
 *  - responses are truncated to a bounded excerpt
 */
final class LogRepository implements ApiRecorder
{
    const LOG = 'mod_cloudhost247_smm_api_log';
    const SYNC = 'mod_cloudhost247_smm_sync_history';

    const MAX_EXCERPT = 4000;

    public function record($providerId, $operation, array $request, $response, $httpStatus, $durationMs, $result, $correlationId)
    {
        Capsule::table(self::LOG)->insert(array(
            'provider_id' => $providerId === null ? null : (int) $providerId,
            'operation' => mb_substr((string) $operation, 0, 32),
            'result' => in_array($result, array('success', 'rejected', 'error'), true) ? $result : 'error',
            'http_status' => (int) $httpStatus,
            'duration_ms' => max(0, min(600000, (int) $durationMs)),
            'request_json' => Redactor::encode(Redactor::redactRequest($request)),
            'response_json' => Redactor::redactResponse($response),
            'correlation_id' => mb_substr((string) $correlationId, 0, 64),
            'created_at' => date('Y-m-d H:i:s'),
        ));
    }

    public function recordSyncHistory(array $row)
    {
        Capsule::table(self::SYNC)->insert(array_merge(array('created_at' => date('Y-m-d H:i:s')), $row));
    }

    public function search($filters = array(), $limit = 50, $offset = 0)
    {
        $q = Capsule::table(self::LOG . ' AS l')
            ->leftJoin('mod_cloudhost247_smm_providers AS p', 'p.id', '=', 'l.provider_id')
            ->select('l.*', 'p.name AS provider_name');
        if (!empty($filters['provider_id'])) {
            $q->where('l.provider_id', (int) $filters['provider_id']);
        }
        if (!empty($filters['operation'])) {
            $q->where('l.operation', (string) $filters['operation']);
        }
        if (!empty($filters['result'])) {
            $q->where('l.result', (string) $filters['result']);
        }
        if (!empty($filters['correlation_id'])) {
            $q->where('l.correlation_id', 'like', '%' . str_replace(array('%', '_'), array('\\%', '\\_'), (string) $filters['correlation_id']) . '%');
        }
        return $q->orderBy('l.id', 'desc')->skip((int) $offset)->take(min(200, max(1, (int) $limit)))->get();
    }

    public function countSearch($filters = array())
    {
        $q = Capsule::table(self::LOG);
        if (!empty($filters['provider_id'])) {
            $q->where('provider_id', (int) $filters['provider_id']);
        }
        if (!empty($filters['operation'])) {
            $q->where('operation', (string) $filters['operation']);
        }
        if (!empty($filters['result'])) {
            $q->where('result', (string) $filters['result']);
        }
        if (!empty($filters['correlation_id'])) {
            $q->where('correlation_id', 'like', '%' . str_replace(array('%', '_'), array('\\%', '\\_'), (string) $filters['correlation_id']) . '%');
        }
        return $q->count();
    }

    public function purgeOlderThanDays($days)
    {
        $days = max(7, min(3650, (int) $days));
        $cutoff = date('Y-m-d H:i:s', time() - $days * 86400);
        $deleted = Capsule::table(self::LOG)->where('created_at', '<', $cutoff)->delete();
        Capsule::table(self::SYNC)->where('created_at', '<', $cutoff)->delete();
        return $deleted;
    }

    public function recentForProvider($providerId, $limit = 20)
    {
        return Capsule::table(self::LOG)->where('provider_id', (int) $providerId)
            ->orderBy('id', 'desc')->skip(0)->take(min(200, max(1, (int) $limit)))->get();
    }

}
