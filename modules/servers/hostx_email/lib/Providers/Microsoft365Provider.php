<?php
/**
 * Microsoft 365 adapter - Microsoft Graph v1.0.
 *
 * Authentication: OAuth 2.0 client credentials (application permissions), i.e.
 *   POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 *        grant_type=client_credentials&scope=https://graph.microsoft.com/.default
 *
 * Required application permissions (admin consented):
 *   User.ReadWrite.All           create/update/delete users, block sign-in
 *   Organization.Read.All        read subscribedSkus (licence availability)
 *   Directory.Read.All           read assignedLicenses
 *   Domain.Read.All              read domain verification + service records
 *
 * Deliberately NOT assumed:
 *   - that every tenant has spare seats: assignLicense is preceded by a
 *     subscribedSkus check (prepaidUnits.enabled - consumedUnits);
 *   - that mailbox usage is available: Graph exposes it only through the
 *     Reports API with Reports.Read.All and tenant-level CSV reports, so
 *     'usage' is reported as unsupported rather than guessed;
 *   - that password writes are always permitted: a federated/synced tenant
 *     rejects them, and the resulting Graph error is surfaced verbatim.
 *
 * @package    WHMCS
 * @subpackage hostx_email
 */

namespace HostxEmail\Providers;

use HostxEmail\Dns\RecordSet;
use HostxEmail\Support\Logger;
use HostxEmail\Support\Result;
use HostxEmail\Support\Validator;

final class Microsoft365Provider extends AbstractProvider
{
    const LOGIN_HOST = 'https://login.microsoftonline.com';
    const GRAPH      = 'https://graph.microsoft.com/v1.0';

    /** @var string|null Cached access token for this request only. */
    private $token;

    public function key(): string
    {
        return 'microsoft365';
    }

    public function label(): string
    {
        return 'Microsoft 365';
    }

    /**
     * @return array<string,bool>
     */
    public function capabilities(): array
    {
        return array_merge(parent::capabilities(), [
            'create'          => true,
            'suspend'         => true,   // accountEnabled = false (sign-in block)
            'unsuspend'       => true,
            'terminate'       => true,
            'change_password' => true,   // cloud-only accounts; federated tenants refuse
            'assign_license'  => true,
            'remove_license'  => true,
            'status'          => true,
            'usage'           => false,  // needs the Reports API + Reports.Read.All
            'dns'             => true,   // /domains/{id}/serviceConfigurationRecords
            'plans'           => true,   // /subscribedSkus
            'find_by_email'   => true,
        ]);
    }

    /* ------------------------------------------------------------------
     | Configuration and authentication
     * ----------------------------------------------------------------- */

    private function tenantId(): string
    {
        $tenant = $this->config->serverAccessHash();

        if ($tenant !== '' && strpos($tenant, '{') === 0) {
            $json = $this->accessHashJson();
            $tenant = (string) ($json['tenant_id'] ?? '');
        }

        $tenant = trim($tenant);

        return preg_match('/^[A-Za-z0-9\-\.]{3,128}$/', $tenant) ? $tenant : '';
    }

    /**
     * @return array<string,mixed>
     */
    public function validateConfiguration(): array
    {
        $missing = [];

        if ($this->tenantId() === '') {
            $missing[] = 'Tenant ID (server "Access hash" field)';
        }

        if ($this->config->serverUsername() === '') {
            $missing[] = 'Application (client) ID (server "Username" field)';
        }

        if ($this->config->serverPassword() === '') {
            $missing[] = 'Client secret (server "Password" field)';
        }

        if ($missing) {
            return Result::fail(
                Result::CODE_CONFIG,
                'Microsoft 365 is not configured. Missing: ' . implode(', ', $missing) . '.'
            );
        }

        return Result::ok();
    }

    /**
     * Acquire an application access token.
     *
     * @return array<string,mixed> Result; data.token on success
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

        $url = self::LOGIN_HOST . '/' . rawurlencode($this->tenantId()) . '/oauth2/v2.0/token';

        $form = http_build_query([
            'client_id'     => $this->config->serverUsername(),
            'client_secret' => $this->config->serverPassword(),
            'scope'         => 'https://graph.microsoft.com/.default',
            'grant_type'    => 'client_credentials',
        ]);

        $response = $this->http->request(
            'POST',
            $url,
            ['Content-Type' => 'application/x-www-form-urlencoded', 'Accept' => 'application/json'],
            $form,
            $this->timeout
        );

        // The token request body contains the client secret: log only metadata.
        Logger::moduleCall('microsoft365.token', [
            'url'       => $url,
            'client_id' => $this->config->serverUsername(),
            'scope'     => 'https://graph.microsoft.com/.default',
        ], [
            'status' => $response['status'],
            'error'  => $response['error'],
        ]);

        if ((int) $response['status'] === 0) {
            return Result::fail(
                Result::CODE_TRANSPORT,
                'Could not reach Microsoft identity platform: ' . ($response['error'] ?: 'connection failed')
            );
        }

        $body = json_decode((string) $response['body'], true);
        $body = is_array($body) ? $body : [];

        if ((int) $response['status'] !== 200 || empty($body['access_token'])) {
            $description = (string) ($body['error_description'] ?? $body['error'] ?? 'authentication failed');

            return Result::fail(
                Result::CODE_PERMISSION,
                'Microsoft 365 authentication failed: ' . substr(strtok($description, "\r\n") ?: $description, 0, 220)
            );
        }

        $this->token = (string) $body['access_token'];

        return Result::ok(['token' => $this->token]);
    }

    /**
     * Authenticated Graph call.
     *
     * @param  array<string,mixed>|null $json
     * @return array<string,mixed>
     */
    private function graph(string $method, string $path, ?array $json = null, bool $mutating = false): array
    {
        $token = $this->token();

        if (!Result::isOk($token)) {
            return $token;
        }

        return $this->call(
            $method,
            self::GRAPH . $path,
            ['Authorization' => 'Bearer ' . $token['data']['token'], 'ConsistencyLevel' => 'eventual'],
            $json,
            $mutating,
            'microsoft365.' . trim(strtolower($method . '_' . trim(explode('?', $path)[0], '/')), '_')
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

        $organisation = $this->graph('GET', '/organization?$select=id,displayName');

        if (!Result::isOk($organisation)) {
            return $organisation;
        }

        $skus = $this->graph('GET', '/subscribedSkus');
        $available = [];

        if (Result::isOk($skus)) {
            foreach ((array) ($skus['data']['body']['value'] ?? []) as $sku) {
                $available[] = [
                    'sku_id'        => (string) ($sku['skuId'] ?? ''),
                    'sku_part'      => (string) ($sku['skuPartNumber'] ?? ''),
                    'enabled'       => (int) ($sku['prepaidUnits']['enabled'] ?? 0),
                    'consumed'      => (int) ($sku['consumedUnits'] ?? 0),
                ];
            }
        }

        $tenantName = (string) ($organisation['data']['body']['value'][0]['displayName'] ?? 'tenant');

        return Result::ok(
            ['tenant' => $tenantName, 'skus' => $available],
            sprintf('Connected to Microsoft 365 tenant "%s" (%d subscribed SKU(s)).', $tenantName, count($available))
        );
    }

    public function listPlans(): array
    {
        $skus = $this->graph('GET', '/subscribedSkus');

        if (!Result::isOk($skus)) {
            return $skus;
        }

        $plans = [];

        foreach ((array) ($skus['data']['body']['value'] ?? []) as $sku) {
            $enabled = (int) ($sku['prepaidUnits']['enabled'] ?? 0);
            $consumed = (int) ($sku['consumedUnits'] ?? 0);

            $plans[] = [
                'id'        => (string) ($sku['skuId'] ?? ''),
                'name'      => (string) ($sku['skuPartNumber'] ?? ''),
                'total'     => $enabled,
                'used'      => $consumed,
                'available' => max(0, $enabled - $consumed),
            ];
        }

        return Result::ok(['plans' => $plans]);
    }

    /**
     * Confirm the SKU exists on the tenant and has a free seat.
     */
    public function checkAvailability(string $sku): array
    {
        if ($sku === '') {
            return Result::fail(Result::CODE_CONFIG, 'No Microsoft 365 SKU is mapped on this product.');
        }

        $plans = $this->listPlans();

        if (!Result::isOk($plans)) {
            return $plans;
        }

        foreach ($plans['data']['plans'] as $plan) {
            if (strcasecmp($plan['id'], $sku) !== 0 && strcasecmp($plan['name'], $sku) !== 0) {
                continue;
            }

            if ($plan['available'] < 1) {
                return Result::fail(
                    Result::CODE_CAPACITY,
                    sprintf(
                        'The Microsoft 365 subscription "%s" has no free seats (%d of %d in use). '
                        . 'Add licences in the Microsoft 365 admin center before provisioning.',
                        $plan['name'],
                        $plan['used'],
                        $plan['total']
                    )
                );
            }

            return Result::ok([
                'checked'   => true,
                'available' => true,
                'sku_id'    => $plan['id'],
                'sku_name'  => $plan['name'],
                'seats_free' => $plan['available'],
            ]);
        }

        return Result::fail(
            Result::CODE_CONFIG,
            sprintf('The SKU "%s" is not present on this Microsoft 365 tenant.', Validator::text($sku, 64))
        );
    }

    /**
     * @param array<string,mixed> $spec
     */
    public function createAccount(array $spec): array
    {
        $email = (string) ($spec['email'] ?? '');
        $sku = (string) ($spec['sku'] ?? '');
        $usageLocation = (string) ($spec['usage_location'] ?? '');

        if (!Validator::isEmail($email)) {
            return Result::fail(Result::CODE_VALIDATION, 'A valid user principal name is required.');
        }

        if ($usageLocation === '') {
            return Result::fail(
                Result::CODE_CONFIG,
                'Microsoft requires a usage location (ISO country code) before a licence can be assigned. '
                . 'Set it on the product configuration.'
            );
        }

        // Availability is validated before the user is created, so we never
        // create an unlicensed orphan.
        if ($sku !== '') {
            $availability = $this->checkAvailability($sku);

            if (!Result::isOk($availability)) {
                return $availability;
            }

            $sku = (string) ($availability['data']['sku_id'] ?? $sku);
        }

        $payload = [
            'accountEnabled'    => true,
            'displayName'       => (string) ($spec['display_name'] ?? explode('@', $email)[0]),
            'mailNickname'      => substr(preg_replace('/[^A-Za-z0-9]/', '', explode('@', $email)[0]) ?: 'user', 0, 64),
            'userPrincipalName' => $email,
            'usageLocation'     => $usageLocation,
            'passwordProfile'   => [
                'password'                      => (string) ($spec['password'] ?? ''),
                'forceChangePasswordNextSignIn' => !empty($spec['force_change']),
            ],
        ];

        $created = $this->graph('POST', '/users', $payload, true);

        if (!Result::isOk($created)) {
            // A conflict means the UPN already exists - treat it as a lookup
            // rather than a failure, which makes create idempotent.
            if (($created['code'] ?? '') === Result::CODE_CONFLICT
                || strpos(strtolower((string) ($created['message'] ?? '')), 'already exist') !== false) {
                $existing = $this->findByEmail($email);

                if (Result::isOk($existing)) {
                    return Result::ok(
                        $existing['data'] + ['adopted' => true],
                        'An existing Microsoft 365 user with this address was adopted instead of creating a duplicate.'
                    );
                }
            }

            return $created;
        }

        $remoteId = (string) ($created['data']['body']['id'] ?? '');

        if ($remoteId === '') {
            return Result::uncertain('Microsoft 365 accepted the request but returned no user id.');
        }

        $result = [
            'remote_id' => $remoteId,
            'email'     => $email,
            'status'    => 'active',
        ];

        if ($sku !== '') {
            $licence = $this->assignLicense(['remote_id' => $remoteId, 'email' => $email], $sku);

            if (!Result::isOk($licence)) {
                // The user exists; the licence does not. Report precisely.
                return Result::fail(
                    (string) $licence['code'],
                    'The Microsoft 365 user was created but the licence could not be assigned: ' . $licence['message'],
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

        $user = $this->graph('GET', '/users/' . rawurlencode($email) . '?$select=id,userPrincipalName,accountEnabled,assignedLicenses');

        if (!Result::isOk($user)) {
            return $user;
        }

        $body = (array) ($user['data']['body'] ?? []);

        return Result::ok([
            'remote_id'     => (string) ($body['id'] ?? ''),
            'email'         => (string) ($body['userPrincipalName'] ?? $email),
            'status'        => !empty($body['accountEnabled']) ? 'active' : 'suspended',
            'license_state' => !empty($body['assignedLicenses']) ? 'assigned' : 'unassigned',
        ]);
    }

    /**
     * @param array<string,mixed> $account
     */
    public function suspendAccount(array $account): array
    {
        $id = $this->remoteRef($account);

        if ($id === '') {
            return Result::fail(Result::CODE_NOT_FOUND, 'No Microsoft 365 user is recorded for this service.');
        }

        // Sign-in block, which is Microsoft's supported "suspend". The licence
        // is intentionally retained so mail is not deleted; removal is a
        // separate, explicit operation.
        return $this->graph('PATCH', '/users/' . rawurlencode($id), ['accountEnabled' => false], true);
    }

    /**
     * @param array<string,mixed> $account
     */
    public function unsuspendAccount(array $account): array
    {
        $id = $this->remoteRef($account);

        if ($id === '') {
            return Result::fail(Result::CODE_NOT_FOUND, 'No Microsoft 365 user is recorded for this service.');
        }

        return $this->graph('PATCH', '/users/' . rawurlencode($id), ['accountEnabled' => true], true);
    }

    /**
     * @param array<string,mixed> $account
     */
    public function terminateAccount(array $account): array
    {
        $id = $this->remoteRef($account);

        if ($id === '') {
            return Result::fail(Result::CODE_NOT_FOUND, 'No Microsoft 365 user is recorded for this service.');
        }

        $sku = (string) ($account['plan_sku'] ?? '');

        if ($sku !== '') {
            // Free the seat first so the subscription is not billed on.
            $this->removeLicense($account, $sku);
        }

        $deleted = $this->graph('DELETE', '/users/' . rawurlencode($id), null, true);

        if (!Result::isOk($deleted) && ($deleted['code'] ?? '') === Result::CODE_NOT_FOUND) {
            // Already gone: termination is idempotent.
            return Result::ok([], 'The Microsoft 365 user no longer exists.');
        }

        return $deleted;
    }

    /**
     * @param array<string,mixed> $account
     */
    public function changePassword(array $account, string $password, bool $forceChange = false): array
    {
        $id = $this->remoteRef($account);

        if ($id === '') {
            return Result::fail(Result::CODE_NOT_FOUND, 'No Microsoft 365 user is recorded for this service.');
        }

        $check = Validator::checkPassword($password);

        if (!$check['valid']) {
            return Result::fail(Result::CODE_VALIDATION, $check['reason']);
        }

        $result = $this->graph('PATCH', '/users/' . rawurlencode($id), [
            'passwordProfile' => [
                'password'                      => $password,
                'forceChangePasswordNextSignIn' => $forceChange,
            ],
        ], true);

        if (!Result::isOk($result) && ($result['code'] ?? '') === Result::CODE_PERMISSION) {
            return Result::fail(
                Result::CODE_PERMISSION,
                'Microsoft 365 refused the password change. Directory-synchronised or federated tenants manage '
                . 'passwords on-premises, and the application also needs the User.ReadWrite.All permission with '
                . 'admin consent.'
            );
        }

        return $result;
    }

    /**
     * @param array<string,mixed> $account
     */
    public function assignLicense(array $account, string $sku): array
    {
        $id = $this->remoteRef($account);

        if ($id === '' || $sku === '') {
            return Result::fail(Result::CODE_VALIDATION, 'A Microsoft 365 user and SKU are required.');
        }

        $availability = $this->checkAvailability($sku);

        if (!Result::isOk($availability)) {
            return $availability;
        }

        return $this->graph('POST', '/users/' . rawurlencode($id) . '/assignLicense', [
            'addLicenses'    => [['disabledPlans' => [], 'skuId' => (string) $availability['data']['sku_id']]],
            'removeLicenses' => [],
        ], true);
    }

    /**
     * @param array<string,mixed> $account
     */
    public function removeLicense(array $account, string $sku): array
    {
        $id = $this->remoteRef($account);

        if ($id === '' || $sku === '') {
            return Result::fail(Result::CODE_VALIDATION, 'A Microsoft 365 user and SKU are required.');
        }

        // removeLicenses takes SKU GUIDs only, so resolve a part number first.
        $skuId = $sku;

        if (!preg_match('/^[0-9a-f]{8}-/i', $sku)) {
            $plans = $this->listPlans();

            if (Result::isOk($plans)) {
                foreach ($plans['data']['plans'] as $plan) {
                    if (strcasecmp($plan['name'], $sku) === 0) {
                        $skuId = $plan['id'];
                        break;
                    }
                }
            }
        }

        return $this->graph('POST', '/users/' . rawurlencode($id) . '/assignLicense', [
            'addLicenses'    => [],
            'removeLicenses' => [$skuId],
        ], true);
    }

    /**
     * @param array<string,mixed> $account
     */
    public function getStatus(array $account): array
    {
        $reference = $this->remoteRef($account);

        if ($reference === '') {
            return Result::fail(Result::CODE_NOT_FOUND, 'No Microsoft 365 user is recorded for this service.');
        }

        $user = $this->graph(
            'GET',
            '/users/' . rawurlencode($reference) . '?$select=id,userPrincipalName,accountEnabled,assignedLicenses,displayName'
        );

        if (!Result::isOk($user)) {
            if (($user['code'] ?? '') === Result::CODE_NOT_FOUND) {
                return Result::ok(['exists' => false, 'status' => 'missing']);
            }

            return $user;
        }

        $body = (array) ($user['data']['body'] ?? []);

        return Result::ok([
            'exists'           => true,
            'remote_id'        => (string) ($body['id'] ?? ''),
            'email'            => (string) ($body['userPrincipalName'] ?? ''),
            'status'           => !empty($body['accountEnabled']) ? 'active' : 'suspended',
            'license_state'    => !empty($body['assignedLicenses']) ? 'assigned' : 'unassigned',
            // Mailbox usage is intentionally absent: see the class docblock.
            'storage_used_mb'  => null,
            'storage_quota_mb' => null,
        ]);
    }

    /**
     * Domain verification + service configuration records, straight from Graph.
     */
    public function dnsRecords(string $domain): array
    {
        $domain = Validator::normaliseDomain($domain);

        if (!Validator::isDomain($domain)) {
            return Result::fail(Result::CODE_VALIDATION, 'A valid domain is required.');
        }

        $domainResult = $this->graph('GET', '/domains/' . rawurlencode($domain));

        if (!Result::isOk($domainResult)) {
            if (($domainResult['code'] ?? '') === Result::CODE_NOT_FOUND) {
                return Result::fail(
                    Result::CODE_NOT_FOUND,
                    sprintf(
                        'The domain %s has not been added to this Microsoft 365 tenant yet, so Microsoft has not '
                        . 'issued any DNS records for it.',
                        $domain
                    )
                );
            }

            return $domainResult;
        }

        $isVerified = !empty($domainResult['data']['body']['isVerified']);
        $set = new RecordSet(RecordSet::SOURCE_PROVIDER, $isVerified);

        // Verification TXT (only meaningful while the domain is unverified).
        if (!$isVerified) {
            $verification = $this->graph('GET', '/domains/' . rawurlencode($domain) . '/verificationDnsRecords');

            if (Result::isOk($verification)) {
                $this->appendGraphRecords($set, (array) ($verification['data']['body']['value'] ?? []), $domain);
            }
        }

        $service = $this->graph('GET', '/domains/' . rawurlencode($domain) . '/serviceConfigurationRecords');

        if (Result::isOk($service)) {
            $this->appendGraphRecords($set, (array) ($service['data']['body']['value'] ?? []), $domain);
        }

        if ($set->isEmpty()) {
            return Result::ok(
                ['records' => $set, 'verified' => $isVerified],
                'Microsoft returned no DNS records for this domain yet.'
            );
        }

        return Result::ok(['records' => $set, 'verified' => $isVerified]);
    }

    /**
     * Translate Graph domainDnsRecord resources into our record shape.
     *
     * Every value comes from the API response - nothing is synthesised.
     *
     * @param array<int,array<string,mixed>> $records
     */
    private function appendGraphRecords(RecordSet $set, array $records, string $domain): void
    {
        foreach ($records as $record) {
            $type = strtoupper((string) ($record['recordType'] ?? ''));
            $host = (string) ($record['label'] ?? $domain);
            $ttl = isset($record['ttl']) ? (int) $record['ttl'] : null;

            // Present the label relative to the zone where possible.
            if ($host === $domain) {
                $host = '@';
            } elseif (substr($host, -strlen('.' . $domain)) === '.' . $domain) {
                $host = substr($host, 0, -strlen('.' . $domain));
            }

            if ($type === 'MX') {
                $set->add('MX', $host, (string) ($record['mailExchange'] ?? ''), isset($record['preference']) ? (int) $record['preference'] : null, $ttl, RecordSet::PURPOSE_MAIL);
                continue;
            }

            if ($type === 'TXT') {
                $value = (string) ($record['text'] ?? '');
                $set->add('TXT', $host, $value, null, $ttl, RecordSet::classify('TXT', $host, $value));
                continue;
            }

            if ($type === 'CNAME') {
                $value = (string) ($record['canonicalName'] ?? '');
                $set->add('CNAME', $host, $value, null, $ttl, RecordSet::classify('CNAME', $host, $value));
                continue;
            }

            if ($type === 'SRV') {
                $target = (string) ($record['nameTarget'] ?? '');
                $port = (int) ($record['port'] ?? 0);
                $weight = (int) ($record['weight'] ?? 0);
                $priority = isset($record['priority']) ? (int) $record['priority'] : null;

                $set->add('SRV', $host, trim($weight . ' ' . $port . ' ' . $target), $priority, $ttl, RecordSet::PURPOSE_OTHER);
            }
        }
    }

    /**
     * @param array<string,mixed> $account
     */
    public function loginUrl(array $account): string
    {
        return 'https://outlook.office.com/mail/';
    }

    /**
     * Prefer the immutable object id; fall back to the address.
     *
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
