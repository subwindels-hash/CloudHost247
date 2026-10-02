<?php
namespace CloudHost247\NetworkTools\Services\Network;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Core\Security\SsrfGuard;
use CloudHost247\NetworkTools\Core\Security\TargetValidator;
use CloudHost247\NetworkTools\Services\Service;

/**
 * Port checker (docs section 26).
 *
 * A deliberately small TCP connect test: a validated public target, at most
 * sixteen ports per request, a hard per-port timeout and no banner grabbing, no
 * service detection and no UDP. High-risk rate limits apply, private ranges are
 * blocked and every request is logged.
 */
final class PortCheckService extends Service
{
    protected function execute()
    {
        $host = $this->input['host'];
        $ports = $this->input['ports'];
        $verdict = SsrfGuard::validateHost($host);
        if (!$verdict['ok']) {
            return ToolResult::failure($verdict['code'], $verdict['message']);
        }
        $addresses = $verdict['addresses'];
        $address = $addresses[0];
        $timeout = max(1, min(5, (int) $this->intSetting('port_check_timeout_seconds', 4)));
        $results = array();
        foreach ($ports as $port) {
            $results[] = $this->check($address, $port, $timeout);
        }
        $open = array();
        foreach ($results as $row) {
            if ($row['status'] === 'OPEN') { $open[] = $row['port']; }
        }
        return ToolResult::success(array(
            'host' => $host,
            'resolved_address' => $address,
            'addresses_checked' => $addresses,
            'ports_checked' => count($results),
            'open_ports' => $open,
            'results' => $results,
            'summary' => $open ? 'Open: ' . implode(', ', $open) : 'No open port found among the ' . count($results) . ' checked.',
            'explanation' => 'A closed result means the host answered and refused. A timeout usually means a firewall dropped the packet, which is also how filters are reported. UDP ports are not offered because a UDP check cannot be conclusive.',
            'scope_notice' => 'This test checked ' . count($results) . ' port(s) on one address. It is not a port scan and the request budget is strictly limited.',
        ), $open ? array() : array('No open port was found. That can also happen when a security device answers for the host and refuses everything from this network.'), array('checked_at' => gmdate('c')));
    }

    private function check($address, $port, $timeout)
    {
        $host = strpos($address, ':') !== false ? '[' . $address . ']' : $address;
        $started = microtime(true);
        $errorNumber = 0;
        $errorMessage = '';
        $socket = @stream_socket_client('tcp://' . $host . ':' . (int) $port, $errorNumber, $errorMessage, $timeout);
        $elapsed = (int) round((microtime(true) - $started) * 1000);
        if ($socket) {
            fclose($socket);
            return array('port' => (int) $port, 'status' => 'OPEN', 'detail' => 'The TCP connection was accepted.', 'response_time_ms' => $elapsed);
        }
        if (stripos($errorMessage, 'refused') !== false || $errorNumber === 111) {
            return array('port' => (int) $port, 'status' => 'CLOSED', 'detail' => 'The host answered and refused the connection.', 'response_time_ms' => $elapsed);
        }
        if (stripos($errorMessage, 'timed out') !== false || in_array($errorNumber, array(110, 60), true)) {
            return array('port' => (int) $port, 'status' => 'TIMEOUT', 'detail' => 'No answer within ' . $timeout . ' seconds (usually a firewall).', 'response_time_ms' => $elapsed);
        }
        return array('port' => (int) $port, 'status' => 'UNREACHABLE', 'detail' => 'The connection could not be attempted: ' . ($errorMessage !== '' ? $errorMessage : 'unreachable'), 'response_time_ms' => $elapsed);
    }
}
