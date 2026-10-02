<?php
namespace CloudHost247\NetworkTools\Core\Security;

use InvalidArgumentException;

/**
 * Single source of truth for the shape of every tool input.
 *
 * The same field schema that renders a tool form (see Core\Registry\ToolField)
 * is validated here on submit, and the REST API reuses both, so a value can
 * never reach a service that has not passed the same normalisation. Values are
 * returned normalised (lower-cased hostnames, compressed IPs, integer ports),
 * never merely asserted.
 */
final class TargetValidator
{
    const MAX_PORT_SPAN = 32;      // a "range" can never become a scan
    const MAX_HOST_LENGTH = 253;
    const MAX_URL_LENGTH = 2048;
    const MAX_SELECTOR_LENGTH = 63;

    public static function hostname($value, $field = 'host')
    {
        $value = strtolower(rtrim(trim((string) $value), '.'));
        if ($value === '' || strlen($value) > self::MAX_HOST_LENGTH) {
            throw new InvalidArgumentException(ucfirst($field) . ' must be a hostname of up to ' . self::MAX_HOST_LENGTH . ' characters.');
        }
        if (filter_var(trim($value, '[]'), FILTER_VALIDATE_IP) !== false) {
            return trim($value, '[]');
        }
        if (!SsrfGuard::isValidHostname($value)) {
            throw new InvalidArgumentException(ucfirst($field) . ' is not a valid hostname.');
        }
        return $value;
    }

    /** A public hostname or IP that this tool may contact. */
    public static function publicTarget($value, array $policy = array(), $field = 'target')
    {
        $host = self::hostname($value, $field);
        $verdict = SsrfGuard::validateHost($host, $policy);
        if (!$verdict['ok']) {
            throw new InvalidArgumentException($verdict['message']);
        }
        return array('host' => $verdict['host'], 'addresses' => $verdict['addresses']);
    }

    public static function ip($value, $allowPrivate = true, $field = 'IP address')
    {
        $value = trim((string) $value, " \t\n\r[]");
        if ($value === '') {
            throw new InvalidArgumentException($field . ' is required.');
        }
        if (filter_var($value, FILTER_VALIDATE_IP) === false) {
            throw new InvalidArgumentException($field . ' is not a valid IPv4 or IPv6 address.');
        }
        if (!$allowPrivate && !SsrfGuard::isAllowedAddress($value)) {
            throw new InvalidArgumentException('Private, loopback and reserved addresses are not accepted here.');
        }
        $packed = inet_pton($value);
        return inet_ntop($packed);
    }

    public static function domain($value, $field = 'domain')
    {
        $value = strtolower(rtrim(trim((string) $value), '.'));
        if ($value === '' || strlen($value) > self::MAX_HOST_LENGTH) {
            throw new InvalidArgumentException(ucfirst($field) . ' is required.');
        }
        // A registrable name or a deeper name, but always at least two labels
        // and never an IP literal.
        if (filter_var($value, FILTER_VALIDATE_IP) !== false || substr_count($value, '.') < 1) {
            throw new InvalidArgumentException(ucfirst($field) . ' must include a public suffix, for example example.com.');
        }
        if (!SsrfGuard::isValidHostname($value)) {
            throw new InvalidArgumentException(ucfirst($field) . ' is not a valid domain name.');
        }
        $labels = explode('.', $value);
        foreach ($labels as $label) {
            if (strlen($label) > 63 || $label[0] === '-' || substr($label, -1) === '-') {
                throw new InvalidArgumentException(ucfirst($field) . ' is not a valid domain name.');
            }
        }
        // The last label must look like a public suffix: alphabetic (or the
        // punycode form of an internationalised suffix) and at least two
        // characters. It is a shape check, not a live PSL lookup — the public
        // suffix list lives with the domain services, not in this validator.
        $suffix = substr(strrchr($value, '.'), 1);
        if (!preg_match('/^([a-z]{2,63}|xn--[a-z0-9-]{2,59})$/', $suffix)) {
            throw new InvalidArgumentException('That domain does not end in a valid public suffix.');
        }
        return $value;
    }

    /** Email local part + domain, kept deliberately strict (no quoted forms). */
    public static function email($value, $field = 'email address')
    {
        $value = trim((string) $value);
        if (strlen($value) > 254 || filter_var($value, FILTER_VALIDATE_EMAIL) === false) {
            throw new InvalidArgumentException('That ' . $field . ' is not valid.');
        }
        return $value;
    }

    public static function port($value, $field = 'port')
    {
        $value = trim((string) $value);
        if ($value === '' || !ctype_digit($value)) {
            throw new InvalidArgumentException(ucfirst($field) . ' must be a number between 1 and 65535.');
        }
        $port = (int) $value;
        if ($port < 1 || $port > 65535) {
            throw new InvalidArgumentException(ucfirst($field) . ' must be between 1 and 65535.');
        }
        return $port;
    }

    /**
     * A small, bounded set of ports: "443", "80,443", "8000-8010".
     *
     * @return int[]
     */
    public static function portSet($value, $maxPorts = self::MAX_PORT_SPAN)
    {
        $value = trim((string) $value);
        if ($value === '') {
            throw new InvalidArgumentException('At least one port is required.');
        }
        $ports = array();
        foreach (preg_split('/[\s,]+/', $value, -1, PREG_SPLIT_NO_EMPTY) as $token) {
            if (strpos($token, '-') !== false) {
                $bounds = explode('-', $token);
                if (count($bounds) !== 2) {
                    throw new InvalidArgumentException('Port ranges must be written as start-end, for example 8000-8010.');
                }
                $start = self::port($bounds[0], 'range start');
                $end = self::port($bounds[1], 'range end');
                if ($end < $start) {
                    throw new InvalidArgumentException('The end of a port range cannot be lower than its start.');
                }
                if (($end - $start + 1) > self::MAX_PORT_SPAN) {
                    throw new InvalidArgumentException('A single range may contain at most ' . self::MAX_PORT_SPAN . ' ports in this tool.');
                }
                for ($port = $start; $port <= $end; $port++) {
                    $ports[] = $port;
                }
                continue;
            }
            $ports[] = self::port($token);
        }
        $ports = array_values(array_unique($ports));
        sort($ports);
        if (count($ports) > $maxPorts) {
            throw new InvalidArgumentException('At most ' . $maxPorts . ' ports may be checked in one request.');
        }
        return $ports;
    }

    /**
     * Absolute http(s) URL. Paths, ports and query strings are allowed; user
     * info and fragments are not (they have no diagnostic value and hide the
     * real target).
     *
     * @return array{scheme:string,host:string,port:int,path:string,query:string,url:string}
     */
    public static function url($value, array $allowedSchemes = array('https', 'http'))
    {
        $value = trim((string) $value);
        if ($value === '' || strlen($value) > self::MAX_URL_LENGTH) {
            throw new InvalidArgumentException('A URL of up to ' . self::MAX_URL_LENGTH . ' characters is required.');
        }
        if (preg_match('/[\s\r\n]/', $value)) {
            throw new InvalidArgumentException('The URL must not contain spaces or line breaks.');
        }
        if (strpos($value, '://') === false) {
            $value = 'https://' . $value;
        }
        $parts = parse_url($value);
        if (!is_array($parts) || empty($parts['host'])) {
            throw new InvalidArgumentException('That URL could not be parsed.');
        }
        $scheme = strtolower(isset($parts['scheme']) ? $parts['scheme'] : '');
        if (!in_array($scheme, $allowedSchemes, true)) {
            throw new InvalidArgumentException('Only ' . implode(' and ', $allowedSchemes) . ' URLs are supported by this tool.');
        }
        if (isset($parts['user']) || isset($parts['pass'])) {
            throw new InvalidArgumentException('Credentials must not be embedded in the URL.');
        }
        $host = self::hostname($parts['host'], 'host');
        $port = isset($parts['port']) ? self::port($parts['port']) : ($scheme === 'https' ? 443 : 80);
        $path = isset($parts['path']) && $parts['path'] !== '' ? $parts['path'] : '/';
        $query = isset($parts['query']) ? '?' . $parts['query'] : '';
        return array(
            'scheme' => $scheme,
            'host' => $host,
            'port' => $port,
            'path' => $path,
            'query' => $query,
            'url' => $scheme . '://' . $host . ($port === ($scheme === 'https' ? 443 : 80) ? '' : ':' . $port) . $path . $query,
        );
    }

    public static function asn($value)
    {
        $value = strtoupper(trim((string) $value));
        $value = preg_replace('/^AS[\s:-]*/', '', $value);
        if ($value === '' || !ctype_digit($value)) {
            throw new InvalidArgumentException('An ASN must be a number, for example AS15169 or 15169.');
        }
        $number = (int) $value;
        if ($number < 1 || $number > 4294967295) {
            throw new InvalidArgumentException('That ASN is outside the valid 32-bit range.');
        }
        return 'AS' . $number;
    }

    public static function mac($value)
    {
        $value = strtoupper(trim((string) $value));
        $value = str_replace(array('-', ':', ' ', '.'), '', $value);
        if (!preg_match('/^[0-9A-F]{12}$/', $value)) {
            throw new InvalidArgumentException('A MAC address must contain 12 hexadecimal characters, for example 00:1B:44:11:3A:B7.');
        }
        return implode(':', str_split($value, 2));
    }

    public static function dkimSelector($value)
    {
        $value = strtolower(trim((string) $value));
        if ($value === '' || strlen($value) > self::MAX_SELECTOR_LENGTH) {
            throw new InvalidArgumentException('A DKIM selector is required (for example "default" or "google").');
        }
        if (!preg_match('/^[a-z0-9]([a-z0-9._-]{0,61}[a-z0-9])?$/', $value)) {
            throw new InvalidArgumentException('That DKIM selector is not valid.');
        }
        return $value;
    }

    public static function cidr($value)
    {
        $value = trim((string) $value);
        if (strpos($value, '/') === false) {
            $value .= filter_var($value, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== false ? '/128' : '/32';
        }
        $parts = explode('/', $value);
        if (count($parts) !== 2) {
            throw new InvalidArgumentException('Use CIDR notation, for example 192.0.2.0/24.');
        }
        $address = self::ip($parts[0]);
        if (!ctype_digit($parts[1])) {
            throw new InvalidArgumentException('The CIDR prefix length must be a number.');
        }
        $bits = (int) $parts[1];
        $maxBits = filter_var($address, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== false ? 128 : 32;
        if ($bits < 0 || $bits > $maxBits) {
            throw new InvalidArgumentException('A /' . $maxBits . ' is the largest prefix for that address family.');
        }
        return array('address' => $address, 'prefix' => $bits, 'cidr' => $address . '/' . $bits);
    }

    public static function choice($value, array $allowed, $field = 'value')
    {
        $value = strtolower(trim((string) $value));
        if (!in_array($value, array_map('strtolower', $allowed), true)) {
            throw new InvalidArgumentException(ucfirst($field) . ' must be one of: ' . implode(', ', $allowed) . '.');
        }
        return $value;
    }

    public static function integer($value, $min, $max, $field = 'value')
    {
        if (!is_numeric($value) || (string) (int) $value !== trim((string) $value)) {
            throw new InvalidArgumentException(ucfirst($field) . ' must be a whole number.');
        }
        $number = (int) $value;
        if ($number < $min || $number > $max) {
            throw new InvalidArgumentException(ucfirst($field) . ' must be between ' . $min . ' and ' . $max . '.');
        }
        return $number;
    }

    public static function text($value, $maxLength, $field = 'value', $allowEmpty = false)
    {
        $value = (string) $value;
        if (!$allowEmpty && trim($value) === '') {
            throw new InvalidArgumentException(ucfirst($field) . ' is required.');
        }
        if (strlen($value) > $maxLength) {
            throw new InvalidArgumentException(ucfirst($field) . ' exceeds the maximum length of ' . $maxLength . ' characters.');
        }
        if (strpos($value, "\0") !== false) {
            throw new InvalidArgumentException(ucfirst($field) . ' contains invalid characters.');
        }
        return $value;
    }
}
