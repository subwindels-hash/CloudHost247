<?php
namespace CloudHost247\Broker\Providers;

use CloudHost247\Broker\Repositories\ProviderCallRepository;
use CloudHost247\Broker\Repositories\ProviderConfigRepository;
use CloudHost247\Integrations\Services\IntegrationManager;
use CloudHost247\Integrations\Support\ResultCode;
use CloudHost247\Integrations\Api\TransportException;
use CloudHost247\Integrations\Support\IntegrationException;
use CloudHost247\Foundation\Support\Logger;

/**
 * GoDaddy Domains API (requirement #12).
 *
 * Only the officially documented registrar operations are exposed:
 * availability, DNS, contacts and transfer. GoDaddy's normal Domains API does
 * not provide unrestricted aftermarket/brokerage access, so this adapter
 * never declares brokerage_request, owner_contact, negotiation or escrow —
 * doing so would misrepresent what the connected API can actually do.
 *
 * Every real outbound call is recorded in the brokerage provider-call ledger
 * (requirement #38) with a correlation id, the sanitized result code, the
 * HTTP status and the latency. Provider responses, credentials and headers
 * are never written there.
 */
final class GoDaddyAdapter extends AbstractIntegrationAdapter
{
    const KEY = 'godaddy';

    private $calls;

    /** Optional request callable for tests: fn(string $domain): array{status:int, json:?array}. Never for credentials. */
    private $availabilityRequester;

    public function __construct(ProviderConfigRepository $configRepository = null, ProviderCallRepository $calls = null, $availabilityRequester = null)
    {
        parent::__construct($configRepository);
        $this->calls = $calls ?: new ProviderCallRepository();
        $this->availabilityRequester = is_callable($availabilityRequester) ? $availabilityRequester : null;
    }

    public function key() { return self::KEY; }

    public function label() { return 'GoDaddy'; }

    public function declaredCapabilities()
    {
        return array(
            Capability::DOMAIN_AVAILABILITY,
            Capability::DOMAIN_REGISTRATION,
            Capability::DNS_MANAGEMENT,
            Capability::DOMAIN_CONTACTS,
            Capability::TRANSFER,
        );
    }

    /**
     * Real GoDaddy availability lookup. Returns null (never a guess) when the
     * integration is not configured/connected or the call fails; callers must
     * fall back to another source and must never invent an answer.
     *
     * @return array|null available(bool), currency, price, definitive
     */
    public function checkAvailability($domain, $caseId = 0)
    {
        if (!$this->supports(Capability::DOMAIN_AVAILABILITY)) { return null; }
        $domain = strtolower(trim((string) $domain));
        if (!preg_match('/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/', $domain)) {
            return null;
        }

        $correlationId = Logger::correlationId();
        $idempotencyKey = 'godaddy-availability-' . substr(sha1($domain . '|' . $correlationId), 0, 32);
        $started = microtime(true);
        $resultCode = ResultCode::NOT_CONFIGURED;
        $httpStatus = null;
        try {
            $response = $this->requestAvailability($domain);
            $httpStatus = isset($response['status']) ? (int) $response['status'] : null;
            $resultCode = $httpStatus !== null ? ResultCode::fromHttpStatus($httpStatus) : ResultCode::PROVIDER_UNAVAILABLE;
        } catch (TransportException $e) {
            $resultCode = ResultCode::fromTransportKind(method_exists($e, 'kind') ? $e->kind() : '');
        } catch (IntegrationException $e) {
            $resultCode = ResultCode::NOT_CONFIGURED;
        } catch (\Throwable $e) {
            $resultCode = ResultCode::PROVIDER_UNAVAILABLE;
        }
        $latencyMs = (int) round((microtime(true) - $started) * 1000);

        if (!isset($response) || !is_array($response) || !isset($response['json']) || !is_array($response['json'])) {
            $this->recordCall($caseId, $idempotencyKey, $resultCode, $correlationId, $httpStatus, $latencyMs);
            return null;
        }
        $responseOk = isset($response['status']) && $response['status'] === 200;
        $json = $response['json'];
        if (!$responseOk || !isset($json['available'])) {
            $this->recordCall($caseId, $idempotencyKey, $resultCode, $correlationId, $httpStatus, $latencyMs);
            return null;
        }
        $this->recordCall($caseId, $idempotencyKey, ResultCode::CONNECTED, $correlationId, $httpStatus, $latencyMs);
        return array(
            'available' => (bool) $json['available'],
            'definitive' => isset($json['definitive']) ? (bool) $json['definitive'] : true,
            'currency' => isset($json['currency']) ? (string) $json['currency'] : '',
            'price' => isset($json['price']) ? (float) ($json['price'] / 1000000) : null,
        );
    }

    /**
     * The raw availability request. Returns array(status:int, json:array|null)
     * and never leaks credentials. A test requester injected via the
     * constructor replaces the network call; production always uses the
     * central integration client.
     */
    protected function requestAvailability($domain)
    {
        if ($this->availabilityRequester !== null) {
            return call_user_func($this->availabilityRequester, $domain);
        }
        $client = IntegrationManager::client(self::KEY);
        $path = '/v1/domains/available?domain=' . rawurlencode($domain) . '&checkType=FAST';
        return $client->request('GET', $path);
    }

    /**
     * Append the call to the idempotent provider-call ledger. Recording is
     * best-effort and defensive by design: an observability failure must never
     * break the domain check itself.
     */
    private function recordCall($caseId, $idempotencyKey, $resultCode, $correlationId, $httpStatus, $latencyMs)
    {
        try {
            $this->calls->record((int) $caseId, self::KEY, 'domain_availability', $idempotencyKey, (string) $resultCode, (string) $correlationId, $httpStatus, $latencyMs);
        } catch (\Throwable $error) {
            // Never let ledger maintenance affect the availability result.
        }
    }
}
