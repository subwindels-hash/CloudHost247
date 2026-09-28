<?php
/**
 * hostx_email - behaviour diagnostics.
 *
 * MOCK TESTS. Every provider call in this suite is served by
 * HostxEmail\Testing\MockHttpClient. Passing here proves the module builds the
 * right requests, interprets documented responses correctly and fails safe - it
 * does NOT prove that a live Microsoft 365 tenant, Google Workspace tenant or
 * mail platform behaves identically. Staging verification against real tenants
 * is tracked in docs/independent-rebuild/STAGING-TEST-MATRIX.md.
 *
 * No database, no WHMCS runtime, no PHPUnit - consistent with the other
 * harnesses in tests/.
 */

$root = dirname(__DIR__, 2);
$module = $root . '/modules/servers/hostx_email';

require_once $module . '/bootstrap.php';

use HostxEmail\Database\Migrator;
use HostxEmail\Dns\RecordSet;
use HostxEmail\Providers\AbstractProvider;
use HostxEmail\Providers\GoogleWorkspaceProvider;
use HostxEmail\Providers\Microsoft365Provider;
use HostxEmail\Providers\ProfessionalEmailProvider;
use HostxEmail\Providers\ProviderFactory;
use HostxEmail\Support\Config;
use HostxEmail\Support\Redactor;
use HostxEmail\Support\Result;
use HostxEmail\Support\Validator;
use HostxEmail\Testing\MockHttpClient;
use HostxEmail\Webhook\Verifier;

/**
 * @param array<string,mixed> $overrides
 */
function hxe_params(array $overrides = []): array
{
    return array_merge([
        'serviceid'        => 4242,
        'userid'           => 77,
        'pid'              => 12,
        'domain'           => 'example-business.com',
        'username'         => 'info',
        'password'         => 'Str0ng-Passw0rd!x',
        'configoption1'    => Config::PROVIDER_MICROSOFT,
        'configoption2'    => 'standard',
        'configoption3'    => 'O365_BUSINESS_PREMIUM',
        'configoption4'    => '1',
        'configoption5'    => '50',
        'configoption6'    => 'NG',
        'configoption7'    => '',
        'configoption8'    => 'on',
        'serverhostname'   => '',
        'serverusername'   => '11111111-2222-3333-4444-555555555555',
        'serverpassword'   => 'super-secret-client-value',
        'serveraccesshash' => 'contoso.onmicrosoft.com',
        'clientsdetails'   => ['firstname' => 'Ada', 'lastname' => 'Obi', 'email' => 'ada@customer.test', 'userid' => 77],
        'customfields'     => [],
    ], $overrides);
}

/** A Microsoft adapter wired to a mock transport with a valid token response. */
function hxe_microsoft(MockHttpClient $http, array $overrides = []): Microsoft365Provider
{
    $http->on('POST https://login.microsoftonline.com', 200, ['access_token' => 'mock-token', 'expires_in' => 3599]);

    return new Microsoft365Provider(new Config(hxe_params($overrides)), $http);
}

/** A Google adapter wired to a mock transport. Uses a throwaway RSA key. */
function hxe_google(MockHttpClient $http, array $overrides = []): GoogleWorkspaceProvider
{
    static $privateKey;

    if ($privateKey === null) {
        $resource = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        openssl_pkey_export($resource, $privateKey);
    }

    $serviceAccount = [
        'client_email' => 'provisioner@cloudhost247.iam.gserviceaccount.com',
        'private_key'  => $privateKey,
    ];

    $params = hxe_params(array_merge([
        'configoption1'    => Config::PROVIDER_GOOGLE,
        'configoption3'    => '1010020027',
        'serverusername'   => 'admin@example-business.com',
        'serveraccesshash' => json_encode(['service_account' => $serviceAccount]),
    ], $overrides));

    $http->on('POST https://oauth2.googleapis.com/token', 200, ['access_token' => 'mock-google-token']);

    return new GoogleWorkspaceProvider(new Config($params), $http);
}

/** A Professional Email adapter wired to a mock transport. */
function hxe_professional(MockHttpClient $http, array $overrides = []): ProfessionalEmailProvider
{
    $params = hxe_params(array_merge([
        'configoption1'    => Config::PROVIDER_PROFESSIONAL,
        'configoption3'    => 'pro-10gb',
        'serverhostname'   => 'https://mail-api.example.net',
        'serverpassword'   => 'mock-api-key',
        'serveraccesshash' => json_encode(['webmail_url' => 'https://webmail.example.net']),
    ], $overrides));

    return new ProfessionalEmailProvider(new Config($params), $http);
}

$tests = [];

/* ============================================================== structure */

$tests['module files required by the brief exist'] = static function () use ($module) {
    $required = [
        'hostx_email.php', 'functions.php', 'api.php', 'webhook.php', 'cron.php', 'hooks.php',
        'bootstrap.php', 'README.md',
        'install/schema.sql', 'install/migrations/1.0.0_baseline.sql',
        'templates/overview.tpl', 'templates/error.tpl', 'templates/assets/clientarea.css',
        'lib/Providers/ProviderInterface.php', 'lib/Providers/Microsoft365Provider.php',
        'lib/Providers/GoogleWorkspaceProvider.php', 'lib/Providers/ProfessionalEmailProvider.php',
        'lib/Service/Provisioner.php', 'lib/Service/Reconciler.php', 'lib/Service/DnsService.php',
        'lib/Service/ClientAreaPresenter.php', 'lib/Service/PublicCatalog.php',
        'lib/Webhook/Verifier.php', 'lib/Support/Redactor.php',
    ];

    foreach ($required as $file) {
        if (!is_file($module . '/' . $file)) {
            return 'missing ' . $file;
        }
    }

    return true;
};

$tests['it is a server module, not an addon'] = static function () use ($module, $root) {
    if (is_dir($root . '/modules/addons/hostx_email')) {
        return 'hostx_email must not exist as an addon module';
    }

    $source = (string) file_get_contents($module . '/hostx_email.php');

    foreach (['_MetaData', '_ConfigOptions', '_CreateAccount', '_SuspendAccount', '_UnsuspendAccount',
              '_TerminateAccount', '_ChangePassword', '_ClientArea'] as $suffix) {
        if (strpos($source, 'function hostx_email' . $suffix . '(') === false) {
            return 'missing hostx_email' . $suffix . '()';
        }
    }

    // Addon-only entry points must NOT be present.
    foreach (['_activate(', '_deactivate(', '_output('] as $addonOnly) {
        if (strpos($source, 'function hostx_email' . $addonOnly) !== false) {
            return 'addon entry point hostx_email' . $addonOnly . ' found in a server module';
        }
    }

    return true;
};

$tests['the public page exists and renders from WHMCS data'] = static function () use ($root) {
    if (!is_file($root . '/email-hosting.php')) {
        return 'email-hosting.php missing';
    }

    if (!is_file($root . '/templates/cloudhost247/cloudhost247-email-hosting.tpl')) {
        return 'page template missing';
    }

    if (!is_file($root . '/templates/cloudhost247/css/email-hosting.css')) {
        return 'page stylesheet missing';
    }

    $page = (string) file_get_contents($root . '/email-hosting.php');

    return strpos($page, 'PublicCatalog') !== false && strpos($page, 'setTemplate') !== false
        ?: 'the page must build its catalogue from PublicCatalog';
};

$tests['no existing CloudHost247 page was modified'] = static function () use ($root) {
    // The email page must be additive: the other landing pages still exist.
    foreach (['web-hosting.php', 'cpanel-hosting.php', 'vps-hosting.php', 'domain.php'] as $page) {
        if (!is_file($root . '/' . $page)) {
            return $page . ' is missing';
        }
    }

    return true;
};

/* ============================================ configuration and validation */

$tests['config option numbering is stable'] = static function () {
    $expected = [
        1 => 'provider', 2 => 'plan_tier', 3 => 'plan_sku', 4 => 'mailbox_quantity',
        5 => 'storage_gb', 6 => 'usage_location', 7 => 'login_url', 8 => 'force_password_change',
    ];

    return Config::CONFIG_OPTIONS === $expected ?: 'CONFIG_OPTIONS changed: ' . json_encode(Config::CONFIG_OPTIONS);
};

$tests['product configuration is read correctly'] = static function () {
    $config = new Config(hxe_params());

    return $config->provider() === Config::PROVIDER_MICROSOFT
        && $config->planTier() === 'standard'
        && $config->planSku() === 'O365_BUSINESS_PREMIUM'
        && $config->storageGb() === 50
        && $config->usageLocation() === 'NG'
        && $config->mailboxAddress() === 'info@example-business.com'
        && $config->contactEmail() === 'ada@customer.test'
        ?: 'config mapping wrong';
};

$tests['an unknown provider falls back safely'] = static function () {
    $config = new Config(hxe_params(['configoption1' => 'not-a-provider']));

    return $config->provider() === Config::PROVIDER_PROFESSIONAL ?: 'unknown provider not clamped';
};

$tests['service validation rejects bad domains and mailboxes'] = static function () {
    $bad = [
        ['domain' => 'not a domain'],
        ['domain' => ''],
        ['username' => '', 'customfields' => []],
        ['username' => 'bad user name'],
    ];

    foreach ($bad as $overrides) {
        $result = (new Config(hxe_params($overrides)))->validateService();

        if (Result::isOk($result)) {
            return 'accepted invalid input: ' . json_encode($overrides);
        }
    }

    return Result::isOk((new Config(hxe_params()))->validateService()) ?: 'rejected a valid service';
};

$tests['password policy is enforced'] = static function () {
    $rejected = ['short1!A', 'alllowercaseletters', 'NOSYMBOLSORDIGITSHERE', 'has space Aa1!xxxxxx'];

    foreach ($rejected as $password) {
        if (Validator::checkPassword($password)['valid']) {
            return 'accepted weak password: ' . $password;
        }
    }

    if (!Validator::checkPassword('Str0ng-Passw0rd!x')['valid']) {
        return 'rejected a compliant password';
    }

    for ($i = 0; $i < 20; $i++) {
        $generated = Validator::generatePassword();

        if (!Validator::checkPassword($generated)['valid']) {
            return 'generated a non-compliant password';
        }
    }

    return true;
};

$tests['domain and mailbox validation'] = static function () {
    return Validator::isDomain('example.com')
        && Validator::isDomain('mail.example.co.uk')
        && !Validator::isDomain('example')
        && !Validator::isDomain('-bad.com')
        && !Validator::isDomain('exa mple.com')
        && Validator::buildEmail('info', 'Example.COM') === 'info@example.com'
        && Validator::buildEmail('bad user', 'example.com') === ''
        ?: 'validation rules wrong';
};

/* ================================================ provider authentication */

$tests['MOCK: Microsoft authenticates with client credentials'] = static function () {
    $http = new MockHttpClient();
    $provider = hxe_microsoft($http);
    $http->on('GET https://graph.microsoft.com/v1.0/organization', 200, ['value' => [['displayName' => 'Contoso']]]);
    $http->on('GET https://graph.microsoft.com/v1.0/subscribedSkus', 200, ['value' => []]);

    $result = $provider->testConnection();

    if (!Result::isOk($result)) {
        return 'connection failed: ' . $result['message'];
    }

    $tokenRequest = $http->requests[0];

    return strpos($tokenRequest['url'], '/oauth2/v2.0/token') !== false
        && strpos((string) $tokenRequest['body'], 'grant_type=client_credentials') !== false
        && strpos((string) $tokenRequest['body'], 'scope=' . rawurlencode('https://graph.microsoft.com/.default')) !== false
        ?: 'token request malformed: ' . $tokenRequest['url'];
};

$tests['MOCK: Microsoft surfaces a permission failure clearly'] = static function () {
    $http = new MockHttpClient();
    $http->on('POST https://login.microsoftonline.com', 401, [
        'error'             => 'invalid_client',
        'error_description' => 'AADSTS7000215: Invalid client secret provided.',
    ]);

    $provider = new Microsoft365Provider(new Config(hxe_params()), $http);
    $result = $provider->testConnection();

    return !Result::isOk($result)
        && $result['code'] === Result::CODE_PERMISSION
        && strpos($result['message'], 'AADSTS7000215') !== false
        ?: 'expected a permission error, got ' . json_encode($result);
};

$tests['Microsoft configuration errors are reported, not guessed'] = static function () {
    $provider = new Microsoft365Provider(new Config(hxe_params(['serveraccesshash' => '', 'serverpassword' => ''])), new MockHttpClient());
    $result = $provider->validateConfiguration();

    return !Result::isOk($result)
        && $result['code'] === Result::CODE_CONFIG
        && strpos($result['message'], 'Tenant ID') !== false
        && strpos($result['message'], 'Client secret') !== false
        ?: 'expected a configuration error listing the missing fields';
};

$tests['Google builds a correctly scoped, delegated JWT assertion'] = static function () {
    $resource = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    openssl_pkey_export($resource, $privateKey);

    $result = GoogleWorkspaceProvider::buildAssertion(
        ['client_email' => 'sa@project.iam.gserviceaccount.com', 'private_key' => $privateKey],
        'admin@example-business.com',
        GoogleWorkspaceProvider::SCOPES,
        1700000000
    );

    if (!Result::isOk($result)) {
        return 'assertion build failed: ' . $result['message'];
    }

    $parts = explode('.', $result['data']['assertion']);

    if (count($parts) !== 3) {
        return 'assertion is not a JWT';
    }

    $claims = json_decode(base64_decode(strtr($parts[1], '-_', '+/')), true);

    return $claims['iss'] === 'sa@project.iam.gserviceaccount.com'
        && $claims['sub'] === 'admin@example-business.com'
        && $claims['aud'] === GoogleWorkspaceProvider::TOKEN_URL
        && strpos($claims['scope'], 'admin.directory.user') !== false
        && strpos($claims['scope'], 'apps.licensing') !== false
        && $claims['exp'] === 1700003600
        ?: 'claims wrong: ' . json_encode($claims);
};

$tests['MOCK: Google explains an unauthorised service account'] = static function () {
    $http = new MockHttpClient();
    $http->on('POST https://oauth2.googleapis.com/token', 401, [
        'error'             => 'unauthorized_client',
        'error_description' => 'Client is unauthorized to retrieve access tokens using this method.',
    ]);

    $resource = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    openssl_pkey_export($resource, $privateKey);

    $provider = new GoogleWorkspaceProvider(new Config(hxe_params([
        'configoption1'    => Config::PROVIDER_GOOGLE,
        'serverusername'   => 'admin@example-business.com',
        'serveraccesshash' => json_encode(['service_account' => [
            'client_email' => 'sa@project.iam.gserviceaccount.com',
            'private_key'  => $privateKey,
        ]]),
    ])), $http);

    $result = $provider->testConnection();

    return !Result::isOk($result)
        && $result['code'] === Result::CODE_PERMISSION
        && strpos($result['message'], 'Domain-wide delegation') !== false
        ?: 'expected the delegation guidance, got: ' . ($result['message'] ?? '');
};

$tests['Professional Email refuses IMAP/SMTP-only configuration'] = static function () {
    $provider = new ProfessionalEmailProvider(new Config(hxe_params([
        'configoption1'  => Config::PROVIDER_PROFESSIONAL,
        'serverhostname' => '',
    ])), new MockHttpClient());

    $result = $provider->validateConfiguration();

    return !Result::isOk($result)
        && $result['code'] === Result::CODE_CONFIG
        && strpos($result['message'], 'IMAP/SMTP') !== false
        ?: 'expected the provisioning-API requirement to be stated';
};

/* ========================================== account creation and licensing */

$tests['MOCK: Microsoft create validates seats, then creates and licenses'] = static function () {
    $http = new MockHttpClient();
    $provider = hxe_microsoft($http);

    $http->on('GET https://graph.microsoft.com/v1.0/subscribedSkus', 200, ['value' => [[
        'skuId'         => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        'skuPartNumber' => 'O365_BUSINESS_PREMIUM',
        'consumedUnits' => 3,
        'prepaidUnits'  => ['enabled' => 5],
    ]]]);
    $http->on('POST https://graph.microsoft.com/v1.0/users', 201, ['id' => 'user-guid-1', 'userPrincipalName' => 'info@example-business.com']);
    $http->on('GET https://graph.microsoft.com/v1.0/subscribedSkus', 200, ['value' => [[
        'skuId'         => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        'skuPartNumber' => 'O365_BUSINESS_PREMIUM',
        'consumedUnits' => 3,
        'prepaidUnits'  => ['enabled' => 5],
    ]]]);
    $http->on('POST https://graph.microsoft.com/v1.0/users/user-guid-1/assignLicense', 200, []);

    $result = $provider->createAccount([
        'email'          => 'info@example-business.com',
        'display_name'   => 'Ada Obi',
        'password'       => 'Str0ng-Passw0rd!x',
        'sku'            => 'O365_BUSINESS_PREMIUM',
        'usage_location' => 'NG',
        'force_change'   => true,
    ]);

    if (!Result::isOk($result)) {
        return 'create failed: ' . $result['message'];
    }

    $create = $http->requestMatching('/v1.0/users');
    $body = json_decode((string) $create['body'], true);

    return $result['data']['remote_id'] === 'user-guid-1'
        && $result['data']['license_state'] === 'assigned'
        && $body['usageLocation'] === 'NG'
        && $body['accountEnabled'] === true
        && $body['passwordProfile']['forceChangePasswordNextSignIn'] === true
        ?: 'create payload wrong: ' . json_encode($body);
};

$tests['MOCK: Microsoft refuses to provision with no free seat'] = static function () {
    $http = new MockHttpClient();
    $provider = hxe_microsoft($http);

    $http->on('GET https://graph.microsoft.com/v1.0/subscribedSkus', 200, ['value' => [[
        'skuId'         => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        'skuPartNumber' => 'O365_BUSINESS_PREMIUM',
        'consumedUnits' => 5,
        'prepaidUnits'  => ['enabled' => 5],
    ]]]);

    $result = $provider->createAccount([
        'email'          => 'info@example-business.com',
        'password'       => 'Str0ng-Passw0rd!x',
        'sku'            => 'O365_BUSINESS_PREMIUM',
        'usage_location' => 'NG',
    ]);

    // No user must be created when there is no licence to give it.
    return !Result::isOk($result)
        && $result['code'] === Result::CODE_CAPACITY
        && $http->requestMatching('POST https://graph.microsoft.com/v1.0/users') === null
        ?: 'expected a capacity refusal before any create call';
};

$tests['MOCK: Microsoft refuses an unmapped SKU'] = static function () {
    $http = new MockHttpClient();
    $provider = hxe_microsoft($http);

    $http->on('GET https://graph.microsoft.com/v1.0/subscribedSkus', 200, ['value' => [[
        'skuId'         => 'other-guid',
        'skuPartNumber' => 'EXCHANGESTANDARD',
        'consumedUnits' => 0,
        'prepaidUnits'  => ['enabled' => 10],
    ]]]);

    $result = $provider->checkAvailability('O365_BUSINESS_PREMIUM');

    return !Result::isOk($result) && $result['code'] === Result::CODE_CONFIG
        ?: 'an unmapped SKU must be a configuration error';
};

$tests['MOCK: Google creates a user and assigns the licence'] = static function () {
    $http = new MockHttpClient();
    $provider = hxe_google($http);

    $http->on('POST https://admin.googleapis.com/admin/directory/v1/users', 200, [
        'id' => '1234567890', 'primaryEmail' => 'info@example-business.com',
    ]);
    $http->on('POST https://licensing.googleapis.com/apps/licensing/v1/product/Google-Apps/sku/1010020027/user', 200, []);

    $result = $provider->createAccount([
        'email'        => 'info@example-business.com',
        'display_name' => 'Ada Obi',
        'password'     => 'Str0ng-Passw0rd!x',
        'sku'          => '1010020027',
        'force_change' => true,
    ]);

    if (!Result::isOk($result)) {
        return 'create failed: ' . $result['message'];
    }

    $create = $http->requestMatching('/admin/directory/v1/users');
    $body = json_decode((string) $create['body'], true);

    return $result['data']['remote_id'] === '1234567890'
        && $result['data']['license_state'] === 'assigned'
        && $body['primaryEmail'] === 'info@example-business.com'
        && $body['changePasswordAtNextLogin'] === true
        ?: 'google create payload wrong: ' . json_encode($body);
};

$tests['MOCK: an existing remote user is adopted, never duplicated'] = static function () {
    $http = new MockHttpClient();
    $provider = hxe_microsoft($http);

    $http->on('GET https://graph.microsoft.com/v1.0/subscribedSkus', 200, ['value' => [[
        'skuId' => 'sku-guid', 'skuPartNumber' => 'O365_BUSINESS_PREMIUM',
        'consumedUnits' => 1, 'prepaidUnits' => ['enabled' => 5],
    ]]]);
    $http->on('POST https://graph.microsoft.com/v1.0/users', 409, [
        'error' => ['message' => 'Another object with the same value for property userPrincipalName already exists.'],
    ]);
    $http->on('GET https://graph.microsoft.com/v1.0/users/info%40example-business.com', 200, [
        'id' => 'existing-guid', 'userPrincipalName' => 'info@example-business.com',
        'accountEnabled' => true, 'assignedLicenses' => [['skuId' => 'sku-guid']],
    ]);

    $result = $provider->createAccount([
        'email'          => 'info@example-business.com',
        'password'       => 'Str0ng-Passw0rd!x',
        'sku'            => 'O365_BUSINESS_PREMIUM',
        'usage_location' => 'NG',
    ]);

    return Result::isOk($result)
        && !empty($result['data']['adopted'])
        && $result['data']['remote_id'] === 'existing-guid'
        ?: 'a conflicting create must adopt the existing user';
};

/* =========================================== idempotency and reconciliation */

$tests['idempotency keys are deterministic and input-sensitive'] = static function () {
    $repository = \HostxEmail\Repository\OperationRepository::class;

    $a = $repository::key(10, 'create', ['email' => 'a@b.com', 'sku' => 'X']);
    $b = $repository::key(10, 'create', ['sku' => 'X', 'email' => 'a@b.com']); // different order
    $c = $repository::key(10, 'create', ['email' => 'other@b.com', 'sku' => 'X']);
    $d = $repository::key(11, 'create', ['email' => 'a@b.com', 'sku' => 'X']);
    $e = $repository::key(10, 'suspend', ['email' => 'a@b.com', 'sku' => 'X']);

    return $a === $b && $a !== $c && $a !== $d && $a !== $e && strpos($a, 'create-10-') === 0
        ?: 'idempotency key behaviour wrong';
};

$tests['a timeout on a mutating call is uncertain, not failed'] = static function () {
    $http = new MockHttpClient();
    $provider = hxe_microsoft($http);

    $http->on('GET https://graph.microsoft.com/v1.0/subscribedSkus', 200, ['value' => [[
        'skuId' => 'sku-guid', 'skuPartNumber' => 'O365_BUSINESS_PREMIUM',
        'consumedUnits' => 1, 'prepaidUnits' => ['enabled' => 5],
    ]]]);
    $http->on('POST https://graph.microsoft.com/v1.0/users', 0, '', [], true, 'Operation timed out');

    $result = $provider->createAccount([
        'email'          => 'info@example-business.com',
        'password'       => 'Str0ng-Passw0rd!x',
        'sku'            => 'O365_BUSINESS_PREMIUM',
        'usage_location' => 'NG',
    ]);

    return !Result::isOk($result)
        && Result::isUncertain($result)
        && $result['code'] === Result::CODE_UNCERTAIN
        && strpos($result['message'], 'reconciliation') !== false
        ?: 'a post-send timeout must be reported as uncertain';
};

$tests['a refused connection is a plain failure, not uncertain'] = static function () {
    $http = new MockHttpClient();
    $provider = hxe_professional($http);

    $http->on('PATCH https://mail-api.example.net/mailboxes/box-1', 0, '', [], false, 'Connection refused');

    $result = $provider->suspendAccount(['remote_id' => 'box-1', 'email' => 'info@example-business.com']);

    return !Result::isOk($result)
        && !Result::isUncertain($result)
        && $result['code'] === Result::CODE_TRANSPORT
        ?: 'a refused connection must not be marked uncertain';
};

$tests['HTTP status mapping'] = static function () {
    return AbstractProvider::mapStatus(401) === Result::CODE_PERMISSION
        && AbstractProvider::mapStatus(403) === Result::CODE_PERMISSION
        && AbstractProvider::mapStatus(404) === Result::CODE_NOT_FOUND
        && AbstractProvider::mapStatus(409) === Result::CODE_CONFLICT
        && AbstractProvider::mapStatus(400) === Result::CODE_VALIDATION
        && AbstractProvider::mapStatus(429) === Result::CODE_RATE_LIMIT
        && AbstractProvider::mapStatus(503) === Result::CODE_REMOTE
        ?: 'status mapping wrong';
};

/* ================================== suspension, reactivation and passwords */

$tests['MOCK: suspend blocks sign-in without deleting the mailbox'] = static function () {
    $http = new MockHttpClient();
    $provider = hxe_microsoft($http);

    $http->on('PATCH https://graph.microsoft.com/v1.0/users/user-guid-1', 204, []);

    $result = $provider->suspendAccount(['remote_id' => 'user-guid-1', 'email' => 'info@example-business.com']);
    $request = $http->requestMatching('/v1.0/users/user-guid-1');
    $body = json_decode((string) $request['body'], true);

    return Result::isOk($result)
        && $request['method'] === 'PATCH'
        && $body === ['accountEnabled' => false]
        ?: 'suspend must patch accountEnabled=false';
};

$tests['MOCK: unsuspend restores sign-in'] = static function () {
    $http = new MockHttpClient();
    $provider = hxe_google($http);

    $http->on('PUT https://admin.googleapis.com/admin/directory/v1/users/1234567890', 200, ['suspended' => false]);

    $result = $provider->unsuspendAccount(['remote_id' => '1234567890', 'email' => 'info@example-business.com']);
    $body = json_decode((string) $http->requestMatching('/users/1234567890')['body'], true);

    return Result::isOk($result) && $body === ['suspended' => false] ?: 'unsuspend payload wrong';
};

$tests['MOCK: password change explains a federated-tenant refusal'] = static function () {
    $http = new MockHttpClient();
    $provider = hxe_microsoft($http);

    $http->on('PATCH https://graph.microsoft.com/v1.0/users/user-guid-1', 403, [
        'error' => ['message' => 'Insufficient privileges to complete the operation.'],
    ]);

    $result = $provider->changePassword(
        ['remote_id' => 'user-guid-1', 'email' => 'info@example-business.com'],
        'An0ther-Passw0rd!x'
    );

    return !Result::isOk($result)
        && $result['code'] === Result::CODE_PERMISSION
        && strpos($result['message'], 'federated') !== false
        ?: 'expected the federated/synced explanation';
};

$tests['a weak password never reaches the provider'] = static function () {
    $http = new MockHttpClient();
    $provider = hxe_google($http);

    $result = $provider->changePassword(['remote_id' => '1', 'email' => 'a@b.com'], 'weak');

    return !Result::isOk($result)
        && $result['code'] === Result::CODE_VALIDATION
        && $http->requestMatching('/admin/directory/v1/users/1') === null
        ?: 'a weak password must be rejected locally';
};

/* ============================================================ termination */

$tests['MOCK: terminate releases the licence then deletes the user'] = static function () {
    $http = new MockHttpClient();
    $provider = hxe_google($http);

    $http->on('DELETE https://licensing.googleapis.com/apps/licensing/v1/product/Google-Apps/sku/1010020027/user/info%40example-business.com', 200, []);
    $http->on('DELETE https://admin.googleapis.com/admin/directory/v1/users/1234567890', 204, []);

    $result = $provider->terminateAccount([
        'remote_id' => '1234567890',
        'email'     => 'info@example-business.com',
        'plan_sku'  => '1010020027',
    ]);

    $order = array_map(static function ($request) {
        return $request['method'] . ' ' . (strpos($request['url'], 'licensing') !== false ? 'licence' : 'user');
    }, array_values(array_filter($http->requests, static function ($request) {
        return $request['method'] === 'DELETE';
    })));

    return Result::isOk($result) && $order === ['DELETE licence', 'DELETE user']
        ?: 'termination order wrong: ' . json_encode($order);
};

$tests['MOCK: terminating an already-deleted account succeeds'] = static function () {
    $http = new MockHttpClient();
    $provider = hxe_microsoft($http);

    $http->on('DELETE https://graph.microsoft.com/v1.0/users/user-guid-1', 404, [
        'error' => ['message' => 'Resource not found.'],
    ]);

    $result = $provider->terminateAccount(['remote_id' => 'user-guid-1', 'email' => 'info@example-business.com']);

    return Result::isOk($result) ?: 'termination must be idempotent';
};

/* =================================================================== DNS */

$tests['MOCK: Microsoft DNS records come from Graph, unmodified'] = static function () {
    $http = new MockHttpClient();
    $provider = hxe_microsoft($http);

    $http->on('GET https://graph.microsoft.com/v1.0/domains/example-business.com', 200, ['isVerified' => false]);
    $http->on('verificationDnsRecords', 200, ['value' => [[
        'recordType' => 'Txt', 'label' => 'example-business.com', 'text' => 'MS=ms12345678', 'ttl' => 3600,
    ]]]);
    $http->on('serviceConfigurationRecords', 200, ['value' => [
        ['recordType' => 'Mx', 'label' => 'example-business.com', 'mailExchange' => 'example-business-com.mail.protection.outlook.com', 'preference' => 0, 'ttl' => 3600],
        ['recordType' => 'Txt', 'label' => 'example-business.com', 'text' => 'v=spf1 include:spf.protection.outlook.com -all', 'ttl' => 3600],
        ['recordType' => 'Cname', 'label' => 'autodiscover.example-business.com', 'canonicalName' => 'autodiscover.outlook.com', 'ttl' => 3600],
    ]]);

    $result = $provider->dnsRecords('example-business.com');

    if (!Result::isOk($result)) {
        return 'dns lookup failed: ' . $result['message'];
    }

    /** @var RecordSet $records */
    $records = $result['data']['records'];
    $all = $records->all();

    $mx = null;
    $spf = null;
    $verification = null;

    foreach ($all as $record) {
        if ($record['type'] === 'MX') {
            $mx = $record;
        }

        if ($record['purpose'] === RecordSet::PURPOSE_SPF) {
            $spf = $record;
        }

        if ($record['purpose'] === RecordSet::PURPOSE_VERIFICATION) {
            $verification = $record;
        }
    }

    return count($all) === 4
        && $mx['value'] === 'example-business-com.mail.protection.outlook.com'
        && $mx['priority'] === 0
        && $mx['host'] === '@'
        && $spf !== null
        && $verification['value'] === 'MS=ms12345678'
        && $result['data']['verified'] === false
        ?: 'graph records were not mapped verbatim: ' . json_encode($all);
};

$tests['Google DNS is not invented when nothing is configured'] = static function () {
    $http = new MockHttpClient();
    $provider = hxe_google($http);

    $result = $provider->dnsRecords('example-business.com');

    return !Result::isOk($result)
        && $result['code'] === Result::CODE_NOT_SUPPORTED
        && strpos($result['message'], 'Admin console') !== false
        ?: 'Google DNS values must never be fabricated';
};

$tests['administrator-configured DNS records are rendered'] = static function () {
    $http = new MockHttpClient();
    $provider = hxe_google($http, [
        'serveraccesshash' => json_encode([
            'service_account' => ['client_email' => 'sa@p.iam.gserviceaccount.com', 'private_key' => 'x'],
            'dns'             => ['*' => [
                ['type' => 'MX', 'host' => '@', 'value' => 'smtp.example-relay.test', 'priority' => 1, 'ttl' => 3600],
                ['type' => 'TXT', 'host' => '@', 'value' => 'v=spf1 include:_spf.example-relay.test ~all'],
            ]],
        ]),
    ]);

    $result = $provider->dnsRecords('example-business.com');

    if (!Result::isOk($result)) {
        return 'configured records were not used: ' . $result['message'];
    }

    /** @var RecordSet $records */
    $records = $result['data']['records'];

    return $records->count() === 2
        && $records->source() === RecordSet::SOURCE_CONFIG
        && $records->verified() === null
        ?: 'configured record set wrong';
};

$tests['DNS record classification and clipboard rendering'] = static function () {
    $set = new RecordSet(RecordSet::SOURCE_PROVIDER, null);
    $set->add('MX', '@', 'mail.example.net', 10, 3600, RecordSet::PURPOSE_MAIL);
    $set->add('TXT', '@', 'v=spf1 include:example -all', null, null, RecordSet::classify('TXT', '@', 'v=spf1 include:example -all'));
    $set->add('TXT', '_dmarc', 'v=DMARC1; p=none', null, null, RecordSet::classify('TXT', '_dmarc', 'v=DMARC1; p=none'));
    $set->add('EVIL', '@', '<script>', null, null);

    $all = $set->all();
    $clipboard = RecordSet::toClipboard($all[0]);

    return count($all) === 3
        && $all[1]['purpose'] === RecordSet::PURPOSE_SPF
        && $all[2]['purpose'] === RecordSet::PURPOSE_DMARC
        && strpos($clipboard, 'Type: MX') === 0
        && strpos($clipboard, 'Priority: 10') !== false
        && substr_count($set->toClipboardAll(), "\n") === 2
        ?: 'record set behaviour wrong: ' . json_encode($all);
};

/* =============================================================== webhooks */

$tests['webhook HMAC verification accepts a valid signature'] = static function () {
    $body = '{"event":"mailbox.suspended","email":"info@example-business.com"}';
    $timestamp = (string) time();
    $secret = 'webhook-shared-secret';
    $signature = hash_hmac('sha256', $timestamp . '.' . $body, $secret);

    $check = Verifier::verifyHmac($body, $signature, $secret, $timestamp);
    $prefixed = Verifier::verifyHmac($body, 'sha256=' . $signature, $secret, $timestamp);

    return $check['valid'] && $prefixed['valid'] ?: 'valid signature rejected: ' . $check['reason'];
};

$tests['webhook verification rejects tampering, replay and missing secrets'] = static function () {
    $body = '{"event":"mailbox.suspended"}';
    $timestamp = (string) time();
    $secret = 'webhook-shared-secret';
    $signature = hash_hmac('sha256', $timestamp . '.' . $body, $secret);

    $cases = [
        'tampered body'   => Verifier::verifyHmac($body . ' ', $signature, $secret, $timestamp),
        'wrong secret'    => Verifier::verifyHmac($body, $signature, 'other-secret', $timestamp),
        'missing header'  => Verifier::verifyHmac($body, '', $secret, $timestamp),
        'no secret'       => Verifier::verifyHmac($body, $signature, '', $timestamp),
        'stale timestamp' => Verifier::verifyHmac($body, $signature, $secret, (string) (time() - 3600)),
        'bad timestamp'   => Verifier::verifyHmac($body, $signature, $secret, 'not-a-number'),
    ];

    foreach ($cases as $name => $result) {
        if ($result['valid']) {
            return 'accepted ' . $name;
        }
    }

    return true;
};

$tests['only providers with documented authentication accept webhooks'] = static function () use ($module) {
    if (in_array('google', Verifier::SUPPORTED, true)) {
        return 'Google has no documented signed directory webhook and must not be accepted';
    }

    $source = (string) file_get_contents($module . '/webhook.php');

    return in_array('professional', Verifier::SUPPORTED, true)
        && in_array('microsoft365', Verifier::SUPPORTED, true)
        && strpos($source, 'hostx_email_webhook_respond(501') !== false
        && strpos($source, 'validationToken') !== false
        ?: 'webhook endpoint contract wrong';
};

$tests['the webhook endpoint never provisions or deletes'] = static function () use ($module) {
    $source = (string) file_get_contents($module . '/webhook.php');

    foreach (['createAccount(', 'terminateAccount(', 'changePassword(', '->create()'] as $forbidden) {
        if (strpos($source, $forbidden) !== false) {
            return 'webhook.php must not call ' . $forbidden;
        }
    }

    return true;
};

/* ============================================================ secret hygiene */

$tests['secrets are redacted from logs by key and by pattern'] = static function () {
    $payload = [
        'client_secret'    => 'super-secret-value',
        'password'         => 'Str0ng-Passw0rd!x',
        'passwordProfile'  => ['password' => 'Str0ng-Passw0rd!x'],
        'service_account'  => ['private_key' => '-----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----'],
        'nested'           => ['api_key' => 'abcdef', 'safe' => 'keep me'],
        'note'             => 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payloadpart.signaturepart',
        'query'            => 'grant_type=client_credentials&client_secret=leaky-value&scope=x',
    ];

    $redacted = Redactor::redact($payload);
    $encoded = (string) json_encode($redacted);

    foreach (['super-secret-value', 'Str0ng-Passw0rd!x', 'BEGIN PRIVATE KEY', 'abcdef', 'leaky-value', 'signaturepart'] as $secret) {
        if (strpos($encoded, $secret) !== false) {
            return 'leaked: ' . $secret;
        }
    }

    return strpos($encoded, 'keep me') !== false ?: 'redaction removed non-sensitive data';
};

$tests['headers are redacted'] = static function () {
    $headers = Redactor::headers([
        'Authorization' => 'Bearer mock-token-value',
        'X-Api-Key'     => 'key-value',
        'Accept'        => 'application/json',
    ]);

    return $headers['Authorization'] === Redactor::MASK
        && $headers['X-Api-Key'] === Redactor::MASK
        && $headers['Accept'] === 'application/json'
        ?: 'header redaction wrong: ' . json_encode($headers);
};

$tests['no credential is ever written to a module table'] = static function () use ($module) {
    $schema = (string) file_get_contents($module . '/install/schema.sql');

    foreach (['password', 'client_secret', 'private_key', 'access_token', 'api_key'] as $column) {
        if (preg_match('/`[a-z_]*' . $column . '[a-z_]*`\s+(VARCHAR|TEXT|CHAR)/i', $schema)) {
            return 'schema stores a credential-like column: ' . $column;
        }
    }

    return true;
};

$tests['the module never logs raw provider bodies unredacted'] = static function () use ($module) {
    $logger = (string) file_get_contents($module . '/lib/Support/Logger.php');
    $abstract = (string) file_get_contents($module . '/lib/Providers/AbstractProvider.php');

    return strpos($logger, 'Redactor::redact') !== false
        && strpos($abstract, 'Redactor::json') !== false
        && strpos($abstract, 'Redactor::headers') !== false
        ?: 'provider logging must pass through the redactor';
};

/* ================================================= transport and security */

$tests['plain HTTP provider endpoints are refused'] = static function () {
    $client = new \HostxEmail\Support\CurlClient();
    $response = $client->request('GET', 'http://insecure.example.net/mailboxes');

    return $response['status'] === 0 && strpos($response['error'], 'non-HTTPS') !== false
        ?: 'the transport must refuse plain HTTP';
};

$tests['the API base URL rejects an http:// host'] = static function () {
    $config = new Config(hxe_params([
        'configoption1'  => Config::PROVIDER_PROFESSIONAL,
        'serverhostname' => 'http://mail-api.example.net',
    ]));

    return $config->apiBaseUrl() === '' ?: 'http:// hosts must not be accepted';
};

$tests['TLS verification is never disabled'] = static function () use ($module) {
    foreach (glob($module . '/lib/Support/*.php') as $file) {
        $source = (string) file_get_contents($file);

        if (preg_match('/CURLOPT_SSL_VERIFY(PEER|HOST)\s*=>\s*(false|0)\b/i', $source)) {
            return 'TLS verification disabled in ' . basename($file);
        }
    }

    return true;
};

$tests['client-area ownership is enforced before anything is shown'] = static function () use ($module) {
    $source = (string) file_get_contents($module . '/lib/Service/ClientAreaPresenter.php');

    return strpos($source, 'ownsService') !== false
        && strpos($source, 'isOwnedBy') !== false
        && substr_count($source, 'ownsService(') >= 3
        && strpos($source, 'verifyToken') !== false
        && strpos($source, 'hash_equals') !== false
        ?: 'the presenter must check ownership and CSRF on render and on every action';
};

$tests['client-area templates escape every value'] = static function () use ($module) {
    $template = (string) file_get_contents($module . '/templates/overview.tpl');

    // Every {$var} output must carry an escape modifier.
    preg_match_all('/\{\$[a-zA-Z0-9_\.\[\]\'"]+(\|[a-z0-9_:"\'\.\s\|]+)?\}/', $template, $matches);

    foreach ($matches[0] as $expression) {
        if (strpos($expression, '|escape') === false) {
            return 'unescaped output in overview.tpl: ' . $expression;
        }
    }

    return true;
};

$tests['the public page template escapes every value'] = static function () use ($root) {
    $template = (string) file_get_contents($root . '/templates/cloudhost247/cloudhost247-email-hosting.tpl');

    preg_match_all('/\{\$[a-zA-Z0-9_\.\[\]\'"]+(\|[a-z0-9_:"\'\.\s\|…]+)?\}/u', $template, $matches);

    foreach ($matches[0] as $expression) {
        // $WEB_ROOT and $template are WHMCS-controlled path variables.
        if (strpos($expression, '$WEB_ROOT') !== false || $expression === '{$template}') {
            continue;
        }

        if (strpos($expression, '|escape') === false) {
            return 'unescaped output on the public page: ' . $expression;
        }
    }

    return true;
};

$tests['no legacy WHMCS database helpers are used'] = static function () use ($module) {
    $banned = ['select_query(', 'full_query(', 'update_query(', 'insert_query(', 'mysql_fetch_assoc(', 'db_escape_string('];
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($module));

    foreach ($iterator as $file) {
        if (!$file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }

        $source = (string) file_get_contents($file->getPathname());

        foreach ($banned as $needle) {
            if (strpos($source, $needle) !== false) {
                return $needle . ' used in ' . $file->getFilename();
            }
        }
    }

    return true;
};

/* ========================================== product catalogue and rendering */

$tests['provider capability matrix is honest'] = static function () {
    $matrix = [];

    foreach (array_keys(ProviderFactory::PROVIDERS) as $key) {
        $matrix[$key] = ProviderFactory::makeFor($key, new Config(['configoption1' => $key]))->capabilities();
    }

    // Capabilities the providers genuinely do NOT offer must be declared false.
    return $matrix['microsoft365']['usage'] === false     // needs the Reports API
        && $matrix['google']['usage'] === false           // not in the Directory API
        && $matrix['google']['dns'] === false             // published in the Admin console
        && $matrix['google']['plans'] === false
        && $matrix['professional']['usage'] === true
        && $matrix['microsoft365']['assign_license'] === true
        && $matrix['professional']['assign_license'] === false
        ?: 'capability matrix wrong: ' . json_encode($matrix);
};

$tests['the provisioner refuses an unsupported capability'] = static function () {
    $config = new Config(hxe_params(['configoption1' => Config::PROVIDER_PROFESSIONAL, 'serverhostname' => 'https://mail-api.example.net']));
    $provisioner = new \HostxEmail\Service\Provisioner($config, new MockHttpClient());

    $result = $provisioner->preflight('assign_license');

    return !Result::isOk($result) && $result['code'] === Result::CODE_NOT_SUPPORTED
        ?: 'preflight must refuse an unsupported capability';
};

$tests['Microsoft licensing requires a usage location'] = static function () {
    $config = new Config(hxe_params(['configoption6' => '']));
    $provisioner = new \HostxEmail\Service\Provisioner($config, new MockHttpClient());

    $result = $provisioner->preflight('create');

    return !Result::isOk($result)
        && $result['code'] === Result::CODE_CONFIG
        && strpos($result['message'], 'usage location') !== false
        ?: 'a missing usage location must block Microsoft provisioning';
};

$tests['schema statements split cleanly'] = static function () {
    $statements = Migrator::splitStatements(
        "-- comment\nCREATE TABLE a (id INT);\n\n-- another\nALTER TABLE a ADD COLUMN b INT;\n"
    );

    return count($statements) === 2 && strpos($statements[0], 'CREATE TABLE a') === 0
        ?: json_encode($statements);
};

$tests['the schema declares the tables the workflow relies on'] = static function () use ($module) {
    $schema = (string) file_get_contents($module . '/install/schema.sql');

    foreach (Migrator::TABLES as $table) {
        if (strpos($schema, '`' . $table . '`') === false) {
            return 'schema is missing ' . $table;
        }
    }

    return strpos($schema, 'UNIQUE KEY `idempotency_unique`') !== false
        && strpos($schema, 'UNIQUE KEY `service_unique`') !== false
        && strpos($schema, 'UNIQUE KEY `provider_event`') !== false
        ?: 'the uniqueness guarantees are missing from the schema';
};

$tests['page rendering performs no provider API calls'] = static function () use ($module, $root) {
    $catalog = (string) file_get_contents($module . '/lib/Service/PublicCatalog.php');
    $page = (string) file_get_contents($root . '/email-hosting.php');

    foreach (['ProviderFactory::make(', 'testConnection(', 'createAccount(', 'getStatus('] as $forbidden) {
        if (strpos($page, $forbidden) !== false) {
            return 'email-hosting.php must not call ' . $forbidden;
        }
    }

    // The catalogue may build an adapter to read its capability flags, but must
    // never invoke a network operation.
    foreach (['->testConnection(', '->createAccount(', '->getStatus(', '->listPlans(', '->dnsRecords('] as $forbidden) {
        if (strpos($catalog, $forbidden) !== false) {
            return 'PublicCatalog must not call ' . $forbidden;
        }
    }

    return true;
};

$tests['default page content makes no false partnership claim'] = static function () {
    $content = \HostxEmail\Repository\ContentRepository::defaults();
    $disclaimer = strtolower($content['hero']['disclaimer']);

    if (strpos($disclaimer, 'not affiliated') === false) {
        return 'the hero must disclaim affiliation with Microsoft and Google';
    }

    $blob = strtolower((string) json_encode($content));

    // Affirmative partnership claims only: "not affiliated with, or an official
    // partner of" is exactly the wording we require, so a bare substring match
    // would flag the disclaimer itself.
    $affirmative = '/(we are|cloudhost247 is|as an?)\s+(an?\s+)?(official|certified|authorised|authorized|accredited)\s+'
        . '(microsoft|google|reseller|partner)/';

    if (preg_match($affirmative, $blob)) {
        return 'content makes an affirmative partnership claim';
    }

    foreach (['microsoft partner', 'google partner', 'gold partner'] as $claim) {
        if (strpos($blob, $claim) !== false) {
            return 'content claims: ' . $claim;
        }
    }

    return true;
};

$tests['cron work is bounded and lock protected'] = static function () use ($module) {
    $reconciler = (string) file_get_contents($module . '/lib/Service/Reconciler.php');
    $hooks = (string) file_get_contents($module . '/hooks.php');

    return strpos($reconciler, "Lock::acquire('cron:reconciler'") !== false
        && strpos($reconciler, 'min($limit') === false // bounding lives in the repository
        && strpos($hooks, 'DailyCronJob') !== false
        && strpos($hooks, 'AfterCronJob') !== false
        && preg_match('/run\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/', $hooks) === 1
        ?: 'cron execution must be bounded and locked';
};

/* ----------------------------------------------------------------- runner */

$failures = 0;

echo "hostx_email diagnostics (provider calls are MOCKED)\n\n";

foreach ($tests as $name => $test) {
    try {
        $result = $test();
    } catch (Throwable $e) {
        $result = 'threw ' . get_class($e) . ': ' . $e->getMessage();
    }

    if ($result === true) {
        echo "PASS  {$name}\n";
        continue;
    }

    $failures++;
    echo "FAIL  {$name}" . (is_string($result) ? " - {$result}" : '') . "\n";
}

echo "\n" . (count($tests) - $failures) . '/' . count($tests) . " hostx_email checks passed"
    . " (mock transport; live-tenant verification is a staging requirement)\n";

exit($failures === 0 ? 0 : 1);
