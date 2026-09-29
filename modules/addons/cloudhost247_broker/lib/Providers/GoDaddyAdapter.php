<?php
namespace CloudHost247\Broker\Providers;

use CloudHost247\Integrations\Api\TransportException;
use CloudHost247\Integrations\Services\IntegrationManager;
use CloudHost247\Integrations\Support\IntegrationException;

/**
 * GoDaddy Domains API (requirement #12).
 *
 * Only the officially documented registrar operations are exposed:
 * availability, DNS, contacts and transfer. GoDaddy's normal Domains API does
 * not provide unrestricted aftermarket/brokerage access, so this adapter
 * never declares brokerage_request, owner_contact, negotiation or escrow —
 * doing so would misrepresent what the connected API can actually do.
 */
final class GoDaddyAdapter extends AbstractIntegrationAdapter
{
    const KEY = 'godaddy';

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
    public function checkAvailability($domain)
    {
        if (!$this->supports(Capability::DOMAIN_AVAILABILITY)) { return null; }
        $domain = strtolower(trim((string) $domain));
        if (!preg_match('/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/', $domain)) {
            return null;
        }
        try {
            $client = IntegrationManager::client(self::KEY);
            $path = '/v1/domains/available?domain=' . rawurlencode($domain) . '&checkType=FAST';
            $response = $client->request('GET', $path);
        } catch (IntegrationException $e) {
            return null;
        } catch (TransportException $e) {
            return null;
        } catch (\Throwable $e) {
            return null;
        }
        if ($response['status'] !== 200 || !is_array($response['json'])) { return null; }
        $json = $response['json'];
        if (!isset($json['available'])) { return null; }
        return array(
            'available' => (bool) $json['available'],
            'definitive' => isset($json['definitive']) ? (bool) $json['definitive'] : true,
            'currency' => isset($json['currency']) ? (string) $json['currency'] : '',
            'price' => isset($json['price']) ? (float) ($json['price'] / 1000000) : null,
        );
    }
}
