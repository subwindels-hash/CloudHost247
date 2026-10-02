<?php
namespace CloudHost247\NetworkTools\Services\Shared;

/**
 * Minimal WHOIS (TCP port 43) client for IP registries and domain registries.
 *
 * A WHOIS query is a line protocol, so the client only needs to be careful:
 * the server is chosen from the IANA referral for IPs (or the registry list for
 * TLDs), the reply is read with a size cap and a timeout, one referral is
 * followed when the registry asks for it, and the text is parsed into the
 * fields that the registries actually publish. Nothing is cached at this layer.
 */
final class WhoisClient
{
    const MAX_BYTES = 131072;
    const MAX_REFERRALS = 2;

    private static $rirs = array(
        'whois.arin.net' => 'ARIN (North America)',
        'whois.ripe.net' => 'RIPE NCC (Europe, Middle East, Central Asia)',
        'whois.apnic.net' => 'APNIC (Asia Pacific)',
        'whois.lacnic.net' => 'LACNIC (Latin America and Caribbean)',
        'whois.afrinic.net' => 'AFRINIC (Africa)',
    );

    /**
     * @return array{ok:bool,server:string,text:string,error:string,referrals:array}
     */
    public function queryIp($ip)
    {
        $server = $this->registryForIp($ip);
        return $this->query($server, $ip);
    }

    public function queryDomain($domain)
    {
        $server = $this->registryForDomain($domain);
        if ($server === '') {
            return array('ok' => false, 'server' => '', 'text' => '', 'error' => 'No WHOIS server is known for that top-level domain.', 'referrals' => array());
        }
        return $this->query($server, $domain);
    }

    public function query($server, $question)
    {
        if (!preg_match('/^[a-z0-9.\-]{4,64}$/', (string) $server)) {
            return array('ok' => false, 'server' => (string) $server, 'text' => '', 'error' => 'That WHOIS server name is not valid.', 'referrals' => array());
        }
        $referrals = array();
        $current = $server;
        for ($hop = 0; $hop <= self::MAX_REFERRALS; $hop++) {
            $started = microtime(true);
            $socket = @stream_socket_client('tcp://' . $current . ':43', $errno, $errstr, 6);
            if (!$socket) {
                return array('ok' => false, 'server' => $current, 'text' => '', 'referrals' => $referrals,
                    'error' => 'Could not reach the WHOIS server ' . $current . ': ' . ($errstr !== '' ? $errstr : ($errno === 110 ? 'connection timed out' : 'connection failed')) . '. Port 43 may be blocked by the hosting network.');
            }
            stream_set_timeout($socket, 8);
            fwrite($socket, $question . "\r\n");
            $text = '';
            while (!feof($socket) && strlen($text) < self::MAX_BYTES) {
                $chunk = fread($socket, 8192);
                if ($chunk === false) {
                    break;
                }
                $text .= $chunk;
            }
            fclose($socket);
            $latency = (int) round((microtime(true) - $started) * 1000);
            if (trim($text) === '') {
                return array('ok' => false, 'server' => $current, 'text' => '', 'referrals' => $referrals,
                    'error' => 'The WHOIS server returned an empty answer.', 'latency_ms' => $latency);
            }
            $referral = $this->referralServer($text);
            if ($referral !== '' && $referral !== $current && $hop < self::MAX_REFERRALS) {
                $referrals[] = array('from' => $current, 'to' => $referral);
                $current = $referral;
                continue;
            }
            return array('ok' => true, 'server' => $current, 'text' => $text, 'error' => '', 'referrals' => $referrals, 'latency_ms' => $latency);
        }
        return array('ok' => false, 'server' => $current, 'text' => '', 'referrals' => $referrals, 'error' => 'Too many WHOIS referrals.');
    }

    /**
     * Entry point for an IP query. IANA's WHOIS answers with the registry that
     * holds the block, and the client follows that referral, so the chain is
     * always resolved from the authoritative source rather than guessed from
     * the first octet.
     */
    public function registryForIp($ip)
    {
        return 'whois.iana.org';
    }

    public function registryForDomain($domain)
    {
        $suffix = substr(strrchr($domain, '.'), 1);
        $iana = $this->query('whois.iana.org', $suffix);
        if ($iana['ok']) {
            $parsed = self::parse($iana['text']);
            if (!empty($parsed['refer']['whois'])) {
                return $parsed['refer']['whois'];
            }
            if (!empty($parsed['whois'])) {
                return $parsed['whois'];
            }
        }
        return '';
    }

    private function referralServer($text)
    {
        if (preg_match('/^\s*(?:ReferralServer|referralserver)\s*:\s*whois:\/\/([a-z0-9.\-]+)/mi', $text, $matches)) {
            return strtolower($matches[1]);
        }
        if (preg_match('/^\s*(?:whois|Whois Server|ReferralServer)\s*:\s*([a-z0-9.\-]+)/mi', $text, $matches)) {
            $candidate = strtolower(trim($matches[1]));
            if ($candidate !== '' && substr_count($candidate, '.') >= 1) {
                return $candidate;
            }
        }
        return '';
    }

    /** Parse the most common keys: the registries use "Key: value" lines. */
    public static function parse($text)
    {
        $fields = array();
        $refer = array();
        foreach (preg_split('/\r?\n/', (string) $text) as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '%' || $line[0] === '#') {
                continue;
            }
            $position = strpos($line, ':');
            if ($position === false) {
                continue;
            }
            $key = strtolower(trim(substr($line, 0, $position)));
            $value = trim(substr($line, $position + 1));
            if ($key === '') {
                continue;
            }
            if ($key === 'refer' || $key === 'referralserver') {
                $refer[$key] = $value;
                continue;
            }
            if (isset($fields[$key])) {
                $fields[$key] .= ' | ' . $value;
            } else {
                $fields[$key] = $value;
            }
        }
        return array_merge($fields, array('refer' => $refer));
    }
}
