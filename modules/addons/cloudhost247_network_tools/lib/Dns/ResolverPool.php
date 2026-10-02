<?php
namespace CloudHost247\NetworkTools\Dns;

use CloudHost247\NetworkTools\Core\Repository\ResolverRepository;

/**
 * Turns the resolver registry into queries.
 *
 * The propagation checker must ask many resolvers the same question without
 * taking one timeout after another, so UDP queries are multiplexed: every
 * resolver gets its own non-blocking socket, all queries are written at once,
 * and responses are collected with a single deadline. A resolver that does not
 * answer inside the deadline is reported as a timeout for that resolver only —
 * the request as a whole still completes.
 *
 * Protocol support is taken from the registry row: a resolver registered as
 * UDP is never queried over TLS, and DoH/DoT rows are used only where the
 * administrator has entered the endpoint they need.
 */
final class ResolverPool
{
    /** @var ResolverRepository */
    private $repository;
    /** @var array */
    private $settings;

    public function __construct(ResolverRepository $repository = null, array $settings = array())
    {
        $this->repository = $repository ?: new ResolverRepository();
        $this->settings = array_merge(array(
            'dns_timeout_seconds' => 5,
            'dns_retries' => 2,
            'propagation_resolver_limit' => 40,
        ), $settings);
    }

    /** Resolvers the propagation checker may use, filtered and capped. */
    public function resolvers($family = 'all', $protocols = array('udp'), $limit = null)
    {
        $rows = $this->repository->all(true, $protocols);
        $limit = $limit === null ? max(1, (int) $this->settings['propagation_resolver_limit']) : max(1, (int) $limit);
        $out = array();
        foreach ($rows as $row) {
            if ($family === 'v4' && $row->version !== 'v4') {
                continue;
            }
            if ($family === 'v6' && $row->version !== 'v6') {
                continue;
            }
            $out[] = $row;
            if (count($out) >= $limit) {
                break;
            }
        }
        return $out;
    }

    public function hasResolvers()
    {
        return count($this->repository->all(true)) > 0;
    }

    public function clientFor($row, array $overrides = array())
    {
        return DnsClient::forResolver((string) $row->ip_address, (string) $row->protocol, (string) $row->endpoint, array_merge(array(
            'timeout' => max(1, min(10, (int) $this->settings['dns_timeout_seconds'])),
            'retries' => 1,
        ), $overrides));
    }

    /** The resolver used when a user did not choose one: system, else first registry row. */
    public function defaultClient(array $overrides = array())
    {
        $rows = $this->repository->all(true, array('udp'));
        $overrides = array_merge(array('timeout' => max(1, min(10, (int) $this->settings['dns_timeout_seconds']))), $overrides);
        if ($rows) {
            return $this->clientFor($rows[0], $overrides);
        }
        return DnsClient::forSystemResolver($overrides);
    }

    public function systemClient(array $overrides = array())
    {
        return DnsClient::forSystemResolver(array_merge(array('timeout' => max(1, min(10, (int) $this->settings['dns_timeout_seconds']))), $overrides));
    }

    /**
     * Ask every UDP resolver the same question, in parallel.
     *
     * @return array<int,array{resolver:object,response:array,latency_ms:int}>
     */
    public function queryUdpMany(array $resolvers, $name, $type)
    {
        $results = array();
        $timeout = max(1, min(10, (int) $this->settings['dns_timeout_seconds']));
        $template = $this->systemClient(array('timeout' => $timeout));
        $typeNumber = DnsClient::types();
        $type = strtoupper((string) $type);
        if (!isset($typeNumber[$type])) {
            return $results;
        }
        $sockets = array();
        $pending = array();
        foreach ($resolvers as $index => $row) {
            $ip = (string) $row->ip_address;
            if ((string) $row->protocol !== 'udp' || filter_var($ip, FILTER_VALIDATE_IP) === false) {
                // Non-UDP protocols run sequentially; there are few of them and
                // they are TLS-based, so multiplexing would add no benefit.
                $client = $this->clientFor($row);
                $response = $client->query($name, $type);
                $results[] = array('resolver' => $row, 'response' => $response, 'latency_ms' => (int) $response['latency_ms']);
                continue;
            }
            $host = strpos($ip, ':') !== false ? '[' . $ip . ']' : $ip;
            $socket = @stream_socket_client('udp://' . $host . ':53', $errno, $errstr, $timeout);
            if (!$socket) {
                $results[] = array('resolver' => $row, 'response' => array(
                    'ok' => false, 'code' => 'DNS_LOOKUP_FAILED', 'error' => 'Could not open a UDP socket to this resolver.',
                    'records' => array(), 'latency_ms' => 0, 'resolver' => $ip, 'protocol' => 'udp',
                ), 'latency_ms' => 0);
                continue;
            }
            stream_set_blocking($socket, false);
            $id = random_int(1, 0xffff);
            while (isset($pending[$id])) {
                $id = random_int(1, 0xffff);
            }
            $packet = $template->buildQuery($name, $typeNumber[$type], true, true);
            $packet = pack('n', $id) . substr($packet, 2); // use our id so responses can be matched
            @fwrite($socket, $packet);
            $sockets[] = $socket;
            $pending[$id] = array('index' => $index, 'resolver' => $row, 'started' => microtime(true));
        }
        $deadline = microtime(true) + $timeout;
        while ($sockets && microtime(true) < $deadline) {
            $read = $sockets;
            $write = null;
            $except = null;
            $remaining = $deadline - microtime(true);
            if ($remaining <= 0) {
                break;
            }
            $seconds = (int) floor($remaining);
            $microseconds = (int) (($remaining - $seconds) * 1000000);
            $ready = @stream_select($read, $write, $except, $seconds, $microseconds);
            if ($ready === false || $ready === 0) {
                continue;
            }
            foreach ($read as $socket) {
                $data = @fread($socket, DnsClient::MAX_UDP_PACKET);
                $latency = 0;
                $id = 0;
                if (is_string($data) && strlen($data) >= 12) {
                    $id = unpack('n', substr($data, 0, 2))[1];
                }
                if ($id !== 0 && isset($pending[$id])) {
                    $entry = $pending[$id];
                    $latency = (int) round((microtime(true) - $entry['started']) * 1000);
                    $parsed = $template->parse($data);
                    $rcode = $parsed['ok'] ? (int) $parsed['rcode'] : -1;
                    $results[] = array('resolver' => $entry['resolver'], 'latency_ms' => $latency, 'response' => array(
                        'ok' => $parsed['ok'] && $rcode === 0,
                        'code' => !$parsed['ok'] ? 'DNS_LOOKUP_FAILED' : ($rcode === 0 ? 'OK' : ($rcode === 3 ? 'DOMAIN_NOT_FOUND' : 'DNS_LOOKUP_FAILED')),
                        'error' => $parsed['ok'] ? ($rcode === 0 ? '' : $template->rcodeText($rcode)) : $parsed['error'],
                        'rcode' => $rcode,
                        'records' => $parsed['ok'] ? $parsed['answers'] : array(),
                        'authority' => $parsed['ok'] ? $parsed['authority'] : array(),
                        'latency_ms' => $latency,
                        'resolver' => (string) $entry['resolver']->ip_address,
                        'protocol' => 'udp',
                        'authenticated' => !empty($parsed['authenticated']),
                    ));
                    unset($pending[$id]);
                }
                @fclose($socket);
                $sockets = array_values(array_filter($sockets, function ($candidate) use ($socket) {
                    return $candidate !== $socket;
                }));
            }
        }
        // Whatever is left never answered inside the deadline.
        foreach ($sockets as $socket) {
            @fclose($socket);
        }
        foreach ($pending as $entry) {
            $results[] = array('resolver' => $entry['resolver'], 'latency_ms' => $timeout * 1000, 'response' => array(
                'ok' => false, 'code' => 'TIMEOUT', 'error' => 'The resolver did not answer within ' . $timeout . ' seconds.',
                'records' => array(), 'rcode' => -1, 'latency_ms' => $timeout * 1000,
                'resolver' => (string) $entry['resolver']->ip_address, 'protocol' => 'udp', 'authenticated' => false,
            ));
        }
        return $results;
    }

    /**
     * Follow a CNAME chain for A/AAAA lookups.
     *
     * @return array{chain:array,response:array,depth:int,error:string}
     */
    public function resolveChain($name, $type, DnsClient $client, $maxDepth = 8)
    {
        $chain = array();
        $current = $name;
        for ($depth = 0; $depth < $maxDepth; $depth++) {
            $response = $client->query($current, $type);
            if (!$response['ok']) {
                // A CNAME answer with no address of the requested type still
                // tells us where to look next.
                if (in_array($type, array('A', 'AAAA'), true)) {
                    $cnames = DnsClient::values($response['records'], 'CNAME');
                    if ($cnames) {
                        $chain[] = array('name' => $current, 'cname' => $cnames[0]);
                        $current = $cnames[0];
                        continue;
                    }
                }
                return array('chain' => $chain, 'response' => $response, 'depth' => $depth, 'error' => $response['error']);
            }
            $values = DnsClient::values($response['records'], $type);
            if ($values) {
                return array('chain' => $chain, 'response' => $response, 'depth' => $depth, 'error' => '');
            }
            $cnames = DnsClient::values($response['records'], 'CNAME');
            if (!$cnames) {
                return array('chain' => $chain, 'response' => $response, 'depth' => $depth, 'error' => 'No ' . $type . ' record was returned.');
            }
            $chain[] = array('name' => $current, 'cname' => $cnames[0]);
            $current = $cnames[0];
        }
        return array('chain' => $chain, 'response' => array('ok' => false, 'records' => array(), 'error' => 'The CNAME chain was longer than ' . $maxDepth . ' hops.'), 'depth' => $maxDepth, 'error' => 'CNAME chain too long');
    }
}
