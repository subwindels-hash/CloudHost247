<?php
namespace CloudHost247\Integrations\Api;

use CloudHost247\Integrations\Api\Signers\AwsV4Signer;
use CloudHost247\Integrations\Api\Signers\OvhSigner;
use CloudHost247\Integrations\Registry\ProviderDefinition;
use CloudHost247\Integrations\Security\UrlGuard;
use CloudHost247\Integrations\Support\Redactor;
use InvalidArgumentException;

/**
 * Authenticated API client built from a registry definition plus the decrypted
 * configuration of one integration.
 *
 * Secrets live only in this object's memory for the duration of a call. They
 * are applied to request headers (or, where a provider protocol mandates it, to
 * a request body or path segment) and are never placed in a query string, never
 * returned to the caller and never logged.
 */
final class IntegrationClient
{
    private $definition;
    private $config;
    private $secrets;
    private $transport;
    private $bearerCache = null;
    private $timeDelta = null;

    public function __construct(ProviderDefinition $definition, array $config, array $secrets, Transport $transport = null)
    {
        $this->definition = $definition;
        $this->config = $config;
        $this->secrets = $secrets;
        $this->transport = $transport ? $transport : new CurlTransport();
    }

    public function definition() { return $this->definition; }
    public function configuration() { return $this->config; }

    public function baseUrl()
    {
        $base = $this->definition->resolveBaseUrl($this->config);
        if ($this->definition->requiresAdministratorEndpoint()) {
            $base = UrlGuard::normalizeBase($base, $this->definition->hostPolicy());
        }
        return rtrim($base, '/');
    }

    /**
     * Perform an authenticated request.
     *
     * @return array status, body, json, latency_ms
     * @throws TransportException
     */
    public function request($method, $path, array $options = array())
    {
        $method = strtoupper((string) $method);
        if (!in_array($method, array('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'), true)) {
            throw new InvalidArgumentException('Unsupported HTTP method.');
        }
        $prepared = $this->prepare($method, $path, $options);
        $safeMethod = in_array($method, array('GET', 'HEAD'), true);
        $attempts = $safeMethod ? max(1, min(5, (int) $this->intConfig('retry_attempts', 1))) : 1;
        $backoff = max(0, min(5000, (int) $this->intConfig('retry_backoff_ms', 250)));
        $limits = array(
            'connect_timeout' => $this->intConfig('connect_timeout_seconds', 5),
            'timeout' => $this->intConfig('timeout_seconds', 20),
            'max_bytes' => CurlTransport::DEFAULT_MAX_BYTES,
        );

        $lastFailure = null;
        for ($attempt = 1; $attempt <= $attempts; $attempt++) {
            try {
                $response = $this->transport->send($prepared['method'], $prepared['url'], $prepared['headers'], $prepared['body'], $limits);
            } catch (TransportException $failure) {
                $lastFailure = $failure;
                if ($attempt < $attempts) { $this->pause($backoff * $attempt); continue; }
                throw $failure;
            }
            $status = isset($response['status']) ? (int) $response['status'] : 0;
            if ($safeMethod && $attempt < $attempts && ($status === 429 || $status >= 500)) {
                $this->pause($backoff * $attempt);
                continue;
            }
            $body = isset($response['body']) ? (string) $response['body'] : '';
            $decoded = null;
            if ($body !== '') {
                $candidate = json_decode($body, true);
                if (is_array($candidate) && json_last_error() === JSON_ERROR_NONE) { $decoded = $candidate; }
            }
            return array(
                'status' => $status,
                'body' => $body,
                'json' => $decoded,
                'latency_ms' => isset($response['latency_ms']) ? (int) $response['latency_ms'] : 0,
            );
        }
        throw $lastFailure ? $lastFailure : new TransportException('error');
    }

    /** Sanitized description of the last built URL, safe for audit records. */
    public function describeEndpoint($path = '')
    {
        try {
            return Redactor::url($this->baseUrl() . $this->substitute((string) $path, false));
        } catch (\Throwable $error) {
            return Redactor::PLACEHOLDER;
        }
    }

    /* ------------------------------------------------------------ internals */

    private function prepare($method, $path, array $options)
    {
        $auth = $this->definition->auth();
        $type = $this->definition->authType();
        $headers = array('Accept: application/json');
        $form = isset($options['form']) && is_array($options['form']) ? $options['form'] : array();
        $json = isset($options['json']) && is_array($options['json']) ? $options['json'] : null;
        $body = null;

        $path = $this->substitute((string) $path, $type === 'path_token');
        $path = UrlGuard::path($path);
        $url = $this->baseUrl() . $path;

        if ($type === 'form_field') {
            $field = isset($auth['field']) ? (string) $auth['field'] : 'api_key';
            $form[$field] = $this->secret($auth);
            if (isset($auth['extra_form']) && is_array($auth['extra_form'])) {
                foreach ($auth['extra_form'] as $key => $value) { if (!isset($form[$key])) { $form[$key] = $value; } }
            }
        }
        if ($form) {
            $body = http_build_query($form, '', '&', PHP_QUERY_RFC3986);
            $headers[] = 'Content-Type: application/x-www-form-urlencoded';
        } elseif ($json !== null) {
            $body = json_encode($json, JSON_UNESCAPED_SLASHES);
            $headers[] = 'Content-Type: application/json';
        }

        switch ($type) {
            case 'bearer':
                $headers[] = 'Authorization: Bearer ' . $this->secret($auth);
                break;
            case 'header':
                $name = isset($auth['header']) ? (string) $auth['header'] : 'Authorization';
                $format = isset($auth['format']) ? (string) $auth['format'] : '{secret}';
                $headers[] = $name . ': ' . $this->renderAuthValue($format, $this->secret($auth));
                break;
            case 'basic':
                $user = $this->resolveSource(isset($auth['username_source']) ? $auth['username_source'] : 'column:username');
                $headers[] = 'Authorization: Basic ' . base64_encode($user . ':' . $this->secret($auth));
                break;
            case 'ovh':
                $headers = array_merge($headers, OvhSigner::headers(
                    $this->requiredSecret('application_key'),
                    $this->requiredSecret('application_secret'),
                    $this->requiredSecret('consumer_key'),
                    $method,
                    $url,
                    $body === null ? '' : $body,
                    time() + $this->ovhTimeDelta()
                ));
                break;
            case 'awsv4':
                $headers = array_merge($headers, AwsV4Signer::headers(
                    $this->requiredSecret(isset($auth['key_id_secret']) ? $auth['key_id_secret'] : 'api_key'),
                    $this->secret($auth),
                    isset($this->config['region']) ? $this->config['region'] : '',
                    isset($auth['service']) ? $auth['service'] : 's3',
                    $method,
                    $url,
                    $body === null ? '' : $body
                ));
                break;
            case 'oauth2_client_credentials':
                $headers[] = 'Authorization: Bearer ' . $this->oauthToken($auth);
                break;
            case 'form_field':
                // The credential was already placed in the request body above.
            case 'path_token':
            case 'none':
                break;
            default:
                throw new InvalidArgumentException('Unsupported authentication strategy.');
        }

        foreach ($this->extraHeaders($auth) as $header) { $headers[] = $header; }
        if (isset($options['headers']) && is_array($options['headers'])) {
            foreach ($options['headers'] as $header) { $headers[] = (string) $header; }
        }
        return array('method' => $method, 'url' => $url, 'headers' => $headers, 'body' => $body);
    }

    private function extraHeaders(array $auth)
    {
        $headers = array();
        if (empty($auth['extra_headers']) || !is_array($auth['extra_headers'])) { return $headers; }
        foreach ($auth['extra_headers'] as $name => $template) {
            $value = $this->substitute((string) $template, false);
            if (trim($value) !== '' && strpos($value, '{') === false) { $headers[] = $name . ': ' . $value; }
        }
        return $headers;
    }

    /** Obtain an OAuth2 client-credentials bearer token (server-side only). */
    private function oauthToken(array $auth)
    {
        if ($this->bearerCache !== null) { return $this->bearerCache; }
        $clientId = $this->resolveSource(isset($auth['client_id_source']) ? $auth['client_id_source'] : 'option:client_id');
        $clientSecret = $this->secret($auth);
        if ($clientId === '' || $clientSecret === '') {
            throw new TransportException('configuration', 'The OAuth client credentials are incomplete.');
        }
        $tokenUrl = isset($auth['token_url']) ? $this->substitute((string) $auth['token_url'], false) : $this->baseUrl() . UrlGuard::path((string) $auth['token_path']);
        if (strpos($tokenUrl, '{') !== false) {
            throw new TransportException('configuration', 'The OAuth token endpoint is not fully configured.');
        }
        $form = array('grant_type' => 'client_credentials');
        if (!empty($auth['scope'])) { $form['scope'] = (string) $auth['scope']; }
        $response = $this->transport->send('POST', $tokenUrl, array(
            'Accept: application/json',
            'Content-Type: application/x-www-form-urlencoded',
            'Authorization: Basic ' . base64_encode($clientId . ':' . $clientSecret),
        ), http_build_query($form, '', '&', PHP_QUERY_RFC3986), array(
            'connect_timeout' => $this->intConfig('connect_timeout_seconds', 5),
            'timeout' => $this->intConfig('timeout_seconds', 20),
            'max_bytes' => 65536,
        ));
        $status = isset($response['status']) ? (int) $response['status'] : 0;
        $decoded = json_decode(isset($response['body']) ? (string) $response['body'] : '', true);
        if ($status === 401 || $status === 403) {
            throw new TransportException('error', 'The OAuth client credentials were rejected.');
        }
        if ($status < 200 || $status >= 300 || !is_array($decoded) || empty($decoded['access_token']) || !is_string($decoded['access_token'])) {
            throw new TransportException('error', 'An OAuth access token could not be obtained.');
        }
        return $this->bearerCache = $decoded['access_token'];
    }

    /** OVH-style APIs sign with the provider clock; fetch the documented drift. */
    private function ovhTimeDelta()
    {
        if ($this->timeDelta !== null) { return $this->timeDelta; }
        try {
            $response = $this->transport->send('GET', $this->baseUrl() . '/auth/time', array('Accept: text/plain'), null, array(
                'connect_timeout' => $this->intConfig('connect_timeout_seconds', 5),
                'timeout' => min(15, $this->intConfig('timeout_seconds', 20)),
                'max_bytes' => 1024,
            ));
        } catch (TransportException $failure) {
            return $this->timeDelta = 0;
        }
        $body = isset($response['body']) ? trim((string) $response['body']) : '';
        if ((int) $response['status'] !== 200 || !ctype_digit($body)) { return $this->timeDelta = 0; }
        return $this->timeDelta = (int) $body - time();
    }

    /**
     * Render an authorization header template. Non-secret placeholders are
     * expanded first with the secret placeholder protected, so the credential
     * is inserted exactly once and cannot be consumed by the generic
     * substitution pass.
     */
    private function renderAuthValue($format, $secret)
    {
        $sentinel = "\x00ch247-secret\x00";
        $value = $this->substitute(str_replace('{secret}', $sentinel, (string) $format), false);
        return str_replace($sentinel, $secret, $value);
    }

    /**
     * Replace non-secret placeholders in a path, URL or header template.
     * Secret material is only substituted for the explicit path_token strategy,
     * which a provider protocol (Telegram) mandates.
     */
    private function substitute($template, $allowPathToken)
    {
        $config = $this->config;
        $options = isset($config['options']) && is_array($config['options']) ? $config['options'] : array();
        $self = $this;
        $rendered = preg_replace_callback('/\{([a-z_]+)(?::([a-z0-9_]+))?\}/', function ($matches) use ($config, $options, $allowPathToken, $self) {
            $name = $matches[1];
            if ($name === 'option') {
                $key = isset($matches[2]) ? $matches[2] : '';
                return isset($options[$key]) ? rawurlencode((string) $options[$key]) : '';
            }
            if ($name === 'path_token') {
                return $allowPathToken ? $self->pathToken() : '';
            }
            if ($name === 'secret') { return ''; }
            return isset($config[$name]) ? rawurlencode((string) $config[$name]) : '';
        }, (string) $template);
        return $rendered === null ? '' : $rendered;
    }

    /**
     * Provider-mandated path credential (Telegram bot tokens). Public only so
     * the placeholder callback can reach it; never exposed in any response.
     *
     * @internal
     */
    public function pathToken()
    {
        $auth = $this->definition->auth();
        $prefix = isset($auth['prefix']) ? (string) $auth['prefix'] : '';
        $token = $this->secret($auth);
        if (!preg_match('/^[A-Za-z0-9_:.\-]{8,256}$/', $token)) {
            throw new InvalidArgumentException('The provider token format is not valid.');
        }
        return $prefix . $token;
    }

    private function secret(array $auth)
    {
        $key = isset($auth['secret']) ? (string) $auth['secret'] : '';
        return $key === '' ? '' : $this->requiredSecret($key);
    }

    private function requiredSecret($key)
    {
        if (!isset($this->secrets[$key]) || !is_string($this->secrets[$key]) || $this->secrets[$key] === '') {
            throw new TransportException('configuration', 'A required credential has not been configured.');
        }
        return $this->secrets[$key];
    }

    private function resolveSource($source)
    {
        $source = (string) $source;
        if (strpos($source, 'literal:') === 0) { return substr($source, 8); }
        if (strpos($source, 'option:') === 0) {
            $key = substr($source, 7);
            return isset($this->config['options'][$key]) ? (string) $this->config['options'][$key] : '';
        }
        $key = strpos($source, 'column:') === 0 ? substr($source, 7) : $source;
        return isset($this->config[$key]) ? (string) $this->config[$key] : '';
    }

    private function intConfig($key, $fallback)
    {
        return isset($this->config[$key]) && $this->config[$key] !== '' ? (int) $this->config[$key] : (int) $fallback;
    }

    private function pause($milliseconds)
    {
        $milliseconds = max(0, min(5000, (int) $milliseconds));
        if ($milliseconds > 0) { usleep($milliseconds * 1000); }
    }
}
