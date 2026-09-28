<?php
namespace CloudHost247\Integrations\Security;

use InvalidArgumentException;

/**
 * Outbound request boundary for administrator-supplied endpoints.
 *
 * Super Admin may change production endpoints, so every base URL is validated
 * before it can be used: HTTPS only, no embedded credentials, no query string
 * or fragment, no traversal, and no private / loopback / link-local literals
 * unless the deployment explicitly opts in for internal control panels.
 */
final class UrlGuard
{
    const ALLOW_PRIVATE_HOSTS = 'CH247_INTEGRATION_ALLOW_PRIVATE_HOSTS';
    const MAX_URL_LENGTH = 512;

    /**
     * @param string $url     administrator supplied base URL
     * @param array  $policy  'allowed_hosts' => array of exact hosts or ".suffix" entries
     *                        'allowed_ports' => array of permitted ports
     * @return string normalized base URL without a trailing slash
     */
    public static function normalizeBase($url, array $policy = array())
    {
        $url = trim((string) $url);
        if ($url === '' || strlen($url) > self::MAX_URL_LENGTH) {
            throw new InvalidArgumentException('The API base URL is missing or too long.');
        }
        if (preg_match('/[\s\r\n]/', $url)) {
            throw new InvalidArgumentException('The API base URL contains invalid characters.');
        }
        $parts = parse_url($url);
        if (!is_array($parts) || empty($parts['host'])) {
            throw new InvalidArgumentException('The API base URL could not be parsed.');
        }
        $scheme = isset($parts['scheme']) ? strtolower($parts['scheme']) : '';
        if ($scheme !== 'https') {
            throw new InvalidArgumentException('The API base URL must use HTTPS.');
        }
        if (isset($parts['user']) || isset($parts['pass'])) {
            throw new InvalidArgumentException('Credentials must not be embedded in the API base URL.');
        }
        if (isset($parts['query']) || isset($parts['fragment'])) {
            throw new InvalidArgumentException('The API base URL must not contain a query string or fragment.');
        }
        $host = strtolower($parts['host']);
        self::assertHostAllowed($host, isset($policy['allowed_hosts']) ? (array) $policy['allowed_hosts'] : array());
        self::assertHostReachable($host);
        $port = '';
        if (isset($parts['port'])) {
            $port = (int) $parts['port'];
            $allowedPorts = isset($policy['allowed_ports']) ? array_map('intval', (array) $policy['allowed_ports']) : array();
            if ($allowedPorts && !in_array($port, $allowedPorts, true)) {
                throw new InvalidArgumentException('The API base URL uses a port that this integration does not permit.');
            }
            if ($port < 1 || $port > 65535) {
                throw new InvalidArgumentException('The API base URL uses an invalid port.');
            }
            $port = ':' . $port;
        }
        $path = isset($parts['path']) ? rtrim($parts['path'], '/') : '';
        if ($path !== '' && (strpos($path, '..') !== false || $path[0] !== '/')) {
            throw new InvalidArgumentException('The API base URL path is not acceptable.');
        }
        return 'https://' . $host . $port . $path;
    }

    /** Validate a relative request path that will be appended to a base URL. */
    public static function path($path)
    {
        $path = (string) $path;
        if ($path === '') { return ''; }
        if ($path[0] !== '/' || strpos($path, '..') !== false || preg_match('/[\s\r\n]/', $path)) {
            throw new InvalidArgumentException('Unsafe API request path.');
        }
        if (strpos($path, '//') === 0) {
            throw new InvalidArgumentException('Unsafe API request path.');
        }
        return $path;
    }

    public static function privateHostsAllowed()
    {
        $flag = getenv(self::ALLOW_PRIVATE_HOSTS);
        return is_string($flag) && in_array(strtolower(trim($flag)), array('1', 'true', 'yes'), true);
    }

    private static function assertHostAllowed($host, array $allowedHosts)
    {
        if (!$allowedHosts) { return; }
        foreach ($allowedHosts as $allowed) {
            $allowed = strtolower(trim((string) $allowed));
            if ($allowed === '') { continue; }
            if ($allowed[0] === '.') {
                if (substr($host, -strlen($allowed)) === $allowed) { return; }
                continue;
            }
            if ($host === $allowed) { return; }
        }
        throw new InvalidArgumentException('This integration only permits its documented provider hosts.');
    }

    private static function assertHostReachable($host)
    {
        if (!preg_match('/^[a-z0-9._:\[\]-]{1,253}$/', $host)) {
            throw new InvalidArgumentException('The API host name is not valid.');
        }
        $literal = trim($host, '[]');
        if (filter_var($literal, FILTER_VALIDATE_IP) === false) {
            if (strpos($host, '.') === false) {
                throw new InvalidArgumentException('The API host must be a fully qualified domain name.');
            }
            return;
        }
        if (self::privateHostsAllowed()) { return; }
        $public = filter_var($literal, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
        if ($public === false) {
            throw new InvalidArgumentException('Private, loopback and reserved addresses are blocked unless ' . self::ALLOW_PRIVATE_HOSTS . ' is enabled.');
        }
    }
}
