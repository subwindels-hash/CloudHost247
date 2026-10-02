<?php
namespace CloudHost247\NetworkTools\Core\Result;

/**
 * Environment capability probe (docs sections 90/91).
 *
 * CloudHost247 can be deployed on cPanel shared hosting where raw sockets,
 * ICMP, system binaries or outbound ports may be restricted. Every feature
 * that depends on such a facility asks this class first and reports
 * AVAILABLE / UNAVAILABLE_IN_THIS_ENVIRONMENT / CONFIGURATION_REQUIRED instead
 * of failing the whole application or inventing a result.
 */
final class Capability
{
    const AVAILABLE = 'AVAILABLE';
    const UNAVAILABLE = 'UNAVAILABLE_IN_THIS_ENVIRONMENT';
    const CONFIGURATION_REQUIRED = 'CONFIGURATION_REQUIRED';

    /** @var array|null memoised probe results (computed once per request) */
    private static $cache = array();

    public static function all()
    {
        $keys = array('udp_dns', 'tcp_outbound', 'raw_icmp', 'tls_client', 'curl', 'openssl', 'intl', 'bcmath', 'gmp', 'json', 'idn_intl', 'whois_tcp43', 'http_fetch', 'dns_get_record', 'cron', 'traceroute');
        $out = array();
        foreach ($keys as $key) {
            $out[$key] = self::state($key);
        }
        return $out;
    }

    /**
     * @return array{state:string,detail:string}
     */
    public static function check($key)
    {
        $state = self::state($key);
        return array('state' => $state, 'detail' => self::detail($key, $state));
    }

    public static function state($key)
    {
        if (!isset(self::$cache[$key])) {
            self::$cache[$key] = self::probe($key);
        }
        return self::$cache[$key];
    }

    public static function isAvailable($key)
    {
        return self::state($key) === self::AVAILABLE;
    }

    public static function detail($key, $state = null)
    {
        $state = $state === null ? self::state($key) : $state;
        $details = array(
            'udp_dns' => 'Outbound UDP port 53 (needed to query a specific DNS resolver directly).',
            'tcp_outbound' => 'Outbound TCP connections (used by WHOIS, port checking and SMTP diagnostics).',
            'raw_icmp' => 'Raw ICMP sockets. Require elevated privileges and are usually unavailable on cPanel shared hosting; ping falls back to a clearly-labelled TCP probe.',
            'tls_client' => 'Outbound TLS client streams (needed for certificate inspection and SMTP over TLS).',
            'curl' => 'The cURL extension, used for every outbound HTTP fetch.',
            'openssl' => 'The OpenSSL extension, used for certificate parsing and password hashing utilities.',
            'intl' => 'The intl extension, used for full IDNA/Unicode casing.',
            'bcmath' => 'The bcmath extension, used for large IPv6 arithmetic.',
            'gmp' => 'The GMP extension, used for large IPv6 arithmetic.',
            'json' => 'The JSON extension.',
            'idn_intl' => 'IDN conversion through intl. When unavailable the module uses its bundled, tested RFC 3492 punycode implementation.',
            'whois_tcp43' => 'Outbound TCP port 43 for WHOIS.',
            'http_fetch' => 'Fetching an external URL from the server (SSRF-guarded).',
            'dns_get_record' => 'PHP DNS functions, used as the fallback resolver.',
            'cron' => 'Scheduled tasks. CloudHost247 uses the WHMCS cron and cPanel cron jobs; the module never starts its own worker.',
            'traceroute' => 'ICMP-based traceroute. Never shelled out to a system binary; reported unavailable when raw sockets are not permitted.',
        );
        $detail = isset($details[$key]) ? $details[$key] : 'Unknown capability.';
        if ($state === self::UNAVAILABLE) {
            $detail .= ' Not available in this environment.';
        } elseif ($state === self::CONFIGURATION_REQUIRED) {
            $detail .= ' Requires configuration.';
        }
        return $detail;
    }

    public static function describeState($state)
    {
        $labels = array(
            self::AVAILABLE => 'Available',
            self::UNAVAILABLE => 'Unavailable in this environment',
            self::CONFIGURATION_REQUIRED => 'Configuration required',
        );
        return isset($labels[$state]) ? $labels[$state] : 'Unknown';
    }

    private static function probe($key)
    {
        switch ($key) {
            case 'raw_icmp':
                return function_exists('socket_create') && defined('SOCK_RAW') && defined('IPPROTO_ICMP') ? self::AVAILABLE : self::UNAVAILABLE;
            case 'curl':
                return extension_loaded('curl') ? self::AVAILABLE : self::UNAVAILABLE;
            case 'openssl':
                return extension_loaded('openssl') ? self::AVAILABLE : self::UNAVAILABLE;
            case 'intl':
                return extension_loaded('intl') ? self::AVAILABLE : self::UNAVAILABLE;
            case 'bcmath':
                return extension_loaded('bcmath') ? self::AVAILABLE : self::UNAVAILABLE;
            case 'gmp':
                return extension_loaded('gmp') ? self::AVAILABLE : self::UNAVAILABLE;
            case 'json':
                return function_exists('json_encode') ? self::AVAILABLE : self::UNAVAILABLE;
            case 'idn_intl':
                return function_exists('idn_to_ascii') ? self::AVAILABLE : self::UNAVAILABLE;
            case 'dns_get_record':
                return function_exists('dns_get_record') ? self::AVAILABLE : self::UNAVAILABLE;
            case 'udp_dns':
                return function_exists('stream_socket_client') || function_exists('fsockopen') ? self::AVAILABLE : self::UNAVAILABLE;
            case 'tcp_outbound':
            case 'whois_tcp43':
            case 'tls_client':
            case 'http_fetch':
                return function_exists('stream_socket_client') ? self::AVAILABLE : self::UNAVAILABLE;
            case 'traceroute':
                // Traceroute needs raw ICMP or a privileged binary; neither is
                // assumed. A real capability test is performed by the service.
                return self::state('raw_icmp');
            case 'cron':
                // The module hooks into the existing WHMCS/cPanel cron; it never
                // creates its own worker, so this is always available.
                return self::AVAILABLE;
            default:
                return self::UNAVAILABLE;
        }
    }

    /** Test-only reset so suites can exercise both branches. */
    public static function reset()
    {
        self::$cache = array();
    }
}
