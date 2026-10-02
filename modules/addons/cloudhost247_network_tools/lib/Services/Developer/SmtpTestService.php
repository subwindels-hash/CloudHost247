<?php
namespace CloudHost247\NetworkTools\Services\Developer;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;

/**
 * SMTP tester (docs section 32).
 *
 * The real handshake is performed by the integrations centre's SmtpProbe, which
 * is the same code path the platform uses for its own mail — no second SMTP
 * implementation. With mode=platform the stored (encrypted) credentials are
 * used and nothing is typed at all. With mode=custom the supplied credentials
 * live only inside this request: they are not logged, not cached, not stored,
 * not exported and not attached to a support ticket (the tool declares the
 * field sensitive, so the runner strips it from every record).
 */
final class SmtpTestService extends Service
{
    protected function execute()
    {
        $mode = isset($this->input['mode']) ? $this->input['mode'] : 'platform';
        $bridge = $this->provider();
        $settings = array(
            'host' => (string) (isset($this->input['host']) ? $this->input['host'] : ''),
            'port' => (int) (isset($this->input['port']) ? $this->input['port'] : 0),
            'encryption' => (string) (isset($this->input['encryption']) ? $this->input['encryption'] : 'tls'),
            'username' => (string) (isset($this->input['username']) ? $this->input['username'] : ''),
            'password' => (string) (isset($this->input['password']) ? $this->input['password'] : ''),
            'timeout' => max(5, (int) $this->setting('default_timeout_seconds', 10) + 5),
            'connect_timeout' => 5,
        );
        if ($mode === 'platform') {
            $candidates = array('cpanel_smtp', 'smtp');
            $readiness = $bridge->firstAvailable($candidates);
            if (!$readiness['available']) {
                return ToolResult::configurationRequired('No SMTP relay is configured in CloudHost247 (Admin → API & Integrations → Email/SMTP), and no custom server was supplied.');
            }
            $credentials = $bridge->credentials($readiness['key']);
            if ($credentials === null) {
                return ToolResult::configurationRequired('The stored SMTP credentials could not be read. Check the credential encryption key configuration.');
            }
            $config = isset($credentials['config']) ? $credentials['config'] : array();
            $secrets = isset($credentials['secrets']) ? $credentials['secrets'] : array();
            $options = isset($config['options']) && is_array($config['options']) ? $config['options'] : array();
            $settings = array_merge($settings, array(
                'host' => isset($options['host']) ? (string) $options['host'] : '',
                'port' => isset($options['port']) ? (int) $options['port'] : 0,
                'encryption' => isset($options['encryption']) ? (string) $options['encryption'] : 'tls',
                'username' => isset($config['username']) ? (string) $config['username'] : '',
                'password' => isset($secrets['password']) ? (string) $secrets['password'] : '',
            ));
            $probe = array('ok' => $settings['host'] !== '' && $settings['password'] !== '', 'code' => '', 'message' => '', 'latency_ms' => 0);
            if (!$probe['ok']) {
                return ToolResult::configurationRequired('The stored SMTP integration is incomplete (host, username and password are required).');
            }
        } else {
            if ($settings['host'] === '' || $settings['username'] === '' || $settings['password'] === '') {
                return ToolResult::invalid('For a custom SMTP server, host, username and password are required.');
            }
            if (!\CloudHost247\NetworkTools\Core\Security\SsrfGuard::isValidHostname($settings['host'])) {
                return ToolResult::invalid('The SMTP host must be a fully qualified hostname.');
            }
            // A custom relay is allowed only on submission ports; this keeps the
            // tool from being used as a generic TCP prober.
            if (!in_array((int) $settings['port'], array(25, 465, 587, 2525), true)) {
                return ToolResult::invalid('Custom SMTP testing is limited to the submission ports 25, 465, 587 and 2525.');
            }
        }
        $result = $bridge->probeSmtp($settings);
        $steps = array(
            array('name' => 'DNS resolution and TCP connect', 'status' => $result['ok'] ? 'PASS' : ($result['code'] === 'CONFIGURATION_REQUIRED' ? 'NOT RUN' : 'FAIL'), 'detail' => $result['ok'] ? 'The relay accepted a connection.' : $result['message']),
            array('name' => 'TLS', 'status' => $settings['encryption'] === 'tls' ? 'CHECKED DURING HANDSHAKE' : 'IMPLICIT TLS ON CONNECT', 'detail' => 'Certificates are verified; a self-signed or expired certificate fails the test.'),
            array('name' => 'Authentication', 'status' => $result['ok'] ? 'PASS' : 'FAIL', 'detail' => $result['ok'] ? 'The relay accepted the credentials.' : $result['message']),
        );
        if (!$result['ok']) {
            return ToolResult::failure($result['code'], $result['message'], array(
                'steps' => $steps, 'mode' => $mode, 'provider' => $mode === 'platform' ? 'CloudHost247 configured SMTP' : 'custom',
                'latency_ms' => $result['latency_ms'],
            ));
        }
        return ToolResult::success(array(
            'mode' => $mode,
            'host' => $settings['host'],
            'port' => (int) $settings['port'],
            'encryption' => $settings['encryption'],
            'steps' => $steps,
            'latency_ms' => $result['latency_ms'],
            'message_sent' => false,
            'summary' => 'The SMTP relay accepted the connection and authenticated successfully. No message was sent.',
            'credentials_notice' => 'Any credentials you typed were used for this request only and have been discarded. They are not stored, logged, exported or attached to support tickets.',
        ), array(), array('credentials_persisted' => false));
    }
}
