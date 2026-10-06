<?php
namespace CloudHost247\Tools;

/** Outbound network helpers. TLS is verified. Destinations are pinned to public addresses. */
final class Net
{
    public static function doh($name, $type, $resolver = null)
    {
        $type = strtoupper($type);
        $started = microtime(true);
        $providers = $resolver ? array($resolver) : self::dohProviders();
        $last = 'No resolver responded.';
        foreach ($providers as $provider) {
            $url = self::dohUrl($provider, $name, $type);
            $response = self::request($url, array('Accept: application/dns-json'), 8, null);
            if (!$response['ok']) {
                $last = $response['error'];
                continue;
            }
            $json = json_decode($response['body'], true);
            if (!is_array($json)) {
                $last = 'Resolver returned an unreadable payload.';
                continue;
            }
            $answers = array();
            if (!empty($json['Answer']) && is_array($json['Answer'])) {
                foreach ($json['Answer'] as $answer) {
                    if (!is_array($answer)) {
                        continue;
                    }
                    $answers[] = array(
                        'name' => isset($answer['name']) ? $answer['name'] : $name,
                        'type' => isset($answer['type']) ? self::typeName($answer['type']) : $type,
                        'ttl' => isset($answer['TTL']) ? (int) $answer['TTL'] : null,
                        'value' => isset($answer['data']) ? $answer['data'] : '',
                    );
                }
            }
            return array(
                'ok' => true,
                'status' => isset($json['Status']) ? (int) $json['Status'] : null,
                'answers' => $answers,
                'resolver' => parse_url($provider, PHP_URL_HOST) ?: $provider,
                'elapsedMs' => (int) round((microtime(true) - $started) * 1000),
                'source' => $url,
            );
        }
        return array('ok' => false, 'error' => $last, 'answers' => array(), 'elapsedMs' => (int) round((microtime(true) - $started) * 1000));
    }

    public static function dohProviders()
    {
        $data = Catalog::data();
        if (!empty($data['providers']['doh']) && is_array($data['providers']['doh'])) {
            $out = array();
            foreach ($data['providers']['doh'] as $url) {
                if (is_string($url) && preg_match('#^https://[a-z0-9.-]+/#i', $url . (substr($url, -1) === '/' ? '' : '/'))) {
                    $out[] = rtrim($url, '?');
                }
            }
            if ($out) {
                return $out;
            }
        }
        return array(
            'https://cloudflare-dns.com/dns-query',
            'https://dns.google/resolve',
        );
    }

    public static function propagationResolvers()
    {
        return array(
            array('name' => 'Cloudflare', 'location' => 'Anycast published network', 'url' => 'https://cloudflare-dns.com/dns-query'),
            array('name' => 'Google Public DNS', 'location' => 'Anycast published network', 'url' => 'https://dns.google/resolve'),
            array('name' => 'Quad9', 'location' => 'Anycast published network', 'url' => 'https://dns.quad9.net/dns-query'),
            array('name' => 'OpenDNS', 'location' => 'Anycast published network', 'url' => 'https://doh.opendns.com/dns-query'),
            array('name' => 'AdGuard DNS', 'location' => 'Anycast published network', 'url' => 'https://dns.adguard-dns.com/dns-query'),
        );
    }

    public static function request($url, array $headers, $timeout, $pin)
    {
        $started = microtime(true);
        if (function_exists('curl_init')) {
            return self::curl($url, $headers, $timeout, $pin, $started);
        }
        return self::streams($url, $headers, $timeout, $started);
    }

    public static function tcp($ip, $port, $timeout)
    {
        $started = microtime(true);
        $errno = 0;
        $errstr = '';
        $socket = @fsockopen($ip, (int) $port, $errno, $errstr, $timeout);
        $elapsed = (int) round((microtime(true) - $started) * 1000);
        if (!$socket) {
            return array('ok' => false, 'error' => $errstr !== '' ? $errstr : 'connection failed', 'elapsedMs' => $elapsed, 'errno' => $errno);
        }
        fclose($socket);
        return array('ok' => true, 'elapsedMs' => $elapsed);
    }

    public static function readBanner($ip, $port, $hello, $timeout)
    {
        $errno = 0;
        $errstr = '';
        $socket = @fsockopen($ip, (int) $port, $errno, $errstr, $timeout);
        if (!$socket) {
            return array('ok' => false, 'error' => $errstr !== '' ? $errstr : 'connection failed');
        }
        stream_set_timeout($socket, $timeout);
        if ($hello !== '') {
            fwrite($socket, $hello);
        }
        $banner = '';
        while (!feof($socket) && strlen($banner) < 2048) {
            $chunk = fread($socket, 512);
            if ($chunk === false || $chunk === '') {
                break;
            }
            $banner .= $chunk;
            if (strpos($banner, "\n") !== false) {
                break;
            }
        }
        fclose($socket);
        return array('ok' => true, 'banner' => trim($banner));
    }

    public static function certificate($host, $ip)
    {
        $context = stream_context_create(array(
            'ssl' => array(
                'capture_peer_cert' => true,
                'verify_peer' => true,
                'verify_peer_name' => true,
                'peer_name' => $host,
                'SNI_enabled' => true,
                'SNI_server_name' => $host,
            ),
        ));
        $errno = 0;
        $errstr = '';
        $socket = @stream_socket_client('ssl://' . $ip . ':443', $errno, $errstr, 8, STREAM_CLIENT_CONNECT, $context);
        if (!$socket) {
            return array('ok' => false, 'error' => $errstr !== '' ? $errstr : 'TLS handshake failed');
        }
        $meta = stream_context_get_params($socket);
        fclose($socket);
        if (empty($meta['options']['ssl']['peer_certificate'])) {
            return array('ok' => false, 'error' => 'No certificate was presented.');
        }
        $parsed = openssl_x509_parse($meta['options']['ssl']['peer_certificate']);
        if (!is_array($parsed)) {
            return array('ok' => false, 'error' => 'Certificate could not be parsed.');
        }
        $names = array();
        if (!empty($parsed['extensions']['subjectAltName'])) {
            $names = array_map('trim', explode(',', $parsed['extensions']['subjectAltName']));
        }
        return array(
            'ok' => true,
            'subject' => isset($parsed['name']) ? $parsed['name'] : '',
            'issuer' => isset($parsed['issuer']['CN']) ? $parsed['issuer']['CN'] : '',
            'validFrom' => isset($parsed['validFrom_time_t']) ? gmdate('c', $parsed['validFrom_time_t']) : '',
            'validTo' => isset($parsed['validTo_time_t']) ? gmdate('c', $parsed['validTo_time_t']) : '',
            'names' => $names,
            'expired' => isset($parsed['validTo_time_t']) ? $parsed['validTo_time_t'] < time() : null,
        );
    }

    private static function dohUrl($provider, $name, $type)
    {
        $join = strpos($provider, '?') === false ? '?' : '&';
        return $provider . $join . 'name=' . rawurlencode($name) . '&type=' . rawurlencode($type);
    }

    private static function curl($url, array $headers, $timeout, $pin, $started)
    {
        $handle = curl_init($url);
        $options = array(
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => min(5, $timeout),
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_USERAGENT => 'CloudHost247-Tools/1.0',
            CURLOPT_MAXFILESIZE => 524288,
        );
        if ($pin) {
            $parts = parse_url($url);
            $port = isset($parts['port']) ? (int) $parts['port'] : (isset($parts['scheme']) && $parts['scheme'] === 'http' ? 80 : 443);
            $options[CURLOPT_RESOLVE] = array($parts['host'] . ':' . $port . ':' . $pin);
        }
        curl_setopt_array($handle, $options);
        $body = curl_exec($handle);
        $error = curl_error($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        curl_close($handle);
        if ($body === false) {
            return array('ok' => false, 'error' => $error !== '' ? $error : 'request failed', 'status' => $status, 'body' => '', 'elapsedMs' => (int) round((microtime(true) - $started) * 1000));
        }
        if (strlen($body) > 524288) {
            $body = substr($body, 0, 524288);
        }
        return array('ok' => $status >= 200 && $status < 400, 'status' => $status, 'body' => $body, 'error' => $status >= 400 ? 'HTTP ' . $status : '', 'elapsedMs' => (int) round((microtime(true) - $started) * 1000), 'headers' => array());
    }

    private static function streams($url, array $headers, $timeout, $started)
    {
        $context = stream_context_create(array(
            'http' => array(
                'timeout' => $timeout,
                'header' => implode("\r\n", $headers),
                'ignore_errors' => true,
                'follow_location' => 0,
                'user_agent' => 'CloudHost247-Tools/1.0',
            ),
            'ssl' => array('verify_peer' => true, 'verify_peer_name' => true),
        ));
        $body = @file_get_contents($url, false, $context, 0, 524288);
        if ($body === false) {
            return array('ok' => false, 'error' => 'request failed', 'status' => 0, 'body' => '', 'elapsedMs' => (int) round((microtime(true) - $started) * 1000));
        }
        return array('ok' => true, 'status' => 200, 'body' => $body, 'error' => '', 'elapsedMs' => (int) round((microtime(true) - $started) * 1000));
    }

    private static function typeName($type)
    {
        $map = array(1 => 'A', 2 => 'NS', 5 => 'CNAME', 6 => 'SOA', 12 => 'PTR', 15 => 'MX', 16 => 'TXT', 28 => 'AAAA', 33 => 'SRV', 43 => 'DS', 48 => 'DNSKEY', 257 => 'CAA');
        return isset($map[(int) $type]) ? $map[(int) $type] : (string) $type;
    }
}
