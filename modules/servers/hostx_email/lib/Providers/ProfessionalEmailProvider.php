<?php
/**
 * Professional Business Email adapter - configurable provisioning REST API.
 *
 * IMPORTANT: IMAP and SMTP are mail access/transfer protocols. They cannot
 * create, suspend or delete mailboxes. This adapter therefore requires a real
 * provisioning API from the mail platform or control panel (for example a
 * cPanel/DirectAdmin/Plesk email API, a mail-platform admin API, or the
 * CloudHost247 mail control plane). If no API base URL and key are configured,
 * every operation returns a configuration error - the module never pretends a
 * mailbox was created.
 *
 * Expected API contract (documented in README.md, "Professional Email API
 * contract"); paths are configurable through the server access-hash JSON:
 *
 *   POST   {base}/mailboxes                      create   -> {id,email,status,quota_mb}
 *   GET    {base}/mailboxes/{id}                 status   -> {id,email,status,usage_mb,quota_mb}
 *   GET    {base}/mailboxes?email={email}        lookup   -> {data:[...]} or {id,...}
 *   PATCH  {base}/mailboxes/{id}                 update   (suspend/unsuspend/password/plan)
 *   DELETE {base}/mailboxes/{id}                 delete
 *   GET    {base}/domains/{domain}/dns           dns      -> {records:[{type,host,value,priority,ttl}],verified}
 *   GET    {base}/plans                          plans    -> {plans:[{id,name,quota_mb}]}
 *
 * Authentication: Bearer token by default; set {"auth":"header","auth_header":
 * "X-Api-Key"} in the access-hash JSON for key-header providers.
 *
 * @package    WHMCS
 * @subpackage hostx_email
 */

namespace HostxEmail\Providers;

use HostxEmail\Dns\RecordSet;
use HostxEmail\Support\Result;
use HostxEmail\Support\Validator;

final class ProfessionalEmailProvider extends AbstractProvider
{
    public function key(): string
    {
        return 'professional';
    }

    public function label(): string
    {
        return 'Professional Business Email';
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
            'status'          => true,
            'usage'           => true,  // the contract returns usage_mb/quota_mb
            'dns'             => true,  // when the provider exposes /domains/{d}/dns
            'plans'           => true,
            'find_by_email'   => true,
        ]);
    }

    /* ------------------------------------------------------------------
     | Configuration
     * ----------------------------------------------------------------- */

    /**
     * @return array<string,mixed>
     */
    public function validateConfiguration(): array
    {
        if ($this->config->apiBaseUrl() === '') {
            return Result::fail(
                Result::CODE_CONFIG,
                'Professional Email is not configured: set the provisioning API base URL (https) in the server '
                . '"Hostname" field. IMAP/SMTP credentials cannot provision mailboxes.'
            );
        }

        if ($this->config->serverPassword() === '') {
            return Result::fail(
                Result::CODE_CONFIG,
                'Professional Email is not configured: store the provisioning API key in the server "Password" field.'
            );
        }

        return Result::ok();
    }

    /**
     * Authentication headers for the configured auth style.
     *
     * @return array<string,string>
     */
    private function authHeaders(): array
    {
        $json = $this->accessHashJson();
        $style = strtolower((string) ($json['auth'] ?? 'bearer'));
        $key = $this->config->serverPassword();

        if ($style === 'header') {
            $header = (string) ($json['auth_header'] ?? 'X-Api-Key');
            $header = preg_match('/^[A-Za-z0-9\-]{1,64}$/', $header) ? $header : 'X-Api-Key';

            return [$header => $key];
        }

        if ($style === 'basic') {
            $user = $this->config->serverUsername();

            return ['Authorization' => 'Basic ' . base64_encode($user . ':' . $key)];
        }

        return ['Authorization' => 'Bearer ' . $key];
    }

    /**
     * Endpoint path, overridable per provider through the access-hash JSON
     * {"paths": {"create": "/v2/accounts", ...}}.
     */
    private function path(string $name, string $default): string
    {
        $json = $this->accessHashJson();
        $paths = isset($json['paths']) && is_array($json['paths']) ? $json['paths'] : [];
        $path = (string) ($paths[$name] ?? $default);

        return '/' . ltrim($path, '/');
    }

    /**
     * @param  array<string,mixed>|null $json
     * @return array<string,mixed>
     */
    private function api(string $method, string $path, ?array $json = null, bool $mutating = false, string $event = ''): array
    {
        $configured = $this->validateConfiguration();

        if (!Result::isOk($configured)) {
            return $configured;
        }

        return $this->call(
            $method,
            $this->config->apiBaseUrl() . $path,
            $this->authHeaders(),
            $json,
            $mutating,
            $event !== '' ? $event : 'professional.' . strtolower($method)
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

        $result = $this->api('GET', $this->path('plans', '/plans'), null, false, 'professional.test');

        if (!Result::isOk($result)) {
            return $result;
        }

        $plans = (array) ($result['data']['body']['plans'] ?? $result['data']['body']['data'] ?? []);

        return Result::ok(
            ['plans' => count($plans)],
            sprintf('Connected to the Professional Email API (%d plan(s) reported).', count($plans))
        );
    }

    public function listPlans(): array
    {
        $result = $this->api('GET', $this->path('plans', '/plans'), null, false, 'professional.plans');

        if (!Result::isOk($result)) {
            return $result;
        }

        $raw = (array) ($result['data']['body']['plans'] ?? $result['data']['body']['data'] ?? []);
        $plans = [];

        foreach ($raw as $plan) {
            if (!is_array($plan)) {
                continue;
            }

            $plans[] = [
                'id'       => (string) ($plan['id'] ?? $plan['sku'] ?? ''),
                'name'     => (string) ($plan['name'] ?? $plan['id'] ?? ''),
                'quota_mb' => isset($plan['quota_mb']) ? (int) $plan['quota_mb'] : null,
            ];
        }

        return Result::ok(['plans' => $plans]);
    }

    public function checkAvailability(string $sku): array
    {
        if ($sku === '') {
            // Not every mail platform has plan ids; that is legitimate.
            return Result::ok(['checked' => false, 'available' => null]);
        }

        $plans = $this->listPlans();

        if (!Result::isOk($plans)) {
            // Availability is advisory here: a provider without /plans must not
            // block provisioning.
            return Result::ok(['checked' => false, 'available' => null], $plans['message']);
        }

        foreach ($plans['data']['plans'] as $plan) {
            if (strcasecmp((string) $plan['id'], $sku) === 0 || strcasecmp((string) $plan['name'], $sku) === 0) {
                return Result::ok(['checked' => true, 'available' => true, 'sku_id' => $plan['id']]);
            }
        }

        return Result::fail(
            Result::CODE_CONFIG,
            sprintf('The plan "%s" was not found on the Professional Email provider.', Validator::text($sku, 64))
        );
    }

    /**
     * @param array<string,mixed> $spec
     */
    public function createAccount(array $spec): array
    {
        $email = (string) ($spec['email'] ?? '');

        if (!Validator::isEmail($email)) {
            return Result::fail(Result::CODE_VALIDATION, 'A valid mailbox address is required.');
        }

        $check = Validator::checkPassword((string) ($spec['password'] ?? ''));

        if (!$check['valid']) {
            return Result::fail(Result::CODE_VALIDATION, $check['reason']);
        }

        $payload = [
            'email'        => $email,
            'domain'       => explode('@', $email)[1],
            'display_name' => (string) ($spec['display_name'] ?? ''),
            'password'     => (string) $spec['password'],
            'plan'         => (string) ($spec['sku'] ?? ''),
            'quota_mb'     => isset($spec['quota_mb']) ? (int) $spec['quota_mb'] : null,
            'reference'    => (string) ($spec['reference'] ?? ''),
        ];

        $created = $this->api('POST', $this->path('create', '/mailboxes'), array_filter($payload, static function ($value) {
            return $value !== null && $value !== '';
        }), true, 'professional.create');

        if (!Result::isOk($created)) {
            if (($created['code'] ?? '') === Result::CODE_CONFLICT) {
                $existing = $this->findByEmail($email);

                if (Result::isOk($existing)) {
                    return Result::ok($existing['data'] + ['adopted' => true], 'An existing mailbox was adopted.');
                }
            }

            return $created;
        }

        $body = (array) ($created['data']['body'] ?? []);
        $remoteId = (string) ($body['id'] ?? $body['mailbox_id'] ?? '');

        return Result::ok([
            'remote_id'        => $remoteId !== '' ? $remoteId : $email,
            'email'            => (string) ($body['email'] ?? $email),
            'status'           => (string) ($body['status'] ?? 'active'),
            'storage_quota_mb' => isset($body['quota_mb']) ? (int) $body['quota_mb'] : null,
        ]);
    }

    public function findByEmail(string $email): array
    {
        if (!Validator::isEmail($email)) {
            return Result::fail(Result::CODE_VALIDATION, 'A valid address is required.');
        }

        $result = $this->api(
            'GET',
            $this->path('lookup', '/mailboxes') . '?email=' . rawurlencode($email),
            null,
            false,
            'professional.lookup'
        );

        if (!Result::isOk($result)) {
            return $result;
        }

        $body = (array) ($result['data']['body'] ?? []);
        $record = $body;

        if (isset($body['data'][0]) && is_array($body['data'][0])) {
            $record = $body['data'][0];
        }

        if (empty($record['id']) && empty($record['email'])) {
            return Result::fail(Result::CODE_NOT_FOUND, 'No mailbox with that address exists on the provider.');
        }

        return Result::ok([
            'remote_id' => (string) ($record['id'] ?? $email),
            'email'     => (string) ($record['email'] ?? $email),
            'status'    => (string) ($record['status'] ?? 'active'),
        ]);
    }

    /**
     * @param array<string,mixed> $account
     */
    public function suspendAccount(array $account): array
    {
        return $this->patch($account, ['status' => 'suspended'], 'professional.suspend');
    }

    /**
     * @param array<string,mixed> $account
     */
    public function unsuspendAccount(array $account): array
    {
        return $this->patch($account, ['status' => 'active'], 'professional.unsuspend');
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

        return $this->patch($account, [
            'password'      => $password,
            'force_change'  => $forceChange,
        ], 'professional.change_password');
    }

    /**
     * @param array<string,mixed> $account
     */
    public function terminateAccount(array $account): array
    {
        $reference = $this->remoteRef($account);

        if ($reference === '') {
            return Result::fail(Result::CODE_NOT_FOUND, 'No mailbox is recorded for this service.');
        }

        $result = $this->api(
            'DELETE',
            $this->path('delete', '/mailboxes') . '/' . rawurlencode($reference),
            null,
            true,
            'professional.delete'
        );

        if (!Result::isOk($result) && ($result['code'] ?? '') === Result::CODE_NOT_FOUND) {
            return Result::ok([], 'The mailbox no longer exists on the provider.');
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
            return Result::fail(Result::CODE_NOT_FOUND, 'No mailbox is recorded for this service.');
        }

        $result = $this->api(
            'GET',
            $this->path('status', '/mailboxes') . '/' . rawurlencode($reference),
            null,
            false,
            'professional.status'
        );

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
            'email'            => (string) ($body['email'] ?? ''),
            'status'           => (string) ($body['status'] ?? 'active'),
            'license_state'    => 'n/a',
            'storage_used_mb'  => isset($body['usage_mb']) ? (int) $body['usage_mb'] : null,
            'storage_quota_mb' => isset($body['quota_mb']) ? (int) $body['quota_mb'] : null,
        ]);
    }

    /**
     * DNS records as published by the provider, falling back to records the
     * administrator configured. Never invented.
     */
    public function dnsRecords(string $domain): array
    {
        $domain = Validator::normaliseDomain($domain);

        if (!Validator::isDomain($domain)) {
            return Result::fail(Result::CODE_VALIDATION, 'A valid domain is required.');
        }

        $result = $this->api(
            'GET',
            $this->path('dns', '/domains') . '/' . rawurlencode($domain) . '/dns',
            null,
            false,
            'professional.dns'
        );

        if (Result::isOk($result)) {
            $body = (array) ($result['data']['body'] ?? []);
            $rows = (array) ($body['records'] ?? []);

            $set = new RecordSet(RecordSet::SOURCE_PROVIDER, isset($body['verified']) ? (bool) $body['verified'] : null);

            foreach ($rows as $row) {
                if (!is_array($row)) {
                    continue;
                }

                $type = (string) ($row['type'] ?? '');
                $host = (string) ($row['host'] ?? '@');
                $value = (string) ($row['value'] ?? '');

                $set->add(
                    $type,
                    $host,
                    $value,
                    isset($row['priority']) ? (int) $row['priority'] : null,
                    isset($row['ttl']) ? (int) $row['ttl'] : null,
                    RecordSet::classify($type, $host, $value)
                );
            }

            if (!$set->isEmpty()) {
                return Result::ok(['records' => $set, 'verified' => $set->verified()]);
            }
        }

        $configured = $this->configuredDnsRecords($domain);

        if (!$configured->isEmpty()) {
            return Result::ok(['records' => $configured, 'verified' => null]);
        }

        return Result::fail(
            Result::CODE_NOT_SUPPORTED,
            'The Professional Email provider did not return DNS records for this domain, and none are configured '
            . 'on the server profile.'
        );
    }

    /**
     * @param array<string,mixed> $account
     */
    public function loginUrl(array $account): string
    {
        $override = $this->config->loginUrlOverride();

        if ($override !== '') {
            return $override;
        }

        $json = $this->accessHashJson();
        $webmail = (string) ($json['webmail_url'] ?? '');

        if (stripos($webmail, 'https://') === 0) {
            return $webmail;
        }

        $base = $this->config->apiBaseUrl();

        // No canonical webmail URL: return the configured base, or empty so the
        // UI hides the button rather than linking somewhere wrong.
        return $base !== '' && isset($json['webmail_path']) && is_string($json['webmail_path'])
            ? $base . '/' . ltrim($json['webmail_path'], '/')
            : '';
    }

    /**
     * @param array<string,mixed> $account
     * @param array<string,mixed> $payload
     */
    private function patch(array $account, array $payload, string $event): array
    {
        $reference = $this->remoteRef($account);

        if ($reference === '') {
            return Result::fail(Result::CODE_NOT_FOUND, 'No mailbox is recorded for this service.');
        }

        return $this->api(
            'PATCH',
            $this->path('update', '/mailboxes') . '/' . rawurlencode($reference),
            $payload,
            true,
            $event
        );
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
