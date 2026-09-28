<?php
namespace CloudHost247\Smm\Repositories;

use CloudHost247\Smm\Contracts\OrderStore;
use CloudHost247\Smm\Support\StatusMap;
use WHMCS\Database\Capsule;

/** Capsule-backed order persistence. All writes go through narrow, whitelisted helpers. */
final class OrderRepository implements OrderStore
{
    const ORDERS = 'mod_cloudhost247_smm_orders';
    const EVENTS = 'mod_cloudhost247_smm_order_events';

    public function findByServiceId($whmcsServiceId)
    {
        return Capsule::table(self::ORDERS)->where('whmcs_service_id', (int) $whmcsServiceId)->first();
    }

    public function findById($id)
    {
        return Capsule::table(self::ORDERS)->where('id', (int) $id)->first();
    }

    public function create(array $data)
    {
        $now = date('Y-m-d H:i:s');
        $data['created_at'] = $now;
        $data['updated_at'] = $now;
        return Capsule::table(self::ORDERS)->insertGetId($this->whitelist($data, array(
            'whmcs_service_id', 'whmcs_order_id', 'whmcs_client_id', 'whmcs_product_id',
            'mapping_id', 'provider_id', 'provider_service_id', 'provider_name', 'service_name',
            'target_url', 'quantity', 'customer_price', 'provider_cost', 'currency',
            'submission_state', 'order_status', 'provider_status_raw', 'refill_supported',
            'cancel_supported', 'correlation_id', 'error_message', 'created_at', 'updated_at',
        )));
    }

    public function claimForSubmission($orderId)
    {
        // Optimistic claim: only the awaiting state may transition to in_flight.
        return Capsule::table(self::ORDERS)
            ->where('id', (int) $orderId)
            ->where('submission_state', 'awaiting_submission')
            ->update(array('submission_state' => 'in_flight', 'updated_at' => date('Y-m-d H:i:s'))) === 1;
    }

    public function markAccepted($orderId, $providerOrderId, array $extra = array())
    {
        $fields = array_merge($extra, array(
            'provider_order_id' => mb_substr((string) $providerOrderId, 0, 64),
            'submission_state' => 'accepted',
            'error_message' => '',
            'submitted_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        ));
        return Capsule::table(self::ORDERS)->where('id', (int) $orderId)
            ->update($this->whitelist($fields, array(
                'provider_order_id', 'submission_state', 'error_message', 'submitted_at', 'updated_at',
                'order_status', 'provider_status_raw', 'last_status_at', 'last_sync_at', 'remains', 'start_count',
            ))) === 1;
    }

    public function markRejected($orderId, $message)
    {
        return Capsule::table(self::ORDERS)->where('id', (int) $orderId)->update(array(
            'submission_state' => 'rejected',
            'error_message' => mb_substr((string) $message, 0, 500),
            'updated_at' => date('Y-m-d H:i:s'),
        )) === 1;
    }

    public function markUncertain($orderId, $message)
    {
        return Capsule::table(self::ORDERS)->where('id', (int) $orderId)->update(array(
            'submission_state' => 'uncertain',
            'error_message' => mb_substr((string) $message, 0, 500),
            'updated_at' => date('Y-m-d H:i:s'),
        )) === 1;
    }

    public function updateFields($orderId, array $fields)
    {
        $fields['updated_at'] = date('Y-m-d H:i:s');
        $allowed = array(
            'submission_state', 'order_status', 'provider_status_raw', 'needs_review', 'suspended',
            'remains', 'start_count', 'last_status_at', 'last_sync_at', 'last_refill_id',
            'last_refill_status', 'error_message', 'provider_order_id', 'quantity', 'target_url',
            'updated_at',
        );
        return Capsule::table(self::ORDERS)->where('id', (int) $orderId)
            ->update($this->whitelist($fields, $allowed)) >= 0;
    }

    public function attachProviderOrderId($orderId, $providerOrderId)
    {
        return Capsule::table(self::ORDERS)->where('id', (int) $orderId)->update(array(
            'provider_order_id' => mb_substr(trim((string) $providerOrderId), 0, 64),
            'submission_state' => 'accepted',
            'error_message' => '',
            'submitted_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        )) === 1;
    }

    public function eligibleForStatusSync($limit, $terminalRecheckWindow = 86400)
    {
        $terminal = StatusMap::terminalStatuses();
        $terminalCutoff = date('Y-m-d H:i:s', time() - max(3600, (int) $terminalRecheckWindow));
        return Capsule::table(self::ORDERS . ' AS o')
            ->join('mod_cloudhost247_smm_providers AS p', 'p.id', '=', 'o.provider_id')
            ->where('o.submission_state', 'accepted')
            ->where('o.suspended', 0)
            ->where('p.enabled', 1)
            ->where(function ($q) use ($terminal, $terminalCutoff) {
                // non-terminal (or unverified) orders always sync;
                // terminal orders are re-verified only inside the window
                $q->whereNull('o.order_status')
                    ->orWhereNotIn('o.order_status', $terminal)
                    ->orWhere(function ($q2) use ($terminal, $terminalCutoff) {
                        $q2->whereIn('o.order_status', $terminal)
                            ->whereNotNull('o.last_status_at')
                            ->where('o.last_status_at', '>', $terminalCutoff);
                    });
            })
            ->select('o.*', 'p.name AS provider_name_snapshot', 'p.adapter AS provider_adapter',
                'p.api_url AS provider_api_url', 'p.api_key_encrypted AS provider_api_key_encrypted',
                'p.request_timeout AS provider_request_timeout', 'p.refill_supported AS provider_refill_supported',
                'p.cancel_supported AS provider_cancel_supported', 'p.id AS pid')
            ->orderBy('o.last_sync_at')->orderBy('o.id')
            ->skip(0)->take(min(200, max(1, (int) $limit)))
            ->get()
            ->toArray();
    }

    public function findByState($state, $limit)
    {
        return Capsule::table(self::ORDERS)->where('submission_state', (string) $state)
            ->orderBy('id')->skip(0)->take(min(200, max(1, (int) $limit)))->get()->toArray();
    }

    public function findNeedingReview($limit)
    {
        return Capsule::table(self::ORDERS)->where('needs_review', 1)
            ->orderBy('id')->skip(0)->take(min(200, max(1, (int) $limit)))->get()->toArray();
    }

    public function recordEvent($orderId, $event, $fromStatus, $toStatus, $note, $actor, $actorId, $correlationId)
    {
        return Capsule::table(self::EVENTS)->insert(array(
            'order_id' => (int) $orderId,
            'event' => mb_substr((string) $event, 0, 40),
            'from_status' => $fromStatus === null ? null : mb_substr((string) $fromStatus, 0, 24),
            'to_status' => $toStatus === null ? null : mb_substr((string) $toStatus, 0, 24),
            'submission_state' => null,
            'note' => mb_substr(strip_tags((string) $note), 0, 500),
            'actor' => in_array($actor, array('admin', 'client', 'system'), true) ? $actor : 'system',
            'actor_id' => (int) $actorId,
            'correlation_id' => mb_substr((string) $correlationId, 0, 64),
            'created_at' => date('Y-m-d H:i:s'),
        ));
    }

    public function eventsForOrder($orderId, $limit = 100)
    {
        return Capsule::table(self::EVENTS)->where('order_id', (int) $orderId)
            ->orderBy('id', 'desc')->skip(0)->take(min(200, max(1, (int) $limit)))->get();
    }

    // ------------------------------------------------------------- listings

    public function search($filters = array(), $limit = 50, $offset = 0)
    {
        $q = Capsule::table(self::ORDERS . ' AS o')
            ->leftJoin('mod_cloudhost247_smm_providers AS p', 'p.id', '=', 'o.provider_id')
            ->select('o.*', 'p.name AS provider_name_live');
        if (!empty($filters['provider_id'])) {
            $q->where('o.provider_id', (int) $filters['provider_id']);
        }
        if (!empty($filters['status'])) {
            if ($filters['status'] === 'reconciliation') {
                $q->where('o.submission_state', 'uncertain');
            } else {
                $q->where('o.order_status', (string) $filters['status']);
            }
        }
        if (!empty($filters['state'])) {
            $q->where('o.submission_state', (string) $filters['state']);
        }
        if (!empty($filters['client_id'])) {
            $q->where('o.whmcs_client_id', (int) $filters['client_id']);
        }
        if (!empty($filters['q'])) {
            $needle = '%' . str_replace(array('%', '_'), array('\\%', '\\_'), (string) $filters['q']) . '%';
            $q->where(function ($sub) use ($needle) {
                $sub->where('o.provider_order_id', 'like', $needle)
                    ->orWhere('o.whmcs_service_id', 'like', $needle)
                    ->orWhere('o.target_url', 'like', $needle)
                    ->orWhere('o.service_name', 'like', $needle);
            });
        }
        return $q->orderBy('o.id', 'desc')->skip((int) $offset)->take(min(100, max(1, (int) $limit)))->get();
    }

    public function countSearch($filters = array())
    {
        $q = Capsule::table(self::ORDERS);
        if (!empty($filters['provider_id'])) {
            $q->where('provider_id', (int) $filters['provider_id']);
        }
        if (!empty($filters['status'])) {
            if ($filters['status'] === 'reconciliation') {
                $q->where('submission_state', 'uncertain');
            } else {
                $q->where('order_status', (string) $filters['status']);
            }
        }
        if (!empty($filters['state'])) {
            $q->where('submission_state', (string) $filters['state']);
        }
        if (!empty($filters['client_id'])) {
            $q->where('whmcs_client_id', (int) $filters['client_id']);
        }
        return $q->count();
    }

    public function statusCounts()
    {
        $rows = Capsule::table(self::ORDERS)
            ->select('order_status', Capsule::raw('COUNT(*) AS n'))
            ->groupBy('order_status')
            ->get();
        $out = array();
        foreach ($rows as $row) {
            $key = (string) $row->order_status;
            $out[$key === '' ? 'unverified' : $key] = (int) $row->n;
        }
        return $out;
    }

    public function countAll()
    {
        return Capsule::table(self::ORDERS)->count();
    }

    public function staleInFlight($cutoffDateTime, $limit)
    {
        return Capsule::table(self::ORDERS)
            ->where('submission_state', 'in_flight')
            ->where('updated_at', '<', (string) $cutoffDateTime)
            ->orderBy('id')->skip(0)->take(min(200, max(1, (int) $limit)))->get()->toArray();
    }

    public function forClient($clientId, $limit = 200)
    {
        return Capsule::table(self::ORDERS)->where('whmcs_client_id', (int) $clientId)
            ->orderBy('id', 'desc')->skip(0)->take(min(200, max(1, (int) $limit)))->get();
    }

    public function findByWhmcsService($serviceId, $clientId)
    {
        return Capsule::table(self::ORDERS)
            ->where('whmcs_service_id', (int) $serviceId)
            ->where('whmcs_client_id', (int) $clientId)
            ->first();
    }

    public function countForProvider($providerId)
    {
        return Capsule::table(self::ORDERS)->where('provider_id', (int) $providerId)->count();
    }

    private function whitelist(array $data, array $allowed)
    {
        $out = array();
        foreach ($allowed as $key) {
            if (array_key_exists($key, $data)) {
                $out[$key] = $data[$key];
            }
        }
        return $out;
    }
}
