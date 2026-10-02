<?php
namespace CloudHost247\Integrations\Api;

use CloudHost247\Integrations\Support\ResultCode;

/**
 * Shared SMTP submission client.
 *
 * `SmtpProbe` answers "can this relay be reached and authenticated?"; this class
 * answers "deliver this message". Both live in the integrations addon for one
 * reason: the credentials stay in the vault, and every first-party module that
 * needs to submit mail goes through the same audited, tested code path instead
 * of growing its own socket handling.
 *
 * Guarantees:
 *
 *   - Implicit TLS (port 465) and STARTTLS (port 587) are the only accepted
 *     transports; plaintext submission is refused outright.
 *   - Header values are validated before they are written: a CR/LF in a subject
 *     or address is rejected, so a campaign cannot inject headers through a
 *     recipient, a subject or a header value.
 *   - The message body is base64-encoded MIME with a generated boundary, so the
 *     DATA terminator can never be forged by message content.
 *   - Failures are classified with the shared `ResultCode` vocabulary and never
 *     repeat the credential in the detail string.
 */
final class SmtpClient
{
    const MAX_SUBJECT = 250;

    /** @var array */
    private $settings;
    /** @var callable|null */
    private $dialer;

    public function __construct(array $settings, $dialer = null)
    {
        $this->settings = $settings;
        $this->dialer = is_callable($dialer) ? $dialer : null;
    }

    /**
     * Submits one message.
     *
     * @param array $message to, to_name, subject, html, text, from_email,
     *                       from_name, reply_to, headers
     * @return array{ok:bool,code:string,detail:string,latency_ms:int,provider_message_id:string}
     */
    public function send(array $message)
    {
        $settings = $this->normalise();
        if ($settings['error'] !== '') {
            return $this->failure(ResultCode::INVALID_CONFIGURATION, $settings['error']);
        }

        $envelope = $this->envelope($message);
        if ($envelope['error'] !== '') {
            return $this->failure(ResultCode::INVALID_CONFIGURATION, $envelope['error']);
        }

        $started = microtime(true);
        $socket = $this->dial($settings['host'], $settings['port'], $settings['connect_timeout'], $settings['encryption'] === 'ssl');
        if (!is_resource($socket)) {
            return $this->failure(ResultCode::PROVIDER_UNAVAILABLE, 'The SMTP relay did not accept a connection.', $started);
        }
        stream_set_timeout($socket, $settings['timeout']);

        try {
            if ($this->status($this->read($socket)) !== 220) {
                return $this->failure(ResultCode::PROVIDER_UNAVAILABLE, 'The SMTP relay refused the session.', $started);
            }
            $capabilities = $this->command($socket, 'EHLO ' . $settings['ehlo_domain']);
            if ($this->status($capabilities) !== 250) {
                return $this->failure(ResultCode::PROVIDER_UNAVAILABLE, 'The SMTP relay rejected the EHLO greeting.', $started);
            }
            if ($settings['encryption'] === 'tls') {
                if (stripos($capabilities, 'STARTTLS') === false) {
                    return $this->failure(ResultCode::INVALID_CONFIGURATION, 'The relay does not advertise STARTTLS on this port.', $started);
                }
                if ($this->status($this->command($socket, 'STARTTLS')) !== 220) {
                    return $this->failure(ResultCode::INVALID_ENDPOINT, 'The relay refused the STARTTLS upgrade.', $started);
                }
                if (!$this->enableCrypto($socket)) {
                    return $this->failure(ResultCode::INVALID_ENDPOINT, 'The TLS upgrade could not be completed.', $started);
                }
                $capabilities = $this->command($socket, 'EHLO ' . $settings['ehlo_domain']);
                if ($this->status($capabilities) !== 250) {
                    return $this->failure(ResultCode::PROVIDER_UNAVAILABLE, 'The relay rejected the greeting after STARTTLS.', $started);
                }
            }

            if (stripos($capabilities, 'AUTH') === false) {
                return $this->failure(ResultCode::INVALID_CONFIGURATION, 'The relay does not advertise SMTP authentication.', $started);
            }
            if ($this->status($this->command($socket, 'AUTH LOGIN')) !== 334) {
                return $this->failure(ResultCode::INVALID_CONFIGURATION, 'The relay does not accept the AUTH LOGIN mechanism.', $started);
            }
            if ($this->status($this->command($socket, base64_encode($settings['username']))) !== 334) {
                return $this->failure(ResultCode::AUTHENTICATION_FAILED, 'The relay rejected the submission user name.', $started);
            }
            $authentication = $this->command($socket, base64_encode($settings['password']));
            $authStatus = $this->status($authentication);
            if ($authStatus !== 235) {
                if (in_array($authStatus, array(535, 530, 534), true)) {
                    return $this->failure(ResultCode::AUTHENTICATION_FAILED, 'The relay rejected the submission credentials.', $started);
                }
                return $this->failure(ResultCode::PROVIDER_UNAVAILABLE, 'The relay returned an unexpected authentication status.', $started);
            }

            $sender = $this->command($socket, 'MAIL FROM:<' . $envelope['from'] . '>');
            $senderStatus = $this->status($sender);
            if ($senderStatus !== 250) {
                return $this->failure(
                    $senderStatus >= 500 ? ResultCode::PERMISSION_DENIED : ResultCode::PROVIDER_UNAVAILABLE,
                    'The relay refused the sender address.', $started
                );
            }

            $recipient = $this->command($socket, 'RCPT TO:<' . $envelope['to'] . '>');
            $recipientStatus = $this->status($recipient);
            if (!in_array($recipientStatus, array(250, 251), true)) {
                return $this->failure(
                    $recipientStatus >= 500 ? ResultCode::PERMISSION_DENIED : ResultCode::PROVIDER_UNAVAILABLE,
                    'The relay refused the recipient address.', $started
                );
            }

            if ($this->status($this->command($socket, 'DATA')) !== 354) {
                return $this->failure(ResultCode::PROVIDER_UNAVAILABLE, 'The relay refused to accept message data.', $started);
            }
            fwrite($socket, $this->body($envelope));
            $accepted = $this->read($socket);
            $acceptedStatus = $this->status($accepted);
            $this->command($socket, 'QUIT');

            if ($acceptedStatus !== 250) {
                return $this->failure(
                    $acceptedStatus >= 500 ? ResultCode::PERMISSION_DENIED : ResultCode::PROVIDER_UNAVAILABLE,
                    'The relay rejected the message.', $started
                );
            }

            return array(
                'ok' => true,
                'code' => ResultCode::CONNECTED,
                'detail' => 'Message accepted by the relay for delivery.',
                'latency_ms' => $this->elapsed($started),
                'provider_message_id' => $this->queueId($accepted),
            );
        } catch (\Throwable $failure) {
            return $this->failure(ResultCode::TIMEOUT, 'The SMTP conversation did not complete in time.', $started);
        } finally {
            if (is_resource($socket)) { @fclose($socket); }
        }
    }

    /** Non-secret summary of the target, for the admin panel. */
    public function describe()
    {
        $settings = $this->normalise();
        return array(
            'host' => $settings['host'],
            'port' => $settings['port'],
            'encryption' => $settings['encryption'],
            'username' => $settings['username'],
            'from_address' => $settings['from_address'],
            'ehlo_domain' => $settings['ehlo_domain'],
            'valid' => $settings['error'] === '',
        );
    }

    // ------------------------------------------------------------------ setup

    private function normalise()
    {
        $s = $this->settings;
        $host = isset($s['host']) ? trim((string) $s['host']) : '';
        $port = isset($s['port']) ? (int) $s['port'] : 0;
        $encryption = isset($s['encryption']) ? strtolower(trim((string) $s['encryption'])) : 'tls';
        $username = isset($s['username']) ? trim((string) $s['username']) : '';
        $password = isset($s['password']) ? (string) $s['password'] : '';
        $fromAddress = isset($s['from_address']) ? trim((string) $s['from_address']) : '';
        $ehlo = isset($s['ehlo_domain']) && trim((string) $s['ehlo_domain']) !== '' ? trim((string) $s['ehlo_domain']) : 'cloudhost247.marketing';

        $error = '';
        if ($host === '' || $port < 1 || $port > 65535 || $username === '' || $password === '') {
            $error = 'SMTP host, port, username and password are required.';
        } elseif (!preg_match('/^[A-Za-z0-9.\-]{1,253}$/', $host) || strpos($host, '.') === false) {
            $error = 'The SMTP host must be a fully qualified domain name.';
        } elseif (!in_array($encryption, array('tls', 'ssl'), true)) {
            $error = 'Only STARTTLS and implicit TLS submission are supported.';
        }
        if ($error === '' && $fromAddress !== '' && !$this->isAddress($fromAddress)) {
            $error = 'The configured default from address is not a usable e-mail address.';
        }

        return array(
            'host' => $host,
            'port' => $port,
            'encryption' => $encryption,
            'username' => $username,
            'password' => $password,
            'from_address' => $fromAddress,
            'ehlo_domain' => preg_match('/^[A-Za-z0-9.\-]{1,253}$/', $ehlo) ? $ehlo : 'cloudhost247.marketing',
            'timeout' => isset($s['timeout']) ? max(1, min(60, (int) $s['timeout'])) : 15,
            'connect_timeout' => isset($s['connect_timeout']) ? max(1, min(30, (int) $s['connect_timeout'])) : 5,
            'error' => $error,
        );
    }

    /** Validates the envelope and builds the MIME headers. Never trusted input. */
    private function envelope(array $message)
    {
        $to = isset($message['to']) ? trim((string) $message['to']) : '';
        $from = isset($message['from_email']) ? trim((string) $message['from_email']) : '';
        if (!$this->isAddress($to)) { return array('error' => 'The recipient address is not usable.'); }
        if (!$this->isAddress($from)) { return array('error' => 'The sender address is not usable.'); }

        $settings = $this->normalise();
        if ($settings['from_address'] !== '' && strcasecmp($from, $settings['from_address']) !== 0) {
            // The configured identity wins unless the caller explicitly wanted
            // another address on the same mailbox domain (validated by the
            // caller's sender policy, not silently rewritten here).
            $configured = $this->domain($settings['from_address']);
            if ($configured === '' || $configured !== $this->domain($from)) {
                return array('error' => 'The sender address is not on the configured mailbox domain.');
            }
        }

        $subject = isset($message['subject']) ? (string) $message['subject'] : '';
        if (preg_match('/[\r\n]/', $subject) || strlen($subject) > self::MAX_SUBJECT) {
            return array('error' => 'The subject line is empty, too long, or contains a line break.');
        }
        if (trim($subject) === '') { $subject = '(no subject)'; }

        $headers = array();
        $fromName = isset($message['from_name']) ? (string) $message['from_name'] : '';
        $headers[] = 'From: ' . ($fromName !== '' ? $this->displayName($fromName) . ' <' . $from . '>' : $from);
        $toName = isset($message['to_name']) ? (string) $message['to_name'] : '';
        $headers[] = 'To: ' . ($toName !== '' ? $this->displayName($toName) . ' <' . $to . '>' : $to);
        $headers[] = 'Subject: ' . $this->encodeHeader($subject);
        $replyTo = isset($message['reply_to']) ? trim((string) $message['reply_to']) : '';
        if ($replyTo !== '' && $this->isAddress($replyTo)) { $headers[] = 'Reply-To: ' . $replyTo; }

        // Caller-supplied headers are restricted to simple X-* names with safe
        // values: a campaign can tag its own mail but cannot override From/To.
        $extra = isset($message['headers']) && is_array($message['headers']) ? $message['headers'] : array();
        foreach ($extra as $name => $value) {
            $name = (string) $name;
            $value = (string) $value;
            if (!preg_match('/^X-[A-Za-z0-9\-]{1,60}$/', $name)) { continue; }
            if ($value === '' || preg_match('/[\r\n]/', $value) || strlen($value) > 190) { continue; }
            $headers[] = $name . ': ' . $value;
        }

        $host = $this->domain($from);
        $headers[] = 'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . ($host !== '' ? $host : 'cloudhost247.local') . '>';
        $headers[] = 'Date: ' . gmdate('D, d M Y H:i:s') . ' +0000';
        $headers[] = 'MIME-Version: 1.0';
        $headers[] = 'Auto-Submitted: auto-generated';

        $text = isset($message['text']) ? (string) $message['text'] : '';
        $html = isset($message['html']) ? (string) $message['html'] : '';
        if (trim($text) === '' && trim($html) === '') {
            return array('error' => 'The message carries neither a plain-text nor an HTML body.');
        }
        $boundary = 'ch247-' . bin2hex(random_bytes(16));

        return array(
            'error' => '',
            'to' => $to,
            'from' => $from,
            'headers' => $headers,
            'boundary' => $boundary,
            'text' => $text,
            'html' => $html,
        );
    }

    /** Headers + multipart body, terminated with the DATA dot line. */
    private function body(array $envelope)
    {
        $parts = array();
        if (trim($envelope['text']) !== '') {
            $parts[] = "--" . $envelope['boundary'] . "\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
                . $this->base64Body($envelope['text']);
        }
        if (trim($envelope['html']) !== '') {
            $parts[] = "--" . $envelope['boundary'] . "\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
                . $this->base64Body($envelope['html']);
        }
        $body = implode("\r\n", $parts) . "\r\n--" . $envelope['boundary'] . "--\r\n";

        $headers = $envelope['headers'];
        $headers[] = 'Content-Type: multipart/alternative; boundary="' . $envelope['boundary'] . '"';
        $message = implode("\r\n", $headers) . "\r\n\r\n" . $body;
        return $this->dotStuff($message) . ".\r\n";
    }

    private function base64Body($content)
    {
        return rtrim(chunk_split(base64_encode((string) $content), 76, "\r\n"));
    }

    /** RFC 5321 transparency: a line starting with a dot is escaped. */
    private function dotStuff($message)
    {
        $message = str_replace(array("\r\n", "\r"), "\n", (string) $message);
        $lines = explode("\n", $message);
        foreach ($lines as $index => $line) {
            if (isset($line[0]) && $line[0] === '.') { $lines[$index] = '.' . $line; }
        }
        return implode("\r\n", $lines);
    }

    /** Non-ASCII headers are RFC 2047 encoded; ASCII stays readable. */
    private function encodeHeader($value)
    {
        $value = str_replace(array("\r", "\n"), ' ', (string) $value);
        if (preg_match('/^[\x20-\x7E]*$/', $value)) { return $value; }
        return '=?UTF-8?B?' . base64_encode($value) . '?=';
    }

    private function displayName($name)
    {
        $name = trim(str_replace(array("\r", "\n", '"'), '', (string) $name));
        if ($name === '') { return ''; }
        return preg_match('/^[\x20-\x7E]*$/', $name) ? '"' . $name . '"' : $this->encodeHeader($name);
    }

    /** Conservative address check: one @, no control characters, no display name. */
    private function isAddress($value)
    {
        $value = (string) $value;
        if ($value === '' || strlen($value) > 254) { return false; }
        if (preg_match('/[\x00-\x1F\x7F<>,;:\\\\"\s]/', $value)) { return false; }
        return (bool) preg_match('/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/', $value);
    }

    private function domain($address)
    {
        $position = strrpos((string) $address, '@');
        return $position === false ? '' : strtolower(substr($address, $position + 1));
    }

    /** Queue identifier from a relay's acceptance line, when it gives one. */
    private function queueId($reply)
    {
        if (preg_match('/queued as ([A-Za-z0-9._\-]+)/i', (string) $reply, $m)) { return $m[1]; }
        if (preg_match('/\bid[= ]([A-Za-z0-9._\-]{6,})/i', (string) $reply, $m)) { return $m[1]; }
        return '';
    }

    // ------------------------------------------------------------------- wire

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

    private function failure($code, $detail, $started = null)
    {
        return array(
            'ok' => false,
            'code' => $code,
            'detail' => (string) $detail,
            'latency_ms' => $started === null ? 0 : $this->elapsed($started),
            'provider_message_id' => '',
        );
    }
}
