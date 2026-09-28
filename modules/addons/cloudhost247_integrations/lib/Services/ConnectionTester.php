<?php
namespace CloudHost247\Integrations\Services;

use CloudHost247\Integrations\Api\IntegrationClient;
use CloudHost247\Integrations\Api\SmtpProbe;
use CloudHost247\Integrations\Api\Transport;
use CloudHost247\Integrations\Api\TransportException;
use CloudHost247\Integrations\Registry\ProviderDefinition;
use CloudHost247\Integrations\Support\ResultCode;

/**
 * Executes a provider's documented connection test entirely server-side and
 * reduces the outcome to one safe result code plus a fixed explanation.
 *
 * Raw provider bodies, response headers, credentials and exceptions never leave
 * this class.
 */
final class ConnectionTester
{
    private $transport;
    private $smtp;

    public function __construct(Transport $transport = null, SmtpProbe $smtp = null)
    {
        $this->transport = $transport;
        $this->smtp = $smtp ? $smtp : new SmtpProbe();
    }

    /**
     * @param array $config  normalized configuration (see IntegrationRepository::configuration)
     * @param array $secrets decrypted credentials, server-side only
     * @return array code, detail, latency_ms
     */
    public function check(ProviderDefinition $definition, array $config, array $secrets)
    {
        $health = $definition->health();
        if (strtoupper((string) $health['method']) === 'SMTP') {
            return $this->checkSmtp($definition, $config, $secrets);
        }
        $started = microtime(true);
        try {
            $client = new IntegrationClient($definition, $config, $secrets, $this->transport);
            $options = array();
            if (!empty($health['form']) && is_array($health['form'])) { $options['form'] = $health['form']; }
            if (!empty($health['json']) && is_array($health['json'])) { $options['json'] = $health['json']; }
            $response = $client->request($health['method'], $health['path'], $options);
        } catch (TransportException $failure) {
            return $this->result(ResultCode::fromTransportKind($failure->kind()), $this->transportDetail($failure->kind()), $this->elapsed($started));
        } catch (\InvalidArgumentException $failure) {
            return $this->result(ResultCode::INVALID_CONFIGURATION, 'The stored configuration is incomplete or not accepted by the endpoint policy.', $this->elapsed($started));
        } catch (\Throwable $failure) {
            return $this->result(ResultCode::INVALID_CONFIGURATION, 'The integration could not be prepared for a connection test.', $this->elapsed($started));
        }

        $latency = isset($response['latency_ms']) ? (int) $response['latency_ms'] : $this->elapsed($started);
        $code = ResultCode::fromHttpStatus($response['status']);
        if (!ResultCode::isSuccess($code)) {
            return $this->result($code, $this->statusDetail($code, (int) $response['status']), $latency);
        }
        return $this->validate($health, $response, $latency);
    }

    private function validate(array $health, array $response, $latency)
    {
        $expect = isset($health['expect']) && is_array($health['expect']) ? $health['expect'] : array();
        $json = isset($response['json']) ? $response['json'] : null;
        $body = isset($response['body']) ? (string) $response['body'] : '';

        if (!empty($expect['json']) && !is_array($json)) {
            return $this->result(ResultCode::PROVIDER_UNAVAILABLE, 'The provider returned a response the platform could not read as JSON.', $latency);
        }
        if (!empty($expect['contains']) && strpos($body, (string) $expect['contains']) === false) {
            return $this->result(ResultCode::INVALID_ENDPOINT, 'The endpoint responded, but not with the documented payload for this provider.', $latency);
        }
        if (!empty($expect['require']) && is_array($json)) {
            foreach ((array) $expect['require'] as $key) {
                if (!array_key_exists($key, $json)) {
                    return $this->result(ResultCode::INVALID_ENDPOINT, 'The endpoint responded, but the documented fields for this provider were absent.', $latency);
                }
            }
        }
        if (!empty($expect['equals']) && is_array($expect['equals'])) {
            $failureCode = isset($expect['failure_code']) && ResultCode::isValid($expect['failure_code']) ? $expect['failure_code'] : ResultCode::AUTHENTICATION_FAILED;
            foreach ($expect['equals'] as $key => $value) {
                if (!is_array($json) || !array_key_exists($key, $json) || $json[$key] !== $value) {
                    return $this->result($failureCode, ResultCode::label($failureCode) . ': the provider accepted the request but reported the call as unsuccessful.', $latency);
                }
            }
        }
        return $this->result(ResultCode::CONNECTED, 'The provider accepted the credentials and returned the documented response.', $latency);
    }

    private function checkSmtp(ProviderDefinition $definition, array $config, array $secrets)
    {
        $options = isset($config['options']) && is_array($config['options']) ? $config['options'] : array();
        $auth = $definition->auth();
        $secretKey = isset($auth['secret']) ? (string) $auth['secret'] : 'password';
        return $this->smtp->check(array(
            'host' => isset($options['host']) ? $options['host'] : '',
            'port' => isset($options['port']) ? $options['port'] : 0,
            'encryption' => isset($options['encryption']) ? $options['encryption'] : 'tls',
            'username' => isset($config['username']) ? $config['username'] : '',
            'password' => isset($secrets[$secretKey]) ? $secrets[$secretKey] : '',
            'connect_timeout' => isset($config['connect_timeout_seconds']) ? $config['connect_timeout_seconds'] : 5,
            'timeout' => isset($config['timeout_seconds']) ? $config['timeout_seconds'] : 15,
        ));
    }

    private function transportDetail($kind)
    {
        switch ($kind) {
            case 'timeout':
                return 'The provider did not answer within the configured timeout.';
            case 'dns':
                return 'The configured host name could not be resolved.';
            case 'tls':
                return 'The TLS certificate of the endpoint could not be verified.';
            case 'connect':
                return 'A network connection to the endpoint could not be established.';
            case 'too_large':
                return 'The provider response exceeded the safe size limit.';
            case 'configuration':
                return 'The integration configuration is incomplete.';
            default:
                return 'The provider could not be reached.';
        }
    }

    private function statusDetail($code, $status)
    {
        switch ($code) {
            case ResultCode::AUTHENTICATION_FAILED:
                return 'The provider rejected the stored credentials.';
            case ResultCode::PERMISSION_DENIED:
                return 'The credentials are valid but lack the permission this integration requires.';
            case ResultCode::INVALID_ENDPOINT:
                return 'The configured endpoint does not expose the expected provider API.';
            case ResultCode::TIMEOUT:
                return 'The provider reported a request timeout.';
            case ResultCode::INVALID_CONFIGURATION:
                return 'The provider rejected the request as malformed or incomplete.';
            default:
                return 'The provider is currently unavailable (HTTP ' . (int) $status . ').';
        }
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
