<?php
namespace CloudHost247\Integrations\Api;

use CloudHost247\Integrations\Support\ResultCode;

/**
 * Real SMTP submission test.
 *
 * Performs an actual handshake against the configured relay: greeting, EHLO,
 * optional STARTTLS upgrade, AUTH LOGIN and QUIT. No message is ever sent and
 * the password is only written to the authenticated socket.
 */
final class SmtpProbe
{
    /** @var callable|null */
    private $dialer;

    public function __construct($dialer = null)
    {
        $this->dialer = is_callable($dialer) ? $dialer : null;
    }

    /**
     * @param array $settings host, port, encryption, username, password, connect_timeout, timeout
     * @return array code, detail, latency_ms
     */
    public function check(array $settings)
    {
        $host = isset($settings['host']) ? trim((string) $settings['host']) : '';
        $port = isset($settings['port']) ? (int) $settings['port'] : 0;
        $encryption = isset($settings['encryption']) ? strtolower((string) $settings['encryption']) : 'tls';
        $username = isset($settings['username']) ? (string) $settings['username'] : '';
        $password = isset($settings['password']) ? (string) $settings['password'] : '';
        $connectTimeout = isset($settings['connect_timeout']) ? max(1, min(30, (int) $settings['connect_timeout'])) : 5;
        $timeout = isset($settings['timeout']) ? max(1, min(60, (int) $settings['timeout'])) : 15;

        if ($host === '' || $port < 1 || $port > 65535 || $username === '' || $password === '') {
            return $this->result(ResultCode::INVALID_CONFIGURATION, 'SMTP host, port, username and password are required.', 0);
        }
        if (!preg_match('/^[A-Za-z0-9.\-]{1,253}$/', $host) || strpos($host, '.') === false) {
            return $this->result(ResultCode::INVALID_CONFIGURATION, 'The SMTP host must be a fully qualified domain name.', 0);
        }
        if (!in_array($encryption, array('tls', 'ssl'), true)) {
            return $this->result(ResultCode::INVALID_CONFIGURATION, 'Only STARTTLS and implicit TLS submission are supported.', 0);
        }

        $started = microtime(true);
        $socket = $this->dial($host, $port, $connectTimeout, $encryption === 'ssl');
        if (!is_resource($socket)) {
            return $this->result(ResultCode::PROVIDER_UNAVAILABLE, 'The SMTP relay did not accept a connection.', $this->elapsed($started));
        }
        stream_set_timeout($socket, $timeout);
        try {
            $greeting = $this->read($socket);
            if ($this->status($greeting) !== 220) {
                return $this->result(ResultCode::PROVIDER_UNAVAILABLE, 'The SMTP relay refused the session.', $this->elapsed($started));
            }
            $capabilities = $this->command($socket, 'EHLO cloudhost247.integration.test');
            if ($this->status($capabilities) !== 250) {
                return $this->result(ResultCode::PROVIDER_UNAVAILABLE, 'The SMTP relay rejected the EHLO greeting.', $this->elapsed($started));
            }
            if ($encryption === 'tls') {
                if (stripos($capabilities, 'STARTTLS') === false) {
                    return $this->result(ResultCode::INVALID_CONFIGURATION, 'The relay does not advertise STARTTLS on this port.', $this->elapsed($started));
                }
                if ($this->status($this->command($socket, 'STARTTLS')) !== 220) {
                    return $this->result(ResultCode::INVALID_ENDPOINT, 'The relay refused the STARTTLS upgrade.', $this->elapsed($started));
                }
                if (!$this->enableCrypto($socket)) {
                    return $this->result(ResultCode::INVALID_ENDPOINT, 'The TLS upgrade could not be completed.', $this->elapsed($started));
                }
                $capabilities = $this->command($socket, 'EHLO cloudhost247.integration.test');
                if ($this->status($capabilities) !== 250) {
                    return $this->result(ResultCode::PROVIDER_UNAVAILABLE, 'The relay rejected the greeting after STARTTLS.', $this->elapsed($started));
                }
            }
            if (stripos($capabilities, 'AUTH') === false) {
                return $this->result(ResultCode::INVALID_CONFIGURATION, 'The relay does not advertise SMTP authentication.', $this->elapsed($started));
            }
            if ($this->status($this->command($socket, 'AUTH LOGIN')) !== 334) {
                return $this->result(ResultCode::INVALID_CONFIGURATION, 'The relay does not accept the AUTH LOGIN mechanism.', $this->elapsed($started));
            }
            if ($this->status($this->command($socket, base64_encode($username))) !== 334) {
                return $this->result(ResultCode::AUTHENTICATION_FAILED, 'The relay rejected the submission user name.', $this->elapsed($started));
            }
            $authentication = $this->command($socket, base64_encode($password));
            $status = $this->status($authentication);
            $this->command($socket, 'QUIT');
            if ($status === 235) {
                return $this->result(ResultCode::CONNECTED, 'SMTP authentication succeeded.', $this->elapsed($started));
            }
            if ($status === 535 || $status === 530 || $status === 534) {
                return $this->result(ResultCode::AUTHENTICATION_FAILED, 'The relay rejected the submission credentials.', $this->elapsed($started));
            }
            if ($status === 550 || $status === 554) {
                return $this->result(ResultCode::PERMISSION_DENIED, 'The relay refused the authenticated sender.', $this->elapsed($started));
            }
            return $this->result(ResultCode::PROVIDER_UNAVAILABLE, 'The relay returned an unexpected authentication status.', $this->elapsed($started));
        } catch (\Throwable $failure) {
            return $this->result(ResultCode::TIMEOUT, 'The SMTP conversation did not complete in time.', $this->elapsed($started));
        } finally {
            if (is_resource($socket)) { @fclose($socket); }
        }
    }

    private function dial($host, $port, $connectTimeout, $implicitTls)
    {
        if ($this->dialer) {
            return call_user_func($this->dialer, $host, $port, $connectTimeout, $implicitTls);
        }
        $context = stream_context_create(array('ssl' => array(
            'verify_peer' => true, 'verify_peer_name' => true, 'allow_self_signed' => false, 'SNI_enabled' => true,
        )));
        $errorNumber = 0;
        $errorMessage = '';
        $target = ($implicitTls ? 'ssl://' : 'tcp://') . $host . ':' . (int) $port;
        return @stream_socket_client($target, $errorNumber, $errorMessage, $connectTimeout, STREAM_CLIENT_CONNECT, $context);
    }

    private function enableCrypto($socket)
    {
        $method = STREAM_CRYPTO_METHOD_TLS_CLIENT;
        if (defined('STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT')) { $method |= STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT; }
        return (bool) @stream_socket_enable_crypto($socket, true, $method);
    }

    private function command($socket, $line)
    {
        fwrite($socket, $line . "\r\n");
        return $this->read($socket);
    }

    /** Read a complete, possibly multi-line, SMTP reply. */
    private function read($socket)
    {
        $reply = '';
        while (($line = fgets($socket, 1024)) !== false) {
            $reply .= $line;
            if (strlen($line) < 4 || $line[3] !== '-') { break; }
            if (strlen($reply) > 16384) { break; }
        }
        return $reply;
    }

    private function status($reply)
    {
        return preg_match('/^(\d{3})/', (string) $reply, $matches) ? (int) $matches[1] : 0;
    }

    private function elapsed($started)
    {
        return (int) round((microtime(true) - $started) * 1000);
    }

    private function result($code, $detail, $latency)
    {
        return array('code' => $code, 'detail' => $detail, 'latency_ms' => (int) $latency);
    }
}
