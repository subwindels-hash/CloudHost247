<?php
namespace CloudHost247\Smm\Support;

use RuntimeException;

/**
 * SSRF boundary for provider endpoints.
 *
 * Provider API URLs are administrator-supplied, so every request is gated
 * here: only HTTPS, no URL credentials, no private/reserved/loopback target,
 * no credentials ever sent to a redirect target (cURL never follows).
 *
 * Known limitation (documented in CAPABILITIES.txt): DNS is resolved at
 * validation time; a provider whose DNS later flips to a private address is
 * still blocked because the check runs again immediately before each request.
 */
final class UrlPolicy
{
    private static $privateCidrs = array(
        '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8',
        '169.254.0.0/16', '0.0.0.0/8', '100.64.0.0/10', '192.0.0.0/24',
        '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4',
    );

    /**
     * Validate and return the normalized HTTPS URL, or throw.
     *
     * @param string $url
     * @return string
     * @throws RuntimeException
     */
    public static function assertProviderEndpoint($url)
    {
        $url = trim((string) $url);
        if ($url === '' || strlen($url) > 2048) {
            throw new RuntimeException('Provider API URL is required (max 2048 characters).');
        }
        $parts = parse_url($url);
        if (!is_array($parts)) {
            throw new RuntimeException('Provider API URL is not a valid URL.');
        }
        if (strtolower(isset($parts['scheme']) ? $parts['scheme'] : '') !== 'https') {
            throw new RuntimeException('Provider API URL must use HTTPS.');
        }
        $host = isset($parts['host']) ? strtolower($parts['host']) : '';
        if ($host === '' || strlen($host) > 253) {
            throw new RuntimeException('Provider API URL has no usable hostname.');
        }
        if (isset($parts['user']) || isset($parts['pass'])) {
            throw new RuntimeException('Provider API URL must not embed credentials.');
        }
        if (isset($parts['port']) && (int) $parts['port'] !== 443) {
            $port = (int) $parts['port'];
            if ($port < 1 || $port > 65535) {
                throw new RuntimeException('Provider API URL port is invalid.');
            }
        }
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            static::assertPublicIp($host);
            return $url;
        }
        if (!preg_match('/^[a-z0-9.-]+$/i', $host) || strpos($host, '..') !== false) {
            throw new RuntimeException('Provider API URL hostname is invalid.');
        }
        $resolved = static::resolveHost($host);
        if ($resolved === false || array() === $resolved) {
            throw new RuntimeException('Provider API host could not be resolved.');
        }
        foreach ($resolved as $ip) {
            static::assertPublicIp($ip);
        }
        return $url;
    }

    /**
     * Resolve a hostname to IPs. Extension point for deterministic testing:
     * tests subclass UrlPolicy and override this to avoid live DNS.
     * @return array|false
     */
    protected static function resolveHost($host)
    {
        return gethostbynamel($host);
    }

    /**
     * Validate a customer-submitted social media target link.
     * Accepts http/https with a public host; blocks scheme tricks, private
     * targets and obviously non-URL values. Never used to carry credentials.
     *
     * @param string $url
     * @return string normalized URL
     * @throws RuntimeException
     */
    public static function assertPublicTargetLink($url)
    {
        $url = trim((string) $url);
        if ($url === '' || strlen($url) > 512) {
            throw new RuntimeException('A target link is required (max 512 characters).');
        }
        $parts = parse_url($url);
        if (!is_array($parts)) {
            throw new RuntimeException('The target link is not a valid URL.');
        }
        $scheme = strtolower(isset($parts['scheme']) ? $parts['scheme'] : '');
        if ($scheme !== 'http' && $scheme !== 'https') {
            throw new RuntimeException('The target link must start with http:// or https://.');
        }
        $host = isset($parts['host']) ? strtolower($parts['host']) : '';
        if ($host === '' || strlen($host) > 253) {
            throw new RuntimeException('The target link has no usable hostname.');
        }
        if (isset($parts['user']) || isset($parts['pass'])) {
            throw new RuntimeException('The target link must not embed credentials.');
        }
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            static::assertPublicIp($host);
            return $url;
        }
        if (!preg_match('/^[a-z0-9.-]+$/i', $host) || strpos($host, '..') !== false) {
            throw new RuntimeException('The target link hostname is invalid.');
        }
        $resolved = static::resolveHost($host);
        if ($resolved === false || array() === $resolved) {
            throw new RuntimeException('The target link host could not be resolved.');
        }
        foreach ($resolved as $ip) {
            static::assertPublicIp($ip);
        }
        return $url;
    }

    private static function assertPublicIp($ip)
    {
        $packed = @inet_pton($ip);
        if ($packed === false || strlen($packed) !== 4) {
            // IPv6: block loopback, unique-local and link-local; SMM panels are public v4/v6.
            if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
                $lower = strtolower($ip);
                if ($ip === '::1' || strpos($lower, 'fc') === 0 || strpos($lower, 'fd') === 0
                    || strpos($lower, 'fe8') === 0 || strpos($lower, 'fe9') === 0
                    || strpos($lower, 'fea') === 0 || strpos($lower, 'feb') === 0) {
                    throw new RuntimeException('Provider/target host resolves to a non-public address.');
                }
                return;
            }
            throw new RuntimeException('Provider/target host resolves to an unsupported address.');
        }
        $long = ip2long($ip);
        foreach (self::$privateCidrs as $cidr) {
            list($net, $bits) = explode('/', $cidr);
            $netLong = ip2long($net);
            if (($long & (-1 << (32 - (int) $bits))) === ($netLong & (-1 << (32 - (int) $bits)))) {
                throw new RuntimeException('Provider/target host resolves to a non-public address.');
            }
        }
    }
}
