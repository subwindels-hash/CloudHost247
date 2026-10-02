<?php
namespace CloudHost247\NetworkTools\Core\Security;

use CloudHost247\NetworkTools\Core\Result\ErrorCode;
use CloudHost247\NetworkTools\Core\Result\ToolResult;

/**
 * Outbound-request boundary for every tool that fetches or connects to a
 * user-supplied target (docs sections 24, 26, 30, 34, 69).
 *
 * Rules, in order:
 *  1. the value must be a syntactically valid hostname or IP literal;
 *  2. the host is resolved with the module's own DNS client (A + AAAA) and
 *     *every* returned address must be public;
 *  3. cloud metadata hostnames and addresses are rejected explicitly;
 *  4. the caller pins the connection to the validated addresses
 *     (curl: CURLOPT_RESOLVE; sockets: connect to the literal address) so a
 *     hostname cannot be re-pointed between validation and connection
 *     (DNS rebinding);
 *  5. redirects are never followed automatically: each hop is re-validated.
 *
 * Private, loopback, link-local, CGNAT, unique-local and reserved ranges are
 * blocked. A deployment may opt in to internal control panels only through the
 * explicit CH247_NT_ALLOW_PRIVATE_HOSTS environment flag plus a host
 * allowlist — never per request.
 */
final class SsrfGuard
{
    const ALLOW_PRIVATE_FLAG = 'CH247_NT_ALLOW_PRIVATE_HOSTS';

    /** Cloud instance metadata endpoints (AWS/GCP/Azure/OpenStack/Alibaba/DO). */
    private static $metadataHosts = array(
        'metadata.google.internal',
        'metadata.goog',
        'instance-data',
        'metadata',
        'metadata.azure.com',
        '169.254.169.254.nip.io',
        'metadata.oraclecloud.com',
    );

    private static $metadataAddresses = array(
        '169.254.169.254', // AWS/GCP/Azure/OpenStack
        '169.254.170.2',   // ECS task metadata
        '100.100.100.200', // Alibaba Cloud
        '192.0.0.192',     // Oracle Cloud
        'fd00:ec2::254',   // AWS IPv6 IMDS
        'fe80::a9fe:a9fe', // link-local IMDS
    );

    /** CIDR ranges that may never be reached from a tool. */
    private static $blockedV4 = array(
        '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
        '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15',
        '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4', '255.255.255.255/32',
    );

    private static $blockedV6 = array(
        '::/128', '::1/128', '::ffff:0:0/96', '64:ff9b::/96', '100::/64', '2001:db8::/32',
        '2002::/16', 'fc00::/7', 'fe80::/10', 'ff00::/8',
    );

    /**
     * Validate a hostname/IP literal for outbound use.
     *
     * @param string $host
     * @param array  $policy optional 'allow_private' => bool, 'allow_hosts' => array
     * @return array{ok:bool,code:string,message:string,addresses:string[],host:string}
     */
    public static function validateHost($host, array $policy = array())
    {
        $host = strtolower(trim((string) $host));
        $host = rtrim($host, '.');
        if ($host === '') {
            return self::failure(ErrorCode::INVALID_INPUT, 'A target host is required.');
        }
        if (strlen($host) > 253 || preg_match('/[\s\/@\\\\?#]/', $host)) {
            return self::failure(ErrorCode::INVALID_INPUT, 'The target host is not a valid hostname or IP address.');
        }
        if (self::isMetadataHost($host) && !self::privateHostsAllowed($policy)) {
            return self::failure(ErrorCode::TARGET_BLOCKED, 'Requests to cloud instance metadata endpoints are blocked.');
        }
        if (filter_var(trim($host, '[]'), FILTER_VALIDATE_IP) !== false) {
            $literal = trim($host, '[]');
            if (!self::isAllowedAddress($literal, $policy)) {
                return self::failure(ErrorCode::TARGET_BLOCKED, 'Private, loopback and reserved addresses are blocked by this tool.');
            }
            return array('ok' => true, 'code' => ErrorCode::OK, 'message' => '', 'addresses' => array($literal), 'host' => $literal);
        }
        if (!self::isValidHostname($host)) {
            return self::failure(ErrorCode::INVALID_INPUT, 'The target host is not a valid hostname.');
        }
        if ($policy === array() && self::hasHostAllowlist()) {
            if (!self::hostMatchesAllowlist($host)) {
                return self::failure(ErrorCode::TARGET_BLOCKED, 'This tool may only contact hosts on the administrator allowlist.');
            }
        } elseif (!empty($policy['allow_hosts']) && !self::hostInList($host, (array) $policy['allow_hosts'])) {
            return self::failure(ErrorCode::TARGET_BLOCKED, 'This tool may only contact approved hosts.');
        }
        $addresses = self::resolve($host);
        if (!$addresses['ok']) {
            return self::failure(ErrorCode::DOMAIN_NOT_FOUND, $addresses['message']);
        }
        foreach ($addresses['addresses'] as $address) {
            if (!self::isAllowedAddress($address, $policy)) {
                return self::failure(ErrorCode::TARGET_BLOCKED, 'That hostname resolves to a private, loopback or reserved address (' . $address . '), which this tool must not contact.');
            }
        }
        return array('ok' => true, 'code' => ErrorCode::OK, 'message' => '', 'addresses' => $addresses['addresses'], 'host' => $host);
    }

    /**
     * Convenience wrapper returning a ToolResult failure, or null when the
     * target is acceptable.
     *
     * @return \CloudHost247\NetworkTools\Core\Result\ToolResult|null
     */
    public static function rejection($host, array $policy = array())
    {
        $verdict = self::validateHost($host, $policy);
        if ($verdict['ok']) {
            return null;
        }
        return ToolResult::failure($verdict['code'], $verdict['message']);
    }

    /** True when the address may be contacted under the given policy. */
    public static function isAllowedAddress($ip, array $policy = array())
    {
        $ip = trim((string) $ip, '[]');
        $packed = @inet_pton($ip);
        if ($packed === false) {
            return false;
        }
        if (self::privateHostsAllowed($policy)) {
            return true;
        }
        foreach (self::$metadataAddresses as $metadata) {
            if (self::sameAddress($ip, $metadata)) {
                return false;
            }
        }
        $mapped = self::mappedV4($ip);
        if ($mapped !== null) {
            // IPv4-mapped / NAT64 forms must be judged as the IPv4 they carry.
            return self::isAllowedAddress($mapped, $policy) && !in_array($mapped, array('127.0.0.1', '169.254.169.254'), true);
        }
        $ranges = strlen($packed) === 4 ? self::$blockedV4 : self::$blockedV6;
        foreach ($ranges as $cidr) {
            if (self::inCidr($ip, $cidr)) {
                return false;
            }
        }
        return true;
    }

    public static function isBlocked($ip)
    {
        return !self::isAllowedAddress($ip, array());
    }

    /** CURLOPT_RESOLVE entries that pin a request to validated addresses. */
    public static function pinEntries($host, array $addresses)
    {
        $entries = array();
        foreach ($addresses as $address) {
            $entries[] = $host . ':443:' . $address;
            $entries[] = $host . ':80:' . $address;
        }
        return array_values(array_unique($entries));
    }

    public static function privateHostsAllowed(array $policy = array())
    {
        if (!empty($policy['allow_private'])) {
            return true;
        }
        $flag = getenv(self::ALLOW_PRIVATE_FLAG);
        return is_string($flag) && in_array(strtolower(trim($flag)), array('1', 'true', 'yes'), true);
    }

    public static function hasHostAllowlist()
    {
        return trim((string) getenv('CH247_NT_ALLOWED_HOSTS')) !== '';
    }

    public static function hostMatchesAllowlist($host)
    {
        $list = preg_split('/[\s,]+/', (string) getenv('CH247_NT_ALLOWED_HOSTS'), -1, PREG_SPLIT_NO_EMPTY);
        return self::hostInList($host, $list ? $list : array());
    }

    private static function hostInList($host, array $list)
    {
        foreach ($list as $allowed) {
            $allowed = strtolower(trim((string) $allowed));
            if ($allowed === '') {
                continue;
            }
            if ($allowed[0] === '.') {
                if (substr($host, -strlen($allowed)) === $allowed || $host === substr($allowed, 1)) {
                    return true;
                }
                continue;
            }
            if ($host === $allowed) {
                return true;
            }
        }
        return false;
    }

    private static function isMetadataHost($host)
    {
        return in_array($host, self::$metadataHosts, true);
    }

    public static function isValidHostname($host)
    {
        if (strlen($host) > 253) {
            return false;
        }
        return preg_match('/^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)+$/', $host) === 1;
    }

    /**
     * Resolve A and AAAA records through the module's own resolver, falling
     * back to PHP's resolver only when UDP access is unavailable.
     *
     * @return array{ok:bool,addresses:string[],message:string}
     */
    public static function resolve($host)
    {
        $addresses = array();
        if (class_exists('CloudHost247\\NetworkTools\\Dns\\DnsClient')) {
            try {
                $client = \CloudHost247\NetworkTools\Dns\DnsClient::forSystemResolver();
                foreach (array('A', 'AAAA') as $type) {
                    $response = $client->query($host, $type, array('timeout' => 3, 'retries' => 1));
                    if (!empty($response['records'])) {
                        foreach ($response['records'] as $record) {
                            if (!empty($record['value']) && filter_var($record['value'], FILTER_VALIDATE_IP)) {
                                $addresses[] = $record['value'];
                            }
                        }
                    }
                }
            } catch (\Throwable $ignored) {
                $addresses = array();
            }
        }
        if (!$addresses && function_exists('dns_get_record')) {
            foreach (array(DNS_A, DNS_AAAA) as $type) {
                $records = @dns_get_record($host, $type);
                if (is_array($records)) {
                    foreach ($records as $record) {
                        if (!empty($record['ip'])) {
                            $addresses[] = $record['ip'];
                        }
                        if (!empty($record['ipv6'])) {
                            $addresses[] = $record['ipv6'];
                        }
                    }
                }
            }
        }
        $addresses = array_values(array_unique(array_filter($addresses, 'strlen')));
        if (!$addresses) {
            return array('ok' => false, 'addresses' => array(), 'message' => 'That hostname did not resolve to any address.');
        }
        return array('ok' => true, 'addresses' => $addresses, 'message' => '');
    }

    /** Direct IPv4 carried by an IPv4-mapped (::ffff:) or NAT64 (64:ff9b::) address. */
    public static function mappedV4($ip)
    {
        $packed = @inet_pton($ip);
        if ($packed === false || strlen($packed) !== 16) {
            return null;
        }
        $hex = bin2hex($packed);
        // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) both carry a
        // real IPv4 in the last four bytes.
        if (substr($hex, 0, 24) === '00000000000000000000ffff' || substr($hex, 0, 24) === '0064ff9b0000000000000000') {
            $mapped = @inet_ntop(hex2bin(substr($hex, 24, 8)));
            return $mapped === false ? null : $mapped;
        }
        return null;
    }

    public static function sameAddress($a, $b)
    {
        $packedA = @inet_pton(trim((string) $a, '[]'));
        $packedB = @inet_pton(trim((string) $b, '[]'));
        return $packedA !== false && $packedB !== false && $packedA === $packedB;
    }

    public static function inCidr($ip, $cidr)
    {
        $parts = explode('/', $cidr);
        if (count($parts) !== 2) {
            return false;
        }
        $packedIp = @inet_pton(trim($ip, '[]'));
        $packedNet = @inet_pton($parts[0]);
        if ($packedIp === false || $packedNet === false || strlen($packedIp) !== strlen($packedNet)) {
            return false;
        }
        $bits = (int) $parts[1];
        $maxBits = strlen($packedIp) * 8;
        if ($bits < 0 || $bits > $maxBits) {
            return false;
        }
        $wholeBytes = intdiv($bits, 8);
        $remainingBits = $bits % 8;
        if ($wholeBytes > 0 && substr($packedIp, 0, $wholeBytes) !== substr($packedNet, 0, $wholeBytes)) {
            return false;
        }
        if ($remainingBits === 0) {
            return true;
        }
        $mask = 0xff << (8 - $remainingBits) & 0xff;
        return (ord($packedIp[$wholeBytes]) & $mask) === (ord($packedNet[$wholeBytes]) & $mask);
    }

    private static function failure($code, $message)
    {
        return array('ok' => false, 'code' => $code, 'message' => $message, 'addresses' => array(), 'host' => '');
    }
}
