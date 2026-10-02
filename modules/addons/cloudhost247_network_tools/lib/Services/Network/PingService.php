<?php
namespace CloudHost247\NetworkTools\Services\Network;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Core\Security\SsrfGuard;
use CloudHost247\NetworkTools\Core\Security\TargetValidator;
use CloudHost247\NetworkTools\Services\Service;

/**
 * Ping test (docs section 24).
 *
 * ICMP echo is used when the hosting environment permits raw sockets — which is
 * the exception on cPanel shared hosting. Otherwise a TCP handshake probe runs
 * and the result is labelled TCP, because reporting a TCP RTT as an ICMP ping
 * would be a fabricated answer. Probes, targets and timeouts are strictly
 * bounded, private ranges are blocked and the tool is rate limited as high risk.
 */
final class PingService extends Service
{
    protected function execute()
    {
        $target = $this->input['target'];
        $count = isset($this->input['count']) ? (int) $this->input['count'] : 4;
        $count = max(1, min(5, $count));
        $port = isset($this->input['port']) ? (int) $this->input['port'] : 443;
        $verdict = SsrfGuard::validateHost($target);
        if (!$verdict['ok']) {
            return ToolResult::failure($verdict['code'], $verdict['message']);
        }
        $address = $verdict['addresses'][0];
        $method = 'icmp';
        $result = $this->icmpPing($address, $count);
        if ($result === null) {
            $method = 'tcp';
            $result = $this->tcpPing($address, $port, $count);
        }
        if ($result['sent'] === 0) {
            return ToolResult::failure('SERVICE_UNAVAILABLE', 'No probe method is available in this hosting environment for that target.', array('capability' => 'raw_icmp', 'fallback' => 'tcp'));
        }
        $received = $result['received'];
        $loss = $result['sent'] > 0 ? round((1 - ($received / $result['sent'])) * 100, 1) : 100.0;
        $latencies = $result['latencies'];
        return ToolResult::success(array(
            'target' => $target,
            'resolved_address' => $address,
            'probe_method' => $method,
            'probe_method_label' => $method === 'icmp' ? 'ICMP echo (raw socket available in this environment)' : 'TCP handshake (ICMP is not available in this environment, so this is not an ICMP ping)',
            'probe_port' => $method === 'tcp' ? $port : null,
            'packets_sent' => $result['sent'],
            'packets_received' => $received,
            'packet_loss_percent' => $loss,
            'min_ms' => $latencies ? min($latencies) : null,
            'max_ms' => $latencies ? max($latencies) : null,
            'avg_ms' => $latencies ? round(array_sum($latencies) / count($latencies), 2) : null,
            'probes' => $result['probes'],
            'summary' => $received . '/' . $result['sent'] . ' probes answered'
                . ($latencies ? ', average ' . round(array_sum($latencies) / count($latencies), 1) . ' ms' : '') . '.',
            'explanation' => $method === 'icmp'
                ? 'ICMP echo measures round-trip time to the host itself.'
                : 'This environment does not allow raw ICMP sockets, so the figures come from TCP handshakes to port ' . $port . '. They measure reachability of that service and its round-trip time — similar in practice, but not the same measurement as an ICMP ping.',
        ), $method === 'tcp' ? array('Reported as a TCP probe, not ICMP: raw ICMP sockets are unavailable on this host.') : array());
    }

    /** @return array|null null when raw sockets are not permitted */
    private function icmpPing($address, $count)
    {
        if (!function_exists('socket_create') || !defined('SOCK_RAW') || !defined('IPPROTO_ICMP')) {
            return null;
        }
        $ipv6 = strpos($address, ':') !== false;
        if ($ipv6) {
            return null; // raw ICMPv6 needs a checksum-aware socket; not attempted
        }
        $socket = @socket_create(AF_INET, SOCK_RAW, IPPROTO_ICMP);
        if (!$socket) {
            return null;
        }
        socket_set_option($socket, SOL_SOCKET, SO_RCVTIMEO, array('sec' => 2, 'usec' => 0));
        $sent = 0;
        $received = 0;
        $latencies = array();
        $probes = array();
        for ($i = 0; $i < $count; $i++) {
            $identifier = random_int(1, 0xffff) & 0xffff;
            $sequence = $i + 1;
            $payload = 'CH247' . str_pad((string) $sequence, 3, '0', STR_PAD_LEFT);
            $checksumInput = pack('CCnnn', 8, 0, 0, $identifier, $sequence) . $payload;
            $checksum = $this->icmpChecksum($checksumInput);
            $packet = pack('CCnnn', 8, 0, $checksum, $identifier, $sequence) . $payload;
            $started = microtime(true);
            if (@socket_sendto($socket, $packet, strlen($packet), 0, $address, 0) === false) {
                $probes[] = array('sequence' => $sequence, 'status' => 'ERROR', 'latency_ms' => null);
                continue;
            }
            $sent++;
            $buffer = '';
            $from = '';
            $port = 0;
            $answered = @socket_recvfrom($socket, $buffer, 1500, 0, $from, $port);
            $elapsed = round((microtime(true) - $started) * 1000, 2);
            if ($answered === false || $answered === 0) {
                $probes[] = array('sequence' => $sequence, 'status' => 'TIMEOUT', 'latency_ms' => null);
                continue;
            }
            $received++;
            $latencies[] = $elapsed;
            $probes[] = array('sequence' => $sequence, 'status' => 'OK', 'latency_ms' => $elapsed);
        }
        socket_close($socket);
        return array('sent' => $sent, 'received' => $received, 'latencies' => $latencies, 'probes' => $probes);
    }

    private function icmpChecksum($data)
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

    private function tcpPing($address, $port, $count)
    {
        $host = strpos($address, ':') !== false ? '[' . $address . ']' : $address;
        $sent = 0;
        $received = 0;
        $latencies = array();
        $probes = array();
        for ($i = 0; $i < $count; $i++) {
            $started = microtime(true);
            $errorNumber = 0;
            $errorMessage = '';
            $socket = @stream_socket_client('tcp://' . $host . ':' . $port, $errorNumber, $errorMessage, 3);
            $elapsed = round((microtime(true) - $started) * 1000, 2);
            $sent++;
            if ($socket) {
                fclose($socket);
                $received++;
                $latencies[] = $elapsed;
                $probes[] = array('sequence' => $i + 1, 'status' => 'OK', 'latency_ms' => $elapsed);
            } else {
                $probes[] = array('sequence' => $i + 1, 'status' => stripos($errorMessage, 'refused') !== false ? 'REFUSED' : 'TIMEOUT', 'latency_ms' => null);
            }
            if ($i + 1 < $count) {
                usleep(150000);
            }
        }
        return array('sent' => $sent, 'received' => $received, 'latencies' => $latencies, 'probes' => $probes);
    }
}
