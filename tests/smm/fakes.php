<?php
/**
 * Test doubles for the CloudHost247 SMM suite.
 *
 * Everything touching WHMCS (database, admin session, encryption) is replaced
 * with in-memory equivalents so the order state machine, adapters, status
 * mapping, reconciliation and catalog logic run end-to-end without WHMCS.
 * These fakes are clearly test-only and never ship inside the module.
 */

namespace CloudHost247\Smm\Test {

    use CloudHost247\Smm\Contracts\ApiRecorder;
    use CloudHost247\Smm\Contracts\OrderStore;
    use CloudHost247\Smm\Contracts\ProviderFinder;
    use CloudHost247\Smm\Support\HttpTransport;
    use CloudHost247\Smm\Support\TransportException;

    /** Public, documentation-only IP endpoints (no live DNS in tests). */
    const TEST_PROVIDER_URL = 'https://192.0.2.10/api/v2';

    /**
     * Scripted HTTP transport: pops one response per call and records every
     * request so tests can prove NO duplicate submission happened.
     */
    final class FakeTransport implements HttpTransport
    {
        public $requests = array();
        private $script = array();

        /** @param array $script list of array('status'=>int,'body'=>string) */
        public function __construct(array $script = array())
        {
            $this->script = $script;
        }

        public static function fromFixture($file)
        {
            return new self(array(array('status' => 200, 'body' => file_get_contents($file))));
        }

        public function queue(array $response)
        {
            $this->script[] = $response;
            return $this;
        }

        public function queueFailure($message)
        {
            $this->script[] = array('status' => 0, 'error' => $message);
            return $this;
        }

        public function calls()
        {
            return count($this->requests);
        }

        public function postForm($url, array $data, $timeout = 20)
        {
            $this->requests[] = array('url' => $url, 'data' => $data, 'timeout' => $timeout);
            if (array() === $this->script) {
                throw new TransportException('FakeTransport: no scripted response left.');
            }
            $response = array_shift($this->script);
            if (isset($response['error'])) {
                throw new TransportException($response['error']);
            }
            return array('status' => (int) $response['status'], 'body' => (string) $response['body']);
        }

        public function lastAction()
        {
            $last = end($this->requests);
            return $last === false ? null : (isset($last['data']['action']) ? $last['data']['action'] : null);
        }
    }

    /** In-memory ProviderFinder: providers, mappings and catalog services. */
    final class FakeProviderFinder implements ProviderFinder
    {
        public $providers = array();
        public $mappings = array();
        public $services = array();
        public $errors = array();
        public $successes = array();

        public function findProvider($providerId)
        {
            return isset($this->providers[(int) $providerId]) ? $this->providers[(int) $providerId] : null;
        }

        public function activeMappingByProduct($productId)
        {
            foreach ($this->mappings as $m) {
                if ((int) $m->product_id === (int) $productId && (int) $m->enabled === 1) {
                    return $m;
                }
            }
            return null;
        }

        public function mappingById($mappingId)
        {
            foreach ($this->mappings as $m) {
                if ((int) $m->id === (int) $mappingId) {
                    return $m;
                }
            }
            return null;
        }

        public function findService($serviceId)
        {
            return isset($this->services[(int) $serviceId]) ? $this->services[(int) $serviceId] : null;
        }

        public function markProviderError($providerId, $message)
        {
            $this->errors[(int) $providerId] = $message;
            if (isset($this->providers[(int) $providerId])) {
                $this->providers[(int) $providerId]->connection_status = 'error';
            }
        }

        public function markProviderSuccess($providerId, $balance = null, $currency = null)
        {
            $this->successes[(int) $providerId] = $balance;
            if (isset($this->providers[(int) $providerId])) {
                $this->providers[(int) $providerId]->connection_status = 'ok';
            }
        }

        /** Convenience builders used by the tests. */
        public function addProvider($id, $extra = array())
        {
            $row = (object) array_merge(array(
                'id' => (int) $id,
                'name' => 'Test Provider ' . $id,
                'adapter' => 'generic',
                'api_url' => TEST_PROVIDER_URL,
                // Valid Crypto envelope (the global encrypt()/decrypt() fakes
                // defined at the bottom of this file make it reversible).
                'api_key_encrypted' => \CloudHost247\Smm\Support\Crypto::encrypt('test-key'),
                'enabled' => 1,
                'refill_supported' => 1,
                'cancel_supported' => 1,
                'request_timeout' => 10,
                'priority' => 100,
            ), $extra);
            $this->providers[(int) $id] = $row;
            return $row;
        }

        public function addMapping($id, $productId, $providerId, $serviceId, $extra = array())
        {
            $row = (object) array_merge(array(
                'id' => (int) $id,
                'product_id' => (int) $productId,
                'provider_id' => (int) $providerId,
                'service_id' => (int) $serviceId,
                'provider_service_id' => '12',
                'name' => 'Instagram Followers - Real',
                'min_quantity' => 100,
                'max_quantity' => 10000,
                'sell_price' => 1.5,
                'currency' => 'USD',
                'enabled' => 1,
            ), $extra);
            $this->mappings[] = $row;
            return $row;
        }

        public function addService($id, $providerId, $extra = array())
        {
            $row = (object) array_merge(array(
                'id' => (int) $id,
                'provider_id' => (int) $providerId,
                'provider_service_id' => '12',
                'name' => 'Instagram Followers - Real',
                'category' => 'Instagram Followers',
                'description' => 'High quality followers',
                'type' => 'Default',
                'min_quantity' => 100,
                'max_quantity' => 10000,
                'rate' => 0.9,
                'currency' => 'USD',
                'refill' => 1,
                'cancel' => 1,
                'available' => 1,
            ), $extra);
            $this->services[(int) $id] = $row;
            return $row;
        }
    }

    /**
     * In-memory OrderStore mirroring OrderRepository semantics, including the
     * optimistic claim (awaiting -> in_flight) that guarantees idempotency.
     */
    final class FakeOrderStore implements OrderStore
    {
        public $rows = array();
        public $events = array();
        private $sequence = 0;

        public function findByServiceId($whmcsServiceId)
        {
            foreach ($this->rows as $row) {
                if ((int) $row->whmcs_service_id === (int) $whmcsServiceId) {
                    return $row;
                }
            }
            return null;
        }

        public function findById($orderId)
        {
            foreach ($this->rows as $row) {
                if ((int) $row->id === (int) $orderId) {
                    return $row;
                }
            }
            return null;
        }

        public function create(array $data)
        {
            $this->sequence++;
            $row = (object) array_merge(array(
                'id' => $this->sequence,
                'whmcs_service_id' => 0,
                'whmcs_order_id' => 0,
                'whmcs_client_id' => 0,
                'whmcs_product_id' => 0,
                'mapping_id' => 0,
                'provider_id' => 0,
                'provider_service_id' => '',
                'provider_name' => '',
                'service_name' => '',
                'provider_order_id' => '',
                'target_url' => '',
                'quantity' => 0,
                'start_count' => null,
                'remains' => null,
                'customer_price' => null,
                'provider_cost' => null,
                'currency' => '',
                'submission_state' => 'awaiting_submission',
                'order_status' => null,
                'provider_status_raw' => '',
                'needs_review' => 0,
                'suspended' => 0,
                'refill_supported' => 0,
                'cancel_supported' => 0,
                'last_refill_id' => '',
                'last_refill_status' => '',
                'error_message' => '',
                'correlation_id' => '',
                'submitted_at' => null,
                'last_status_at' => null,
                'last_sync_at' => null,
            ), $data);
            $this->rows[$row->id] = $row;
            return $row->id;
        }

        public function claimForSubmission($orderId)
        {
            $row = $this->findById($orderId);
            if ($row === null || (string) $row->submission_state !== 'awaiting_submission') {
                return false;
            }
            $row->submission_state = 'in_flight';
            return true;
        }

        public function markAccepted($orderId, $providerOrderId, array $extra = array())
        {
            $row = $this->findById($orderId);
            if ($row === null) { return false; }
            $row->provider_order_id = (string) $providerOrderId;
            $row->submission_state = 'accepted';
            $row->error_message = '';
            $row->submitted_at = date('Y-m-d H:i:s');
            foreach ($extra as $k => $v) { $row->{$k} = $v; }
            return true;
        }

        public function markRejected($orderId, $message)
        {
            $row = $this->findById($orderId);
            if ($row === null) { return false; }
            $row->submission_state = 'rejected';
            $row->error_message = $message;
            return true;
        }

        public function markUncertain($orderId, $message)
        {
            $row = $this->findById($orderId);
            if ($row === null) { return false; }
            $row->submission_state = 'uncertain';
            $row->error_message = $message;
            return true;
        }

        public function updateFields($orderId, array $fields)
        {
            $row = $this->findById($orderId);
            if ($row === null) { return false; }
            foreach ($fields as $k => $v) { $row->{$k} = $v; }
            return true;
        }

        public function attachProviderOrderId($orderId, $providerOrderId)
        {
            $row = $this->findById($orderId);
            if ($row === null) { return false; }
            $row->provider_order_id = (string) $providerOrderId;
            $row->submission_state = 'accepted';
            $row->error_message = '';
            $row->submitted_at = date('Y-m-d H:i:s');
            return true;
        }

        public function eligibleForStatusSync($limit, $terminalRecheckWindow = 86400)
        {
            $terminal = \CloudHost247\Smm\Support\StatusMap::terminalStatuses();
            $cutoffTs = time() - max(3600, (int) $terminalRecheckWindow);
            $out = array();
            foreach ($this->rows as $row) {
                if ((string) $row->submission_state !== 'accepted' || (int) $row->suspended === 1) { continue; }
                if ($row->order_status !== null && in_array((string) $row->order_status, $terminal, true)) {
                    // terminal: re-verify only inside the window
                    $fresh = $row->last_status_at !== null && strtotime((string) $row->last_status_at) >= $cutoffTs;
                    if (!$fresh) { continue; }
                }
                $out[] = $row;
                if (count($out) >= (int) $limit) { break; }
            }
            return $out;
        }

        public function findByState($state, $limit)
        {
            $out = array();
            foreach ($this->rows as $row) {
                if ((string) $row->submission_state === (string) $state) {
                    $out[] = $row;
                    if (count($out) >= (int) $limit) { break; }
                }
            }
            return $out;
        }

        public function findNeedingReview($limit)
        {
            $out = array();
            foreach ($this->rows as $row) {
                if ((int) $row->needs_review === 1) {
                    $out[] = $row;
                    if (count($out) >= (int) $limit) { break; }
                }
            }
            return $out;
        }

        public function forClient($clientId, $limit = 200)
        {
            $out = array();
            foreach ($this->rows as $row) {
                if ((int) $row->whmcs_client_id === (int) $clientId) {
                    $out[] = $row;
                    if (count($out) >= $limit) { break; }
                }
            }
            return $out;
        }

        public function findByWhmcsService($whmcsServiceId, $clientId)
        {
            foreach ($this->rows as $row) {
                if ((int) $row->whmcs_service_id === (int) $whmcsServiceId && (int) $row->whmcs_client_id === (int) $clientId) {
                    return $row;
                }
            }
            return null;
        }

        public function staleInFlight($cutoffDateTime, $limit)
        {
            $out = array();
            foreach ($this->rows as $row) {
                if ((string) $row->submission_state === 'in_flight'
                    && isset($row->updated_at) && (string) $row->updated_at < (string) $cutoffDateTime) {
                    $out[] = $row;
                    if (count($out) >= (int) $limit) { break; }
                }
            }
            return $out;
        }

        public function recordEvent($orderId, $event, $fromStatus, $toStatus, $note, $actor, $actorId, $correlationId)
        {
            $this->events[] = (object) array(
                'order_id' => (int) $orderId,
                'event' => $event,
                'from_status' => $fromStatus,
                'to_status' => $toStatus,
                'note' => $note,
                'actor' => $actor,
                'actor_id' => $actorId,
                'correlation_id' => $correlationId,
            );
            return true;
        }
    }

    /** Records API calls (unredacted) so tests can assert redaction upstream. */
    final class FakeApiRecorder implements ApiRecorder
    {
        public $calls = array();

        public function record($providerId, $operation, array $request, $response, $httpStatus, $durationMs, $result, $correlationId)
        {
            $this->calls[] = array(
                'provider_id' => $providerId,
                'operation' => $operation,
                'request' => $request,
                'response' => $response,
                'http_status' => $httpStatus,
                'duration_ms' => $durationMs,
                'result' => $result,
                'correlation_id' => $correlationId,
            );
        }
    }

    /** UrlPolicy with deterministic DNS (TEST-NET-1 public answers). */
    final class TestUrlPolicy extends \CloudHost247\Smm\Support\UrlPolicy
    {
        public static $ips = array('203.0.113.10');

        protected static function resolveHost($host)
        {
            return self::$ips;
        }
    }
}

namespace {
    /** Deterministic stand-ins for the WHMCS encryption primitives. */
    if (!function_exists('encrypt')) {
        function encrypt($plaintext)
        {
            return 'enc_' . base64_encode((string) $plaintext);
        }
    }
    if (!function_exists('decrypt')) {
        function decrypt($sealed)
        {
            $value = (string) $sealed;
            return strpos($value, 'enc_') === 0 ? base64_decode(substr($value, 4)) : false;
        }
    }
}
