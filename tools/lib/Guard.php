<?php
namespace CloudHost247\Tools;

/** Input, SSRF and abuse controls for server-side tools. */
final class Guard
{
    const MAX_BODY = 65536;

    public static function clientIp()
    {
        $remote = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '0.0.0.0';
        if (getenv('CH247_TRUST_PROXY') !== '1') {
            return self::isIp($remote) ? $remote : '0.0.0.0';
        }
        $candidates = array();
        if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
            $candidates[] = $_SERVER['HTTP_CF_CONNECTING_IP'];
        }
        if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $candidates = array_merge($candidates, explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']));
        }
        foreach ($candidates as $candidate) {
            $candidate = trim($candidate);
            if (self::isPublicIp($candidate)) {
                return $candidate;
            }
        }
        return self::isIp($remote) ? $remote : '0.0.0.0';
    }

    public static function isIp($value)
    {
        return filter_var($value, FILTER_VALIDATE_IP) !== false;
    }

    public static function isPublicIp($ip)
    {
        if (!self::isIp($ip)) {
            return false;
        }
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
            return false;
        }
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            $long = ip2long($ip);
            $blocked = array(
                array('0.0.0.0', 8), array('10.0.0.0', 8), array('100.64.0.0', 10), array('127.0.0.0', 8),
                array('169.254.0.0', 16), array('172.16.0.0', 12), array('192.0.0.0', 24), array('192.0.2.0', 24),
                array('192.168.0.0', 16), array('198.18.0.0', 15), array('198.51.100.0', 24), array('203.0.113.0', 24),
                array('224.0.0.0', 4), array('240.0.0.0', 4),
            );
            foreach ($blocked as $cidr) {
                $mask = -1 << (32 - $cidr[1]);
                if (($long & $mask) === (ip2long($cidr[0]) & $mask)) {
                    return false;
                }
            }
            return true;
        }
        $packed = inet_pton($ip);
        if ($packed === false) {
            return false;
        }
        $mapped = self::mappedV4($ip);
        if ($mapped !== null) {
            return self::isPublicIp($mapped);
        }
        $first = ord($packed[0]);
        if ($first === 0x00 && $packed === inet_pton('::')) {
            return false;
        }
        if (($first & 0xfe) === 0xfc) { // fc00::/7
            return false;
        }
        if ($first === 0xfe && (ord($packed[1]) & 0xc0) === 0x80) { // fe80::/10
            return false;
        }
        if ($first === 0xff) {
            return false;
        }
        return true;
    }

    public static function mappedV4($ip)
    {
        if (preg_match('/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i', $ip, $match)) {
            return $match[1];
        }
        return null;
    }

    public static function domain($value)
    {
        $value = strtolower(trim((string) $value, ". \t"));
        if ($value === '' || strlen($value) > 253) {
            return null;
        }
        if (filter_var($value, FILTER_VALIDATE_IP)) {
            return null;
        }
        if (!preg_match('/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/', $value) && !preg_match('/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/', $value)) {
            return null;
        }
        return $value;
    }

    public static function hostnameOrIp($value)
    {
        $value = trim((string) $value);
        if (self::isIp($value)) {
            return self::isPublicIp($value) ? $value : null;
        }
        return self::domain($value);
    }

    public static function publicUrl($value)
    {
        $parts = parse_url(trim((string) $value));
        if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) {
            return null;
        }
        $scheme = strtolower($parts['scheme']);
        if ($scheme !== 'http' && $scheme !== 'https') {
            return null;
        }
        if (isset($parts['user']) || isset($parts['pass'])) {
            return null;
        }
        $port = isset($parts['port']) ? (int) $parts['port'] : ($scheme === 'https' ? 443 : 80);
        if ($port !== 80 && $port !== 443) {
            return null;
        }
        $host = strtolower($parts['host']);
        if (self::isIp($host)) {
            if (!self::isPublicIp($host)) {
                return null;
            }
        } elseif (self::domain($host) === null && !preg_match('/^[a-z0-9.-]+$/', $host)) {
            return null;
        }
        $path = isset($parts['path']) ? $parts['path'] : '/';
        if (strpos($path, '\\') !== false) {
            return null;
        }
        $url = $scheme . '://' . $host . ($port === 80 || $port === 443 ? '' : ':' . $port) . $path;
        if (!empty($parts['query'])) {
            $url .= '?' . $parts['query'];
        }
        return array('url' => $url, 'scheme' => $scheme, 'host' => $host, 'port' => $port, 'path' => $path);
    }

    public static function resolvePublic($host)
    {
        $host = trim((string) $host);
        if (self::isIp($host)) {
            return self::isPublicIp($host) ? array($host) : array();
        }
        if (self::domain($host) === null) {
            return array();
        }
        $ips = array();
        $records = @dns_get_record($host, DNS_A + DNS_AAAA);
        if (is_array($records)) {
            foreach ($records as $record) {
                if (!empty($record['ip'])) {
                    $ips[] = $record['ip'];
                }
                if (!empty($record['ipv6'])) {
                    $ips[] = $record['ipv6'];
                }
            }
        }
        if (!$ips) {
            $v4 = @gethostbynamel($host);
            if (is_array($v4)) {
                $ips = $v4;
            }
        }
        if (!$ips) {
            foreach (array('A', 'AAAA') as $type) {
                $query = Net::doh($host, $type);
                if (empty($query['ok'])) {
                    continue;
                }
                foreach ($query['answers'] as $answer) {
                    if (self::isIp($answer['value'])) {
                        $ips[] = $answer['value'];
                    }
                }
            }
        }
        $public = array();
        foreach ($ips as $ip) {
            if (self::isPublicIp($ip)) {
                $public[] = $ip;
            } else {
                self::log('ssrf-block', $host . ' resolved to a non-public address');
                return array();
            }
        }
        return array_values(array_unique($public));
    }

    public static function rateLimit($ip, $slug, $limit)
    {
        $limit = max(1, min(120, (int) $limit));
        $dir = CH247_TOOLS_ROOT . '/tools/data/ratelimit';
        if (!is_dir($dir)) {
            @mkdir($dir, 0750, true);
        }
        $file = $dir . '/' . hash('sha256', $ip . '|' . $slug) . '.json';
        $handle = @fopen($file, 'c+');
        if (!$handle) {
            return true;
        }
        flock($handle, LOCK_EX);
        $raw = stream_get_contents($handle);
        $state = json_decode($raw ? $raw : '', true);
        $now = time();
        if (!is_array($state) || empty($state['reset']) || $state['reset'] <= $now) {
            $state = array('reset' => $now + 60, 'count' => 0);
        }
        $state['count']++;
        $allowed = $state['count'] <= $limit;
        rewind($handle);
        ftruncate($handle, 0);
        fwrite($handle, json_encode($state));
        fflush($handle);
        flock($handle, LOCK_UN);
        fclose($handle);
        if (!$allowed) {
            self::log('rate-limit', $slug);
        }
        return $allowed;
    }

    public static function log($event, $detail)
    {
        $dir = CH247_TOOLS_ROOT . '/tools/data';
        if (!is_dir($dir)) {
            @mkdir($dir, 0750, true);
        }
        $line = json_encode(array(
            'at' => gmdate('c'),
            'event' => substr((string) $event, 0, 40),
            'detail' => substr((string) $detail, 0, 180),
            'ip' => hash('sha256', self::clientIp()),
        ));
        @file_put_contents($dir . '/security.log', $line . "\n", FILE_APPEND | LOCK_EX);
    }

    public static function text($value, $max)
    {
        $value = str_replace("\0", '', (string) $value);
        if (strlen($value) > $max) {
            return null;
        }
        return $value;
    }
}
