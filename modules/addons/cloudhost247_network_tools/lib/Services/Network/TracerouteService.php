<?php
namespace CloudHost247\NetworkTools\Services\Network;

use CloudHost247\NetworkTools\Core\Result\Capability;
use CloudHost247\NetworkTools\Core\Result\ErrorCode;
use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Core\Security\SsrfGuard;
use CloudHost247\NetworkTools\Services\Service;

/**
 * Traceroute (docs section 25).
 *
 * Implemented with raw ICMP sockets and an incrementing IP TTL. When the
 * environment does not grant raw sockets — the normal case on cPanel shared
 * hosting — the tool reports UNAVAILABLE_IN_THIS_ENVIRONMENT with the reason.
 * It never shells out to `traceroute` or `mtr`, and it never invents a path.
 */
final class TracerouteService extends Service
{
    protected function execute()
    {
        $target = $this->input['target'];
        $maxHops = isset($this->input['max_hops']) ? (int) $this->input['max_hops'] : 15;
        $maxHops = max(1, min(20, $maxHops));
        if (!function_exists('socket_create') || !defined('SOCK_RAW') || !defined('IP_TTL') || !defined('IPPROTO_ICMP')) {
            return ToolResult::failure(ErrorCode::CAPABILITY_UNAVAILABLE,
                'Traceroute needs raw ICMP sockets, which this hosting environment does not provide. ' . Capability::detail('raw_icmp'),
                array('capability' => 'raw_icmp', 'capability_state' => Capability::UNAVAILABLE, 'system_binary_used' => false));
        }
        $verdict = SsrfGuard::validateHost($target);
        if (!$verdict['ok']) {
            return ToolResult::failure($verdict['code'], $verdict['message']);
        }
        $address = $verdict['addresses'][0];
        if (strpos($address, ':') !== false) {
            return ToolResult::failure(ErrorCode::CAPABILITY_UNAVAILABLE, 'IPv6 traceroute requires ICMPv6 raw sockets with checksum handling, which is not available here. IPv4 targets are supported.', array('capability' => 'raw_icmp'));
        }
        $socket = @socket_create(AF_INET, SOCK_RAW, IPPROTO_ICMP);
        if (!$socket) {
            return ToolResult::failure(ErrorCode::CAPABILITY_UNAVAILABLE, 'The PHP process is not permitted to create raw ICMP sockets on this host.', array('capability' => 'raw_icmp'));
        }
        socket_set_option($socket, SOL_SOCKET, SO_RCVTIMEO, array('sec' => 2, 'usec' => 0));
        $hops = array();
        $reached = false;
        for ($ttl = 1; $ttl <= $maxHops; $ttl++) {
            socket_set_option($socket, IPPROTO_IP, IP_TTL, $ttl);
            $identifier = random_int(1, 0xffff);
            $packet = pack('CCnnn', 8, 0, 0, $identifier, $ttl) . 'CloudHost247';
            $checksum = $this->checksum($packet);
            $packet = substr_replace($packet, pack('n', $checksum), 2, 2);
            $started = microtime(true);
            @socket_sendto($socket, $packet, strlen($packet), 0, $address, 0);
            $buffer = '';
            $from = '';
            $port = 0;
            $answered = @socket_recvfrom($socket, $buffer, 1500, 0, $from, $port);
            $elapsed = round((microtime(true) - $started) * 1000, 2);
            $hostname = '';
            if ($from !== '') {
                $reverse = \CloudHost247\NetworkTools\Dns\ReverseName::forIp($from);
                if ($reverse !== null) {
                    $response = $this->querySystem($reverse, 'PTR');
                    if ($response['ok']) {
                        $names = \CloudHost247\NetworkTools\Dns\DnsClient::values($response['records'], 'PTR');
                        $hostname = $names ? $names[0] : '';
                    }
                }
            }
            if ($answered === false || $answered === 0 || $from === '') {
                $hops[] = array('hop' => $ttl, 'ip' => '', 'hostname' => '', 'latency_ms' => null, 'status' => 'TIMEOUT', 'note' => 'No answer for this hop (common: the router does not send ICMP time-exceeded).');
                continue;
            }
            $hops[] = array('hop' => $ttl, 'ip' => $from, 'hostname' => $hostname, 'latency_ms' => $elapsed, 'status' => 'OK', 'note' => '');
            if ($from === $address) {
                $reached = true;
                break;
            }
        }
        socket_close($socket);
        return ToolResult::success(array(
            'target' => $target,
            'resolved_address' => $address,
            'max_hops' => $maxHops,
            'hops' => $hops,
            'reached_target' => $reached,
            'summary' => $reached ? 'Path traced to the target in ' . count($hops) . ' hop(s).' : 'Path traced for ' . count($hops) . ' hop(s) without reaching the target (the limit was ' . $maxHops . ').',
            'explanation' => 'Each hop is one router that returned an ICMP time-exceeded message. Hops that stay silent are shown as timeouts; paths change with routing and load, so a trace is a snapshot.',
        ), array('Traceroute is bounded to ' . $maxHops . ' hops and runs only when this environment permits raw sockets.'), array('capability' => Capability::AVAILABLE));
    }

    private function checksum($data)
    {
        $length = strlen($data);
        $sum = 0;
        for ($i = 0; $i + 1 < $length; $i += 2) {
            $sum += unpack('n', substr($data, $i, 2))[1];
        }
        if ($length % 2 === 1) {
            $sum += ord($data[$length - 1]) << 8;
        }
        $sum = ($sum >> 16) + ($sum & 0xffff);
        $sum += $sum >> 16;
        return ~$sum & 0xffff;
    }
}
