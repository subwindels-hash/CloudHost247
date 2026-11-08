<?php
/** Read-only Google Workspace Reseller connection check. No commercial mutations. */
namespace CloudHost247\Email\Providers;

use CloudHost247\Email\Support\Config;
use CloudHost247\Email\Support\CurlClient;
use CloudHost247\Email\Support\HttpClient;
use CloudHost247\Email\Support\Result;
use CloudHost247\Email\Support\Validator;

final class GoogleResellerConnection
{
    const SCOPE = 'https://www.googleapis.com/auth/apps.order.readonly';
    const LIST_URL = 'https://reseller.googleapis.com/apps/reseller/v1/subscriptions?maxResults=1';
    private $config;
    private $http;
    private $token;
    private $expiresAt = 0;

    public function __construct(Config $config, ?HttpClient $http = null)
    {
        $this->config = $config;
        $this->http = $http ?: new CurlClient();
    }

    /** Check delegated reseller access without recording customer data or initiating an order. */
    public function testConnection(): array
    {
        $result = $this->read(self::LIST_URL);
        if (!Result::isOk($result)) return $result;
        if (($result['data']['body']['kind'] ?? '') !== 'reseller#subscriptions') {
            return Result::fail(Result::CODE_REMOTE, 'Google returned an invalid reseller subscriptions response.');
        }
        return Result::ok([], 'Google Reseller API read-only access confirmed.');
    }

    /** Retrieve a known subscription. This does not perform any mutation or local state change. */
    public function getSubscription(string $customerId, string $subscriptionId): array
    {
        if (!$this->validId($customerId) || !$this->validId($subscriptionId)) {
            return Result::fail(Result::CODE_VALIDATION, 'Invalid customer or subscription identifier.');
        }
        $result = $this->read('https://reseller.googleapis.com/apps/reseller/v1/customers/' . rawurlencode($customerId)
            . '/subscriptions/' . rawurlencode($subscriptionId));
        if (!Result::isOk($result)) return $result;
        $body = $result['data']['body'];
        if (($body['kind'] ?? '') !== 'reseller#subscription' || empty($body['subscriptionId'])) {
            return Result::fail(Result::CODE_REMOTE, 'Google returned an invalid subscription response.');
        }
        return $result;
    }

    private function validId(string $id): bool
    {
        return $id !== '' && strlen($id) <= 191 && (bool) preg_match('/^[A-Za-z0-9._-]+$/D', $id);
    }

    private function read(string $url): array
    {
        $auth = $this->accessToken();
        if (!Result::isOk($auth)) return $auth;
        $response = $this->http->request('GET', $url, [
            'Accept' => 'application/json', 'Authorization' => 'Bearer ' . $auth['data']['token'],
        ], null, 20);
        // A read-only request may safely be retried once after an expired token.
        if ((int) $response['status'] === 401) {
            $this->token = null;
            $this->expiresAt = 0;
            $auth = $this->accessToken();
            if (!Result::isOk($auth)) return $auth;
            $response = $this->http->request('GET', $url, [
                'Accept' => 'application/json', 'Authorization' => 'Bearer ' . $auth['data']['token'],
            ], null, 20);
        }
        $status = (int) $response['status'];
        if ($status === 0) return Result::fail(Result::CODE_TRANSPORT, 'Could not reach the Google Reseller API.');
        if ($status < 200 || $status >= 300) {
            return Result::fail(AbstractProvider::mapStatus($status),
                'Google Reseller API request failed (HTTP ' . $status . '). Verify reseller access and delegated scope.');
        }
        $body = json_decode((string) $response['body'], true);
        if (!is_array($body)) return Result::fail(Result::CODE_REMOTE, 'Google returned an invalid JSON response.');
        // The caller must treat customer data as sensitive; never log raw bodies.
        return Result::ok(['body' => $body]);
    }

    private function accessToken(): array
    {
        if ($this->token !== null && time() < $this->expiresAt) {
            return Result::ok(['token' => $this->token]);
        }
        $settings = json_decode($this->config->serverAccessHash(), true);
        $settings = is_array($settings) ? $settings : [];
        $account = $settings['service_account'] ?? [];
        $subject = (string) ($settings['reseller_admin'] ?? '');
        if (!is_array($account) || !Validator::isEmail((string) ($account['client_email'] ?? ''))
            || empty($account['private_key']) || !Validator::isEmail($subject)) {
            return Result::fail(Result::CODE_CONFIG,
                'Google Reseller is not configured: set a service account and reseller_admin in the encrypted server access hash.');
        }
        if (!function_exists('openssl_sign')) return Result::fail(Result::CODE_CONFIG, 'PHP OpenSSL is required for Google authentication.');
        $assertion = GoogleWorkspaceProvider::buildAssertion($account, $subject, [self::SCOPE]);
        if (!Result::isOk($assertion)) return $assertion;
        $response = $this->http->request('POST', GoogleWorkspaceProvider::TOKEN_URL,
            ['Content-Type' => 'application/x-www-form-urlencoded', 'Accept' => 'application/json'],
            http_build_query(['grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion' => $assertion['data']['assertion']]), 20);
        $status = (int) $response['status'];
        if ($status === 0) return Result::fail(Result::CODE_TRANSPORT, 'Could not reach Google OAuth.');
        $body = json_decode((string) $response['body'], true);
        if ($status !== 200 || !is_array($body) || empty($body['access_token']) || !is_string($body['access_token'])) {
            return Result::fail(Result::CODE_PERMISSION, 'Google Reseller authentication failed. Verify the delegated reseller administrator and read-only scope.');
        }
        $ttl = isset($body['expires_in']) && is_numeric($body['expires_in']) ? (int) $body['expires_in'] : 0;
        $this->token = $body['access_token'];
        // Unknown or short expiry is never cached beyond this call.
        $this->expiresAt = time() + max(0, min($ttl, 3600) - 60);
        return Result::ok(['token' => $this->token]);
    }
}
