<?php
namespace CloudHost247\NetworkTools\Dns;

use CloudHost247\NetworkTools\Core\Result\ErrorCode;

/**
 * DNS wire client (RFC 1035 + RFC 6891 EDNS0 + RFC 3596/6844/4034/2782/6845).
 *
 * Written because the platform must be able to query a *chosen* resolver (the
 * propagation checker and the resolver health monitor both depend on that), and
 * because a deployment on cPanel shared hosting cannot assume `dig` is
 * available. Nothing is shelled out: packets are built and parsed in PHP.
 *
 * Properties that matter for correctness and safety:
 *  - the wire parser is bounds-checked at every read; a malformed, truncated or
 *    hostile packet produces an error result, never a PHP warning or a
 *    fabricated record;
 *  - name compression is followed with a hop counter, so a pointer loop cannot
 *    hang a request;
 *  - TCP (with a 2-byte length prefix) is used when a UDP answer sets TC, and
 *    for large answers (DNSSEC, long TXT);
 *  - DNS-over-TLS and DNS-over-HTTPS are supported only for resolvers whose
 *    registry row says so, and DoH goes through the SSRF-guarded fetcher;
 *  - every failure is classified with the module's ErrorCode vocabulary.
 */
final class DnsClient
{
    const MAX_UDP_PACKET = 4096;      // EDNS0 advertised buffer size
    const MAX_TCP_PACKET = 65535;
    const CLASS_IN = 1;
    const MAX_COMPRESSION_HOPS = 32;

    /** Supported record types (docs sections 4 and 5). */
    public static function types()
    {
        return array(
            'A' => 1, 'NS' => 2, 'CNAME' => 5, 'SOA' => 6, 'PTR' => 12, 'MX' => 15, 'TXT' => 16,
            'AAAA' => 28, 'SRV' => 33, 'NAPTR' => 35, 'CAA' => 257, 'DS' => 43, 'DNSKEY' => 48,
            'RRSIG' => 46, 'NSEC' => 47, 'TLSA' => 52, 'ANY' => 255,
        );
    }

    public static function isSupportedType($type)
    {
        $types = self::types();
        return isset($types[strtoupper((string) $type)]);
    }

    /** @var array query options for this instance */
    private $options;

    public function __construct(array $options = array())
    {
        $this->options = array_merge(array(
            'resolver' => '',          // resolver IP (v4 or v6)
            'protocol' => 'udp',       // udp | tcp | dot | doh
            'endpoint' => '',          // DoT hostname or DoH URL
            'port' => 0,
            'timeout' => 5,
            'retries' => 1,
            'edns' => true,
            'recursion' => true,
            'fetcher' => null,         // Core\Http\HttpFetcher for DoH
        ), $options);
    }

    public static function forResolver($ip, $protocol = 'udp', $endpoint = '', array $overrides = array())
    {
        return new self(array_merge(array('resolver' => $ip, 'protocol' => $protocol, 'endpoint' => $endpoint), $overrides));
    }

    /**
     * Resolver used when no specific server is required: the first nameserver
     * from /etc/resolv.conf, else the system resolver through PHP.
     */
    public static function forSystemResolver(array $overrides = array())
    {
        $server = '';
        if (is_readable('/etc/resolv.conf')) {
            $contents = @file_get_contents('/etc/resolv.conf');
            if (is_string($contents) && preg_match('/^\s*nameserver\s+([0-9a-fA-F:.%]+)/m', $contents, $matches)) {
                $candidate = trim($matches[1]);
                if (filter_var($candidate, FILTER_VALIDATE_IP) !== false) {
                    $server = $candidate;
                }
            }
        }
        return new self(array_merge(array('resolver' => $server, 'protocol' => 'udp'), $overrides));
    }

    public function options()
    {
        return $this->options;
    }

    public function protocol()
    {
        return (string) $this->options['protocol'];
    }

    public function resolverLabel()
    {
        $resolver = (string) $this->options['resolver'];
        if ($resolver === '') {
            return 'system resolver';
        }
        return $resolver;
    }

    /**
     * Query one name/type.
     *
     * @return array{ok:bool,code:string,error:string,rcode:int,records:array,authority:array,
     *               latency_ms:int,resolver:string,protocol:string,truncated:bool,authenticated:bool}
     */
    public function query($name, $type, array $overrides = array())
    {
        $options = array_merge($this->options, $overrides);
        $type = strtoupper((string) $type);
        $types = self::types();
        if (!isset($types[$type])) {
            return $this->failure(ErrorCode::INVALID_INPUT, 'Unsupported record type: ' . $type, 0);
        }
        $name = $this->normaliseName($name);
        if ($name === null) {
            return $this->failure(ErrorCode::INVALID_INPUT, 'The query name is not a valid DNS name.', 0);
        }
        $attempts = max(1, min(3, (int) $options['retries']));
        $lastFailure = null;
        for ($attempt = 0; $attempt < $attempts; $attempt++) {
            $result = $this->attempt($name, $type, $types[$type], $options);
            if ($result['ok'] || !in_array($result['code'], array(ErrorCode::TIMEOUT, ErrorCode::DNS_LOOKUP_FAILED), true)) {
                return $result;
            }
            $lastFailure = $result;
        }
        return $lastFailure !== null ? $lastFailure : $this->failure(ErrorCode::DNS_LOOKUP_FAILED, 'The lookup did not complete.', 0);
    }

    private function attempt($name, $type, $typeNumber, array $options)
    {
        $protocol = strtolower((string) $options['protocol']);
        $started = microtime(true);
        try {
            if ($protocol === 'doh') {
                $response = $this->queryDoh($name, $type, $typeNumber, $options);
            } elseif ($protocol === 'dot') {
                $response = $this->queryStream($name, $type, $typeNumber, $options, true);
            } elseif ($protocol === 'tcp') {
                $response = $this->queryStream($name, $type, $typeNumber, $options, false);
            } else {
                $response = $this->queryUdp($name, $type, $typeNumber, $options);
            }
        } catch (\Throwable $failure) {
            return $this->failure(ErrorCode::DNS_LOOKUP_FAILED, 'The resolver query failed.', $this->elapsed($started));
        }
        $latency = $this->elapsed($started);
        if (!$response['ok']) {
            return $this->failure($response['code'], $response['error'], $latency, $options);
        }
        $parsed = $this->parse($response['packet']);
        if (!$parsed['ok']) {
            return $this->failure(ErrorCode::DNS_LOOKUP_FAILED, $parsed['error'], $latency, $options);
        }
        if (!empty($parsed['truncated']) && $protocol === 'udp') {
            $fallback = $this->queryStream($name, $type, $typeNumber, $options, false);
            if ($fallback['ok']) {
                $parsed = $this->parse($fallback['packet']);
                if (!$parsed['ok']) {
                    return $this->failure(ErrorCode::DNS_LOOKUP_FAILED, $parsed['error'], $latency, $options);
                }
            }
        }
        $rcode = (int) $parsed['rcode'];
        $code = $rcode === 0 ? ErrorCode::OK : ($rcode === 3 ? ErrorCode::DOMAIN_NOT_FOUND : ErrorCode::DNS_LOOKUP_FAILED);
        return array(
            'ok' => $rcode === 0,
            'code' => $code,
            'error' => $rcode === 0 ? '' : $this->rcodeText($rcode),
            'rcode' => $rcode,
            'records' => $parsed['answers'],
            'authority' => $parsed['authority'],
            'additional' => $parsed['additional'],
            'latency_ms' => $latency,
            'resolver' => (string) $options['resolver'],
            'protocol' => $protocol,
            'truncated' => !empty($parsed['truncated']),
            'authenticated' => !empty($parsed['authenticated']),
            'response_bytes' => strlen($response['packet']),
        );
    }

    /** Values of one record type as plain strings, for text comparisons. */
    public static function values(array $records, $type = null)
    {
        $values = array();
        foreach ($records as $record) {
            if ($type !== null && strcasecmp($record['type'], (string) $type) !== 0) {
                continue;
            }
            $values[] = isset($record['value']) ? (string) $record['value'] : '';
        }
        return array_values(array_filter($values, 'strlen'));
    }

    public function queryUdp($name, $type, $typeNumber, array $options)
    {
        $resolver = (string) $options['resolver'];
        if ($resolver === '') {
            return $this->packetFailure(ErrorCode::CONFIGURATION_REQUIRED, 'No resolver address is configured for this query.');
        }
        if (filter_var($resolver, FILTER_VALIDATE_IP) === false) {
            return $this->packetFailure(ErrorCode::INVALID_INPUT, 'The resolver address is not a valid IP.');
        }
        $port = $options['port'] ? (int) $options['port'] : 53;
        $host = strpos($resolver, ':') !== false ? '[' . $resolver . ']' : $resolver;
        $packet = $this->buildQuery($name, $typeNumber, !empty($options['edns']), !empty($options['recursion']));
        $socket = @stream_socket_client('udp://' . $host . ':' . $port, $errno, $errstr, (float) $options['timeout']);
        if (!$socket) {
            return $this->packetFailure(ErrorCode::DNS_LOOKUP_FAILED, 'Could not open a UDP socket to the resolver: ' . $errstr);
        }
        stream_set_timeout($socket, (int) $options['timeout']);
        fwrite($socket, $packet);
        $response = fread($socket, self::MAX_UDP_PACKET);
        $meta = stream_get_meta_data($socket);
        fclose($socket);
        if ($response === false || $response === '') {
            return $this->packetFailure(
                !empty($meta['timed_out']) ? ErrorCode::TIMEOUT : ErrorCode::DNS_LOOKUP_FAILED,
                !empty($meta['timed_out']) ? 'The resolver did not answer within the timeout.' : 'The resolver returned no data.'
            );
        }
        return array('ok' => true, 'code' => ErrorCode::OK, 'error' => '', 'packet' => $response);
    }

    public function queryStream($name, $type, $typeNumber, array $options, $tls)
    {
        $resolver = (string) $options['resolver'];
        $endpoint = (string) $options['endpoint'];
        if ($tls) {
            if ($endpoint === '') {
                return $this->packetFailure(ErrorCode::CONFIGURATION_REQUIRED, 'DNS-over-TLS needs the resolver hostname in the registry row.');
            }
            $target = 'tls://' . $endpoint . ':' . ($options['port'] ? (int) $options['port'] : 853);
        } else {
            if ($resolver === '') {
                return $this->packetFailure(ErrorCode::CONFIGURATION_REQUIRED, 'No resolver address is configured for this query.');
            }
            $host = strpos($resolver, ':') !== false ? '[' . $resolver . ']' : $resolver;
            $target = 'tcp://' . $host . ':' . ($options['port'] ? (int) $options['port'] : 53);
        }
        $context = stream_context_create(array('ssl' => array(
            'verify_peer' => true, 'verify_peer_name' => true, 'allow_self_signed' => false, 'SNI_enabled' => true,
        )));
        $socket = @stream_socket_client($target, $errno, $errstr, (float) $options['timeout'], STREAM_CLIENT_CONNECT, $context);
        if (!$socket) {
            return $this->packetFailure(ErrorCode::DNS_LOOKUP_FAILED, 'Could not connect to the resolver: ' . $errstr);
        }
        stream_set_timeout($socket, (int) $options['timeout']);
        $packet = $this->buildQuery($name, $typeNumber, !empty($options['edns']), !empty($options['recursion']));
        fwrite($socket, pack('n', strlen($packet)) . $packet);
        $lengthData = $this->readExactly($socket, 2);
        if ($lengthData === null) {
            fclose($socket);
            return $this->packetFailure(ErrorCode::TIMEOUT, 'The resolver did not answer within the timeout.');
        }
        $length = unpack('n', $lengthData)[1];
        if ($length < 12 || $length > self::MAX_TCP_PACKET) {
            fclose($socket);
            return $this->packetFailure(ErrorCode::DNS_LOOKUP_FAILED, 'The resolver returned an invalid message length.');
        }
        $response = $this->readExactly($socket, $length);
        fclose($socket);
        if ($response === null) {
            return $this->packetFailure(ErrorCode::TIMEOUT, 'The resolver response was incomplete.');
        }
        return array('ok' => true, 'code' => ErrorCode::OK, 'error' => '', 'packet' => $response);
    }

    public function queryDoh($name, $type, $typeNumber, array $options)
    {
        $endpoint = (string) $options['endpoint'];
        if ($endpoint === '' || strpos($endpoint, 'https://') !== 0) {
            return $this->packetFailure(ErrorCode::CONFIGURATION_REQUIRED, 'DNS-over-HTTPS needs the resolver HTTPS endpoint in the registry row.');
        }
        if (!class_exists('CloudHost247\\NetworkTools\\Core\\Http\\HttpFetcher')) {
            return $this->packetFailure(ErrorCode::SERVICE_UNAVAILABLE, 'The HTTP fetcher is not available.');
        }
        $fetcher = $options['fetcher'] instanceof \CloudHost247\NetworkTools\Core\Http\HttpFetcher
            ? $options['fetcher'] : new \CloudHost247\NetworkTools\Core\Http\HttpFetcher();
        $packet = $this->buildQuery($name, $typeNumber, !empty($options['edns']), !empty($options['recursion']));
        $response = $fetcher->request('POST', $endpoint, array(
            'Content-Type: application/dns-message',
            'Accept: application/dns-message',
        ), $packet, array('timeout' => (int) $options['timeout'], 'max_bytes' => 65535));
        if (!is_array($response) || empty($response['ok'])) {
            $code = isset($response['code']) ? $response['code'] : ErrorCode::PROVIDER_ERROR;
            return $this->packetFailure($code, isset($response['message']) ? $response['message'] : 'The DNS-over-HTTPS endpoint did not answer.');
        }
        if ((int) $response['status'] !== 200) {
            return $this->packetFailure(ErrorCode::PROVIDER_ERROR, 'The DNS-over-HTTPS endpoint returned HTTP ' . (int) $response['status'] . '.');
        }
        return array('ok' => true, 'code' => ErrorCode::OK, 'error' => '', 'packet' => (string) $response['body']);
    }

    /**
     * Build one query packet: header + question [+ EDNS0 OPT record].
     */
    public function buildQuery($name, $typeNumber, $edns = true, $recursion = true)
    {
        $labels = explode('.', rtrim($name, '.'));
        $question = '';
        foreach ($labels as $label) {
            $question .= chr(strlen($label)) . $label;
        }
        $question .= "\x00" . pack('nn', $typeNumber & 0xffff, self::CLASS_IN);
        $flags = $recursion ? 0x0100 : 0x0000;
        $header = pack('nnnnnn', random_int(0, 0xffff), $flags, 1, 0, 0, $edns ? 1 : 0);
        $additional = '';
        if ($edns) {
            // OPT: root name, type 41, class = UDP payload size, TTL = ext rcode/version/flags, no data.
            $additional = "\x00" . pack('nnNn', 41, self::MAX_UDP_PACKET, 0, 0);
        }
        return $header . $question . $additional;
    }

    /**
     * Parse a DNS message into answer/authority/additional records.
     *
     * @return array{ok:bool,error:string,rcode:int,answers:array,authority:array,additional:array,truncated:bool,authenticated:bool}
     */
    public function parse($packet)
    {
        $length = strlen($packet);
        if ($length < 12) {
            return array('ok' => false, 'error' => 'The DNS response was shorter than a header.', 'rcode' => -1, 'answers' => array(), 'authority' => array(), 'additional' => array(), 'truncated' => false, 'authenticated' => false);
        }
        $header = unpack('nid/nflags/nqd/nan/nns/nar', substr($packet, 0, 12));
        $rcode = $header['flags'] & 0x000f;
        $truncated = (bool) ($header['flags'] & 0x0200);
        $authenticated = (bool) ($header['flags'] & 0x0020);
        $offset = 12;
        for ($i = 0; $i < $header['qd']; $i++) {
            $questionName = $this->readName($packet, $offset);
            if ($questionName === null || $offset + 4 > $length) {
                return array('ok' => false, 'error' => 'The DNS question section was malformed.', 'rcode' => -1, 'answers' => array(), 'authority' => array(), 'additional' => array(), 'truncated' => $truncated, 'authenticated' => $authenticated);
            }
            $offset += 4;
        }
        $sections = array('answers' => $header['an'], 'authority' => $header['ns'], 'additional' => $header['ar']);
        $parsed = array('answers' => array(), 'authority' => array(), 'additional' => array());
        foreach ($sections as $section => $count) {
            for ($i = 0; $i < $count; $i++) {
                $record = $this->readRecord($packet, $offset);
                if ($record === null) {
                    // A malformed record ends parsing: the records already read
                    // are real, so they are returned with the section shortened.
                    break 2;
                }
                $parsed[$section][] = $record;
            }
        }
        // Strip the EDNS0 OPT pseudo-record; it is transport metadata, not data.
        $parsed['additional'] = array_values(array_filter($parsed['additional'], function ($record) {
            return $record['type'] !== 'OPT';
        }));
        return array(
            'ok' => true, 'error' => '', 'rcode' => $rcode,
            'answers' => $parsed['answers'], 'authority' => $parsed['authority'], 'additional' => $parsed['additional'],
            'truncated' => $truncated, 'authenticated' => $authenticated,
        );
    }

    /** Read a (possibly compressed) domain name. Returns null on malformed input. */
    private function readName($packet, &$offset, $depth = 0)
    {
        if ($depth > self::MAX_COMPRESSION_HOPS) {
            return null;
        }
        $length = strlen($packet);
        $labels = array();
        $position = $offset;
        $jumped = false;
        $hops = 0;
        while (true) {
            if ($position >= $length) {
                return null;
            }
            $labelLength = ord($packet[$position]);
            if ($labelLength === 0) {
                $position++;
                if (!$jumped) {
                    $offset = $position;
                }
                return $labels ? implode('.', $labels) : '.';
            }
            if (($labelLength & 0xc0) === 0xc0) {
                if ($position + 1 >= $length) {
                    return null;
                }
                $pointer = (($labelLength & 0x3f) << 8) | ord($packet[$position + 1]);
                if ($pointer >= $length || $pointer === $position) {
                    return null;
                }
                if (!$jumped) {
                    $offset = $position + 2;
                    $jumped = true;
                }
                $position = $pointer;
                if (++$hops > self::MAX_COMPRESSION_HOPS) {
                    return null;
                }
                continue;
            }
            if (($labelLength & 0xc0) !== 0 || $labelLength > 63) {
                return null;
            }
            if ($position + 1 + $labelLength > $length) {
                return null;
            }
            $labels[] = substr($packet, $position + 1, $labelLength);
            $position += 1 + $labelLength;
        }
    }

    private function readRecord($packet, &$offset)
    {
        $length = strlen($packet);
        $name = $this->readName($packet, $offset);
        if ($name === null || $offset + 10 > $length) {
            return null;
        }
        $fields = unpack('ntype/nclass/Nttl/nrdlength', substr($packet, $offset, 10));
        $offset += 10;
        $rdLength = $fields['rdlength'];
        if ($offset + $rdLength > $length) {
            return null;
        }
        $rdataStart = $offset;
        $rdata = substr($packet, $offset, $rdLength);
        $offset += $rdLength;
        $type = $this->typeName($fields['type']);
        $record = array(
            'name' => $name,
            'type' => $type,
            'ttl' => (int) $fields['ttl'],
            'class' => (int) $fields['class'],
            'value' => '',
            'raw' => bin2hex($rdata),
        );
        $cursor = $rdataStart;
        switch ($type) {
            case 'A':
            case 'AAAA':
                $address = @inet_ntop($rdata);
                $record['value'] = $address === false ? '' : $address;
                if ($record['value'] === '') {
                    return null;
                }
                break;
            case 'CNAME':
            case 'NS':
            case 'PTR':
                $target = $this->readName($packet, $cursor);
                if ($target === null || $cursor > $rdataStart + $rdLength) {
                    return null;
                }
                $record['value'] = $target;
                break;
            case 'MX':
                if (strlen($rdata) < 3) {
                    return null;
                }
                $record['priority'] = unpack('n', substr($rdata, 0, 2))[1];
                $exchange = $this->readName($packet, $cursor);
                if ($exchange === null) {
                    return null;
                }
                $record['target'] = $exchange;
                $record['value'] = $exchange;
                break;
            case 'TXT':
                $strings = array();
                $position = 0;
                while ($position < strlen($rdata)) {
                    $chunkLength = ord($rdata[$position]);
                    $position++;
                    if ($position + $chunkLength > strlen($rdata)) {
                        return null;
                    }
                    $strings[] = substr($rdata, $position, $chunkLength);
                    $position += $chunkLength;
                }
                $record['value'] = implode('', $strings);
                $record['strings'] = $strings;
                break;
            case 'SOA':
                $primary = $this->readName($packet, $cursor);
                $responsible = $this->readName($packet, $cursor);
                if ($primary === null || $responsible === null || $cursor + 20 > $length) {
                    return null;
                }
                $numbers = unpack('Nserial/Nrefresh/Nretry/Nexpire/Nminimum', substr($packet, $cursor, 20));
                $record = array_merge($record, $numbers, array(
                    'primary' => $primary, 'responsible' => $responsible,
                    'value' => $primary . ' ' . $responsible . ' ' . $numbers['serial'],
                ));
                break;
            case 'SRV':
                if (strlen($rdata) < 7) {
                    return null;
                }
                $parts = unpack('npriority/nweight/nport', substr($rdata, 0, 6));
                $target = $this->readName($packet, $cursor);
                if ($target === null) {
                    return null;
                }
                $record = array_merge($record, $parts, array('target' => $target, 'value' => $target, 'priority' => $parts['priority']));
                break;
            case 'CAA':
                if (strlen($rdata) < 2) {
                    return null;
                }
                $flags = ord($rdata[0]);
                $tagLength = ord($rdata[1]);
                if (2 + $tagLength > strlen($rdata)) {
                    return null;
                }
                $tag = substr($rdata, 2, $tagLength);
                $value = substr($rdata, 2 + $tagLength);
                $record['flags'] = $flags;
                $record['tag'] = $tag;
                $record['value'] = $flags . ' ' . $tag . ' "' . $value . '"';
                $record['caa_tag'] = $tag;
                $record['caa_value'] = $value;
                break;
            case 'DS':
                if (strlen($rdata) < 4) {
                    return null;
                }
                $ds = unpack('nkeytag/calgorithm/cdigesttype', substr($rdata, 0, 4));
                $record['key_tag'] = $ds['keytag'];
                $record['algorithm'] = $ds['algorithm'];
                $record['digest_type'] = $ds['digesttype'];
                $record['digest'] = strtoupper(bin2hex(substr($rdata, 4)));
                $record['value'] = $ds['keytag'] . ' ' . $ds['algorithm'] . ' ' . $ds['digesttype'] . ' ' . $record['digest'];
                break;
            case 'DNSKEY':
                if (strlen($rdata) < 4) {
                    return null;
                }
                $dnskey = unpack('nflags/cprotocol/calgorithm', substr($rdata, 0, 4));
                $record['flags'] = $dnskey['flags'];
                $record['protocol'] = $dnskey['protocol'];
                $record['algorithm'] = $dnskey['algorithm'];
                $record['public_key'] = base64_encode(substr($rdata, 4));
                $record['key_tag'] = $this->dnskeyTag($rdata);
                $record['value'] = $dnskey['flags'] . ' ' . $dnskey['protocol'] . ' ' . $dnskey['algorithm'] . ' ' . $record['public_key'];
                break;
            case 'RRSIG':
                $record['value'] = strtoupper(bin2hex($rdata));
                break;
            case 'NAPTR':
                $record['value'] = bin2hex($rdata);
                break;
            case 'TLSA':
                $record['value'] = strtoupper(bin2hex($rdata));
                break;
            case 'OPT':
                $record['value'] = 'EDNS0';
                $record['udp_size'] = (int) $fields['class'];
                break;
            default:
                $record['value'] = bin2hex($rdata);
                break;
        }
        return $record;
    }

    /** RFC 4034 appendix B key tag over the DNSKEY RDATA. */
    public function dnskeyTag($rdata)
    {
        $length = strlen($rdata);
        $sum = 0;
        for ($i = 0; $i < $length; $i++) {
            $sum += ($i & 1) ? ord($rdata[$i]) : (ord($rdata[$i]) << 8);
        }
        $sum += ($sum >> 16) & 0xffff;
        return $sum & 0xffff;
    }

    public function typeName($number)
    {
        static $names = array(
            1 => 'A', 2 => 'NS', 5 => 'CNAME', 6 => 'SOA', 12 => 'PTR', 15 => 'MX', 16 => 'TXT', 28 => 'AAAA',
            33 => 'SRV', 35 => 'NAPTR', 41 => 'OPT', 43 => 'DS', 46 => 'RRSIG', 47 => 'NSEC', 48 => 'DNSKEY', 52 => 'TLSA', 257 => 'CAA',
        );
        return isset($names[$number]) ? $names[$number] : ('TYPE' . (int) $number);
    }

    public function rcodeText($rcode)
    {
        $codes = array(
            0 => 'No error', 1 => 'Format error', 2 => 'Server failure', 3 => 'Non-existent domain (NXDOMAIN)',
            4 => 'Not implemented', 5 => 'Query refused', 6 => 'Name exists but no data of that type (YXXDOMAIN)',
            9 => 'The resolver is not authoritative for this zone', 10 => 'Name is not inside the zone',
        );
        return isset($codes[$rcode]) ? $codes[$rcode] : 'Resolver returned RCODE ' . (int) $rcode;
    }

    public function normaliseName($name)
    {
        $name = strtolower(trim((string) $name));
        $name = rtrim($name, '.');
        if ($name === '' || strlen($name) > 253) {
            return null;
        }
        if (preg_match('/[^a-z0-9._\-]/', $name)) {
            return null;
        }
        $labels = explode('.', $name);
        foreach ($labels as $label) {
            if ($label === '' || strlen($label) > 63) {
                return null;
            }
        }
        return $name;
    }

    private function readExactly($socket, $bytes)
    {
        $buffer = '';
        while (strlen($buffer) < $bytes) {
            $chunk = fread($socket, $bytes - strlen($buffer));
            if ($chunk === false || $chunk === '') {
                $meta = stream_get_meta_data($socket);
                return null;
            }
            $buffer .= $chunk;
        }
        return $buffer;
    }

    private function elapsed($started)
    {
        return (int) round((microtime(true) - $started) * 1000);
    }

    private function failure($code, $error, $latency, array $options = array())
    {
        return array(
            'ok' => false, 'code' => $code, 'error' => (string) $error, 'rcode' => -1,
            'records' => array(), 'authority' => array(), 'additional' => array(),
            'latency_ms' => (int) $latency, 'resolver' => isset($options['resolver']) ? (string) $options['resolver'] : '',
            'protocol' => isset($options['protocol']) ? (string) $options['protocol'] : 'udp',
            'truncated' => false, 'authenticated' => false, 'response_bytes' => 0,
        );
    }

    private function packetFailure($code, $error)
    {
        return array('ok' => false, 'code' => $code, 'error' => (string) $error, 'packet' => '');
    }
}
