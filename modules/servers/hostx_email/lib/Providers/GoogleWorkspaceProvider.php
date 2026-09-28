<?php
/**
 * Google Workspace adapter - Admin SDK Directory API + Enterprise License
 * Manager API.
 *
 * Authentication: service account with domain-wide delegation. The module
 * builds and signs an RS256 JWT assertion (RFC 7523) with the service-account
 * private key and exchanges it for an access token, impersonating the delegated
 * administrator ("sub" claim).
 *
 * Required setup, all of which must be performed by the customer's Workspace
 * super administrator - a service account NEVER gains access on its own:
 *   1. Create the service account and enable domain-wide delegation.
 *   2. In the Workspace Admin console (Security > API controls > Domain-wide
 *      delegation) authorise the client id for these scopes:
 *        https://www.googleapis.com/auth/admin.directory.user
 *        https://www.googleapis.com/auth/apps.licensing
 *   3. Provide a delegated administrator address to impersonate.
 *
 * If step 2 or 3 is missing, Google answers 401/403 "unauthorized_client" and
 * the adapter surfaces that as a configuration/permission error rather than
 * pretending the account was provisioned.
 *
 * @package    WHMCS
 * @subpackage hostx_email
 */

namespace HostxEmail\Providers;

use HostxEmail\Dns\RecordSet;
use HostxEmail\Support\Logger;
use HostxEmail\Support\Result;
use HostxEmail\Support\Validator;

final class GoogleWorkspaceProvider extends AbstractProvider
{
    const TOKEN_URL   = 'https://oauth2.googleapis.com/token';
    const DIRECTORY   = 'https://admin.googleapis.com/admin/directory/v1';
    const LICENSING   = 'https://licensing.googleapis.com/apps/licensing/v1';

    /**
     * Scopes requested in the assertion. Kept minimal on purpose.
     *
     * @var array<int,string>
     */
    const SCOPES = [
        'https://www.googleapis.com/auth/admin.directory.user',
        'https://www.googleapis.com/auth/apps.licensing',
    ];

    /** @var string|null */
    private $token;

    public function key(): string
    {
        return 'google';
    }

    public function label(): string
    {
        return 'Google Workspace';
    }

    /**
     * @return array<string,bool>
     */
    public function capabilities(): array
    {
        return array_merge(parent::capabilities(), [
            'create'          => true,
            'suspend'         => true,
            'unsuspend'       => true,
            'terminate'       => true,
            'change_password' => true,
            'assign_license'  => true,
            'remove_license'  => true,
            'status'          => true,
            'usage'           => false, // Directory API does not expose mailbox usage
            'dns'             => false, // Google publishes records in the Admin console, not via this API
            'plans'           => false, // licence SKUs are mapped by the administrator
            'find_by_email'   => true,
        ]);
    }

    /* ------------------------------------------------------------------
     | Service-account configuration
     * ----------------------------------------------------------------- */

    /**
     * The service-account JSON, taken from the WHMCS-encrypted access hash
     * field. Never logged, never written to our tables.
     *
     * @return array<string,mixed>
     */
    private function serviceAccount(): array
    {
        $json = $this->accessHashJson();

        if (isset($json['service_account']) && is_array($json['service_account'])) {
            return $json['service_account'];
        }

        return $json;
    }

    private function delegatedAdmin(): string
    {
        $configured = $this->config->serverUsername();

        if (Validator::isEmail($configured)) {
            return strtolower($configured);
        }

        $json = $this->accessHashJson();
        $subject = (string) ($json['delegated_admin'] ?? '');

        return Validator::isEmail($subject) ? strtolower($subject) : '';
    }

    /**
     * Licence product id (defaults to the Workspace product) - configurable
     * because Google uses different product ids for Workspace, Cloud Identity
     * and legacy G Suite.
     */
    private function productId(): string
    {
        $json = $this->accessHashJson();
        $product = (string) ($json['license_product_id'] ?? 'Google-Apps');

        return Validator::isSku($product) ? $product : 'Google-Apps';
    }

    /**
     * @return array<string,mixed>
     */
    public function validateConfiguration(): array
    {
        $account = $this->serviceAccount();
        $missing = [];

        if (empty($account['client_email']) || !Validator::isEmail((string) $account['client_email'])) {
            $missing[] = 'service-account client_email';
        }

        if (empty($account['private_key']) || strpos((string) $account['private_key'], 'PRIVATE KEY') === false) {
            $missing[] = 'service-account private_key';
        }

        if ($this->delegatedAdmin() === '') {
            $missing[] = 'delegated administrator address (server "Username" field)';
        }

        if ($missing) {
            return Result::fail(
                Result::CODE_CONFIG,
                'Google Workspace is not configured. Missing: ' . implode(', ', $missing)
                . '. Paste the service-account JSON into the server "Access hash" field.'
            );
        }

        if (!function_exists('openssl_sign')) {
            return Result::fail(
                Result::CODE_CONFIG,
                'The PHP OpenSSL extension is required to sign Google service-account assertions.'
            );
        }

        return Result::ok();
    }

    /**
     * Build the signed JWT assertion.
     *
     * Pure-ish helper (no network) so the tests can assert the claim set.
     *
     * @param  array<string,mixed> $serviceAccount
     * @return array<string,mixed> Result; data.assertion
     */
    public static function buildAssertion(array $serviceAccount, string $subject, array $scopes, int $now = 0): array
    {
        $now = $now > 0 ? $now : time();

        $header = ['alg' => 'RS256', 'typ' => 'JWT'];

        $claims = [
            'iss'   => (string) ($serviceAccount['client_email'] ?? ''),
            'sub'   => $subject,
            'scope' => implode(' ', $scopes),
            'aud'   => self::TOKEN_URL,
            'iat'   => $now,
            'exp'   => $now + 3600,
        ];

        $segments = [
            self::base64Url((string) json_encode($header)),
            self::base64Url((string) json_encode($claims)),
        ];

        $input = implode('.', $segments);
        $signature = '';

        $key = openssl_pkey_get_private((string) ($serviceAccount['private_key'] ?? ''));

        if ($key === false) {
            return Result::fail(Result::CODE_CONFIG, 'The Google service-account private key could not be parsed.');
        }

        $signed = openssl_sign($input, $signature, $key, 'sha256WithRSAEncryption');

        if (PHP_VERSION_ID < 80000 && is_resource($key)) {
            // openssl_free_key is deprecated from PHP 8.0 where keys are objects.
            openssl_free_key($key);
        }

        if (!$signed) {
            return Result::fail(Result::CODE_CONFIG, 'The Google service-account assertion could not be signed.');
        }

        return Result::ok(['assertion' => $input . '.' . self::base64Url($signature), 'claims' => $claims]);
    }

    public static function base64Url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    /**
     * @return array<string,mixed> Result; data.token
     */
    private function token(): array
    {
        if ($this->token !== null) {
            return Result::ok(['token' => $this->token]);
        }

        $configured = $this->validateConfiguration();

        if (!Result::isOk($configured)) {
            return $configured;
        }

        $assertion = self::buildAssertion($this->serviceAccount(), $this->delegatedAdmin(), self::SCOPES);

        if (!Result::isOk($assertion)) {
            return $assertion;
        }

        $form = http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion'  => $assertion['data']['assertion'],
        ]);

        $response = $this->http->request(
            'POST',
            self::TOKEN_URL,
            ['Content-Type' => 'application/x-www-form-urlencoded', 'Accept' => 'application/json'],
            $form,
            $this->timeout
        );

        Logger::moduleCall('google.token', [
            'url'     => self::TOKEN_URL,
            'iss'     => $assertion['data']['claims']['iss'],
            'sub'     => $assertion['data']['claims']['sub'],
            'scope'   => $assertion['data']['claims']['scope'],
        ], [
            'status' => $response['status'],
            'error'  => $response['error'],
        ]);

        if ((int) $response['status'] === 0) {
            return Result::fail(
                Result::CODE_TRANSPORT,
                'Could not reach Google OAuth: ' . ($response['error'] ?: 'connection failed')
            );
        }

        $body = json_decode((string) $response['body'], true);
        $body = is_array($body) ? $body : [];

        if ((int) $response['status'] !== 200 || empty($body['access_token'])) {
            $error = (string) ($body['error'] ?? 'authentication failed');
            $description = (string) ($body['error_description'] ?? '');

            if ($error === 'unauthorized_client') {
                return Result::fail(
                    Result::CODE_PERMISSION,
                    'Google refused the service account (unauthorized_client). The Workspace super administrator must '
                    . 'authorise this service-account client id for the admin.directory.user and apps.licensing scopes '
                    . 'under Security > API controls > Domain-wide delegation, and the delegated administrator address '
                    . 'must exist in that tenant.'
                );
            }

            return Result::fail(
                Result::CODE_PERMISSION,
                'Google Workspace authentication failed: ' . substr($error . ($description !== '' ? ' - ' . $description : ''), 0, 240)
            );
        }

        $this->token = (string) $body['access_token'];

        return Result::ok(['token' => $this->token]);
    }

    /**
     * @param  array<string,mixed>|null $json
     * @return array<string,mixed>
     */
    private function api(string $method, string $url, ?array $json = null, bool $mutating = false, string $event = ''): array
    {
        $token = $this->token();

        if (!Result::isOk($token)) {
            return $token;
        }

        return $this->call(
            $method,
            $url,
            ['Authorization' => 'Bearer ' . $token['data']['token']],
            $json,
            $mutating,
            $event !== '' ? $event : 'google.' . strtolower($method)
        );
    }

    /* ------------------------------------------------------------------
     | Operations
     * ----------------------------------------------------------------- */

    public function testConnection(): array
    {
        $configured = $this->validateConfiguration();

        if (!Result::isOk($configured)) {
            return $configured;
        }

        $admin = $this->delegatedAdmin();
        $result = $this->api('GET', self::DIRECTORY . '/users/' . rawurlencode($admin), null, false, 'google.test');

        if (!Result::isOk($result)) {
            return $result;
        }

        $body = (array) ($result['data']['body'] ?? []);

        return Result::ok(
            [
                'admin'      => $admin,
                'is_admin'   => !empty($body['isAdmin']),
                'customer_id' => (string) ($body['customerId'] ?? ''),
            ],
            sprintf(
                'Connected to Google Workspace as %s%s.',
                $admin,
                !empty($body['isAdmin']) ? ' (administrator)' : ' (WARNING: this account is not an administrator)'
            )
        );
    }

    /**
     * @param array<string,mixed> $spec
     */
    public function createAccount(array $spec): array
    {
        $email = (string) ($spec['email'] ?? '');

        if (!Validator::isEmail($email)) {
            return Result::fail(Result::CODE_VALIDATION, 'A valid primary email address is required.');
        }

        $password = (string) ($spec['password'] ?? '');
        $check = Validator::checkPassword($password);

        if (!$check['valid']) {
            return Result::fail(Result::CODE_VALIDATION, $check['reason']);
        }

        $displayName = (string) ($spec['display_name'] ?? explode('@', $email)[0]);
        $nameParts = explode(' ', trim($displayName), 2);

        $payload = [
            'primaryEmail' => $email,
            'name'         => [
                'givenName'  => $nameParts[0] !== '' ? $nameParts[0] : 'Mailbox',
                'familyName' => isset($nameParts[1]) && $nameParts[1] !== '' ? $nameParts[1] : 'User',
            ],
            'password'                  => $password,
            'changePasswordAtNextLogin' => !empty($spec['force_change']),
        ];

        $created = $this->api('POST', self::DIRECTORY . '/users', $payload, true, 'google.create_user');

        if (!Result::isOk($created)) {
            if (($created['code'] ?? '') === Result::CODE_CONFLICT) {
                $existing = $this->findByEmail($email);

                if (Result::isOk($existing)) {
                    return Result::ok(
                        $existing['data'] + ['adopted' => true],
                        'An existing Google Workspace user with this address was adopted instead of creating a duplicate.'
                    );
                }
            }

            return $created;
        }

        $body = (array) ($created['data']['body'] ?? []);
        $remoteId = (string) ($body['id'] ?? '');

        $result = [
            'remote_id' => $remoteId !== '' ? $remoteId : $email,
            'email'     => (string) ($body['primaryEmail'] ?? $email),
            'status'    => 'active',
        ];

        $sku = (string) ($spec['sku'] ?? '');

        if ($sku !== '') {
            $licence = $this->assignLicense(['email' => $result['email']], $sku);

            if (!Result::isOk($licence)) {
                return Result::fail(
                    (string) $licence['code'],
                    'The Google Workspace user was created but the licence could not be assigned: ' . $licence['message'],
                    $result + ['license_state' => 'unassigned'],
                    (bool) ($licence['uncertain'] ?? false)
                );
            }

            $result['license_state'] = 'assigned';
        }

        return Result::ok($result);
    }

    public function findByEmail(string $email): array
    {
        if (!Validator::isEmail($email)) {
            return Result::fail(Result::CODE_VALIDATION, 'A valid address is required.');
        }

        $result = $this->api('GET', self::DIRECTORY . '/users/' . rawurlencode($email), null, false, 'google.get_user');

        if (!Result::isOk($result)) {
            return $result;
        }

        $body = (array) ($result['data']['body'] ?? []);

        return Result::ok([
            'remote_id' => (string) ($body['id'] ?? $email),
            'email'     => (string) ($body['primaryEmail'] ?? $email),
            'status'    => !empty($body['suspended']) ? 'suspended' : 'active',
        ]);
    }

    /**
     * @param array<string,mixed> $account
     */
    public function suspendAccount(array $account): array
    {
        return $this->updateUser($account, ['suspended' => true], 'google.suspend');
    }

    /**
     * @param array<string,mixed> $account
     */
    public function unsuspendAccount(array $account): array
    {
        return $this->updateUser($account, ['suspended' => false], 'google.unsuspend');
    }

    /**
     * @param array<string,mixed> $account
     */
    public function changePassword(array $account, string $password, bool $forceChange = false): array
    {
        $check = Validator::checkPassword($password);

        if (!$check['valid']) {
            return Result::fail(Result::CODE_VALIDATION, $check['reason']);
        }

        return $this->updateUser($account, [
            'password'                  => $password,
            'changePasswordAtNextLogin' => $forceChange,
        ], 'google.change_password');
    }

    /**
     * @param array<string,mixed> $account
     */
    public function terminateAccount(array $account): array
    {
        $reference = $this->remoteRef($account);

        if ($reference === '') {
            return Result::fail(Result::CODE_NOT_FOUND, 'No Google Workspace user is recorded for this service.');
        }

        $sku = (string) ($account['plan_sku'] ?? '');

        if ($sku !== '') {
            $this->removeLicense($account, $sku);
        }

        $deleted = $this->api('DELETE', self::DIRECTORY . '/users/' . rawurlencode($reference), null, true, 'google.delete_user');

        if (!Result::isOk($deleted) && ($deleted['code'] ?? '') === Result::CODE_NOT_FOUND) {
            return Result::ok([], 'The Google Workspace user no longer exists.');
        }

        return $deleted;
    }

    /**
     * @param array<string,mixed> $account
     */
    public function assignLicense(array $account, string $sku): array
    {
        $email = strtolower((string) ($account['email'] ?? ''));

        if (!Validator::isEmail($email) || !Validator::isSku($sku)) {
            return Result::fail(Result::CODE_VALIDATION, 'A Google user address and licence SKU are required.');
        }

        $url = sprintf(
            '%s/product/%s/sku/%s/user',
            self::LICENSING,
            rawurlencode($this->productId()),
            rawurlencode($sku)
        );

        $result = $this->api('POST', $url, ['userId' => $email], true, 'google.assign_license');

        if (!Result::isOk($result) && ($result['code'] ?? '') === Result::CODE_CONFLICT) {
            // Already licensed: idempotent success.
            return Result::ok([], 'The user already holds this licence.');
        }

        return $result;
    }

    /**
     * @param array<string,mixed> $account
     */
    public function removeLicense(array $account, string $sku): array
    {
        $email = strtolower((string) ($account['email'] ?? ''));

        if (!Validator::isEmail($email) || !Validator::isSku($sku)) {
            return Result::fail(Result::CODE_VALIDATION, 'A Google user address and licence SKU are required.');
        }

        $url = sprintf(
            '%s/product/%s/sku/%s/user/%s',
            self::LICENSING,
            rawurlencode($this->productId()),
            rawurlencode($sku),
            rawurlencode($email)
        );

        $result = $this->api('DELETE', $url, null, true, 'google.remove_license');

        if (!Result::isOk($result) && ($result['code'] ?? '') === Result::CODE_NOT_FOUND) {
            return Result::ok([], 'No such licence assignment; nothing to remove.');
        }

        return $result;
    }

    /**
     * @param array<string,mixed> $account
     */
    public function getStatus(array $account): array
    {
        $reference = $this->remoteRef($account);

        if ($reference === '') {
            return Result::fail(Result::CODE_NOT_FOUND, 'No Google Workspace user is recorded for this service.');
        }

        $result = $this->api('GET', self::DIRECTORY . '/users/' . rawurlencode($reference), null, false, 'google.status');

        if (!Result::isOk($result)) {
            if (($result['code'] ?? '') === Result::CODE_NOT_FOUND) {
                return Result::ok(['exists' => false, 'status' => 'missing']);
            }

            return $result;
        }

        $body = (array) ($result['data']['body'] ?? []);

        return Result::ok([
            'exists'           => true,
            'remote_id'        => (string) ($body['id'] ?? $reference),
            'email'            => (string) ($body['primaryEmail'] ?? ''),
            'status'           => !empty($body['suspended']) ? 'suspended' : 'active',
            'license_state'    => 'unknown', // licence assignments are a separate API read
            'storage_used_mb'  => null,
            'storage_quota_mb' => null,
        ]);
    }

    /**
     * Google publishes the MX/SPF/DKIM values for a tenant in the Admin
     * console, not through the Directory API. Rather than hardcode values that
     * may differ per tenant, the module renders records the administrator
     * configured on the server (Access hash JSON, "dns" key).
     */
    public function dnsRecords(string $domain): array
    {
        $domain = Validator::normaliseDomain($domain);

        if (!Validator::isDomain($domain)) {
            return Result::fail(Result::CODE_VALIDATION, 'A valid domain is required.');
        }

        $set = $this->configuredDnsRecords($domain);

        if ($set->isEmpty()) {
            return Result::fail(
                Result::CODE_NOT_SUPPORTED,
                'Google Workspace does not publish DNS records through the Admin SDK. Copy the MX, SPF and DKIM values '
                . 'shown in your Google Admin console into the module server configuration to display them here.'
            );
        }

        return Result::ok(['records' => $set, 'verified' => null]);
    }

    /**
     * @param array<string,mixed> $account
     */
    public function loginUrl(array $account): string
    {
        $domain = (string) ($account['domain'] ?? '');

        return $domain !== ''
            ? 'https://mail.google.com/a/' . rawurlencode($domain)
            : 'https://mail.google.com/';
    }

    /**
     * @param array<string,mixed> $account
     * @param array<string,mixed> $payload
     */
    private function updateUser(array $account, array $payload, string $event): array
    {
        $reference = $this->remoteRef($account);

        if ($reference === '') {
            return Result::fail(Result::CODE_NOT_FOUND, 'No Google Workspace user is recorded for this service.');
        }

        return $this->api('PUT', self::DIRECTORY . '/users/' . rawurlencode($reference), $payload, true, $event);
    }

    /**
     * @param array<string,mixed> $account
     */
    private function remoteRef(array $account): string
    {
        $id = trim((string) ($account['remote_id'] ?? ''));

        if ($id !== '') {
            return $id;
        }

        $email = trim((string) ($account['email'] ?? ''));

        return Validator::isEmail($email) ? $email : '';
    }
}
