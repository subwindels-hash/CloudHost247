<?php
namespace CloudHost247\NetworkTools\Services\Ip;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Dns\DnsClient;
use CloudHost247\NetworkTools\Services\Service;

/**
 * IP blacklist (DNSBL) checker (docs section 21).
 *
 * Providers are administrator-managed rows in the tool provider registry, not a
 * hard-coded list. Only enabled providers are queried, each with its own
 * timeout, priority and documented reply meaning. A listing is reported with
 * the reply code the operator published; a non-answer is reported as a timeout
 * for that provider rather than as "not listed", because those are different
 * facts. With no provider enabled the tool reports CONFIGURATION_REQUIRED.
 */
final class BlacklistService extends Service
{
    protected function execute()
    {
        $ip = $this->input['ip'];
        $packed = IpMath::packed($ip);
        if ($packed === null) {
            return ToolResult::invalid('That is not a valid IP address.');
        }
        $providerRows = $this->provider()->toolProviders('dnsbl', true);
        if (!$providerRows) {
            return ToolResult::configurationRequired('No DNS blocklist provider is enabled. A CloudHost247 administrator must enable at least one provider in Admin → Tools → Providers before this check can run. No result is shown because a blocklist answer cannot be invented.');
        }
        $reverseName = \CloudHost247\NetworkTools\Dns\ReverseName::forIp($ip);
        if ($reverseName === null) {
            return ToolResult::invalid('That address cannot be reversed for a DNS blocklist query.');
        }
        // IPv4 blocklists only publish A records for the reversed address; IPv6
        // listings exist but are rare, and the reply semantics differ, so the
        // result says which family was actually queried.
        $family = strlen($packed) === 4 ? 'IPv4' : 'IPv6';
        $warnings = array();
        if ($family === 'IPv6') {
            $warnings[] = 'Several blocklist operators do not publish IPv6 listings. Their answers are therefore reported as NOT_SUPPORTED or TIMEOUT rather than as clean.';
        }
        $rows = array();
        $listed = 0;
        foreach ($providerRows as $provider) {
            $zone = (string) $provider->endpoint;
            $config = $this->providerRepository()->configuration($provider);
            $queryName = $reverseName . '.' . $zone;
            $timeout = max(1, min(15, (int) $provider->timeout_seconds));
            $response = $this->querySystem($queryName, 'A');
            $status = 'NOT_LISTED';
            $reply = array();
            $detail = 'No listing answer was returned for this address.';
            if (!$response['ok']) {
                if ($response['code'] === 'DOMAIN_NOT_FOUND' || (int) $response['rcode'] === 3) {
                    $status = 'NOT_LISTED';
                    $detail = 'The provider answered NXDOMAIN, which is the documented "not listed" answer.';
                } elseif ($response['code'] === 'TIMEOUT') {
                    $status = 'TIMEOUT';
                    $detail = 'The provider did not answer within ' . $timeout . ' seconds. This is not a "clean" result.';
                    $warnings[] = $provider->label . ' did not answer inside the timeout; its result is unknown.';
                } else {
                    $status = 'ERROR';
                    $detail = 'The query failed: ' . $response['error'];
                }
            } else {
                $reply = DnsClient::values($response['records'], 'A');
                if ($reply) {
                    $status = 'LISTED';
                    $listed++;
                    $detail = 'The provider returned ' . implode(', ', $reply) . '.';
                    if (isset($config['listed_reply']) && !in_array($config['listed_reply'], $reply, true)) {
                        $detail .= ' The documented listing reply for this provider is ' . $config['listed_reply'] . ', so read the reply code as published by the operator.';
                    }
                } else {
                    $status = 'NOT_LISTED';
                    $detail = 'The provider answered without a listing record.';
                }
            }
            $rows[] = array(
                'provider' => (string) $provider->label,
                'provider_key' => (string) $provider->provider_key,
                'zone' => $zone,
                'query_name' => $queryName,
                'status' => $status,
                'listed' => $status === 'LISTED',
                'reply' => $reply,
                'reply_meaning' => $this->replyMeaning($reply, $config),
                'detail' => $detail,
                'official_url' => isset($config['official_url']) ? $config['official_url'] : '',
                'delist_url' => isset($config['delist_url']) ? $config['delist_url'] : '',
                'policy_note' => isset($config['policy']) ? $config['policy'] : '',
                'checked_at' => gmdate('c'),
            );
        }
        if (!$rows) {
            return ToolResult::configurationRequired('No DNS blocklist provider is enabled.');
        }
        $checked = count($rows);
        return ToolResult::success(array(
            'ip' => $ip,
            'family' => $family,
            'providers_enabled' => $checked,
            'providers_listed' => $listed,
            'results' => $rows,
            'summary' => $listed === 0
                ? 'Not listed by the ' . $checked . ' enabled blocklist provider(s). Absence from these lists is not a statement about reputation in general.'
                : 'Listed by ' . $listed . ' of ' . $checked . ' enabled blocklist provider(s).',
            'explanation' => 'A DNS blocklist is one operator\'s list. A listing usually means the address was reported for sending unsolicited mail or for an exploited service; request removal from the operator and fix the cause first. Only the providers an administrator enabled are queried.',
        ), $warnings);
    }

    /** The same provider repository the tool-provider rows came from. */
    private function providerRepository()
    {
        if (isset($this->context['provider_rows']) && $this->context['provider_rows'] instanceof \CloudHost247\NetworkTools\Core\Repository\ProviderRepository) {
            return $this->context['provider_rows'];
        }
        return new \CloudHost247\NetworkTools\Core\Repository\ProviderRepository();
    }

    private function replyMeaning(array $reply, array $config)
    {
        if (!$reply) {
            return '';
        }
        $documented = isset($config['listed_reply']) ? (string) $config['listed_reply'] : '127.0.0.2';
        if (in_array($documented, $reply, true)) {
            return 'Reply ' . $documented . ' matches the documented listing code for this provider.';
        }
        return 'Reply code(s) ' . implode(', ', $reply) . ' returned; the provider documents ' . $documented . ' as its standard listing code, so consult the operator for the meaning of this specific code.';
    }
}
