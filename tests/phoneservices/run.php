<?php
/**
 * Phone Services platform - behaviour diagnostics.
 *
 * Mirrors the style of the other harnesses in tests/: no PHPUnit, no database,
 * no WHMCS runtime. Everything exercised here is pure logic or filesystem
 * structure, so the suite runs on a bare PHP 7.4 / 8.2 CLI.
 */

$root = dirname(__DIR__, 2);
$module = $root . '/modules/addons/phoneservices';

define('PHONESERVICES_ENCRYPTION_KEY', 'unit-test-key-not-a-real-secret');

require_once $module . '/bootstrap.php';

use PhoneServices\Core\Crypto;
use PhoneServices\Core\Router;
use PhoneServices\Core\Security;
use PhoneServices\Providers\ProviderRegistry;
use PhoneServices\Providers\TwilioProvider;
use PhoneServices\Providers\VonageProvider;

$tests = [];

// ---------------------------------------------------------------- structure

$tests['module entry points exist'] = static function () use ($module) {
    foreach (['phoneservices.php', 'hooks.php', 'bootstrap.php', 'composer.json',
              'api/rest.php', 'api/bootstrap.php', 'cron/run.php',
              'install/schema.sql'] as $file) {
        if (!is_file($module . '/' . $file)) {
            return 'missing ' . $file;
        }
    }

    return true;
};

$tests['every admin page has a template'] = static function () use ($module) {
    foreach (array_keys(\PhoneServices\Core\Module::ADMIN_PAGES) as $page) {
        if (!is_file($module . '/templates/admin/' . $page . '.tpl')) {
            return 'missing admin template: ' . $page;
        }
    }

    return true;
};

$tests['every client page has a template'] = static function () use ($module) {
    foreach (\PhoneServices\Core\Module::CLIENT_PAGES as $page) {
        if (!is_file($module . '/templates/client/' . $page . '.tpl')) {
            return 'missing client template: ' . $page;
        }
    }

    return is_file($module . '/templates/clientarea.tpl') ?: 'missing clientarea.tpl';
};

$tests['provisioning modules are present and self-contained'] = static function () use ($root) {
    foreach (['numbers', 'voip', 'sms', 'esim'] as $service) {
        $file = $root . '/modules/servers/phoneservices_' . $service . '/phoneservices_' . $service . '.php';

        if (!is_file($file)) {
            return 'missing server module: ' . $service;
        }

        $source = (string) file_get_contents($file);

        foreach (['_MetaData', '_ConfigOptions', '_CreateAccount', '_SuspendAccount',
                  '_UnsuspendAccount', '_TerminateAccount'] as $suffix) {
            if (strpos($source, 'phoneservices_' . $service . $suffix) === false) {
                return $service . ' is missing ' . $suffix;
            }
        }
    }

    return true;
};

$tests['no legacy WHMCS database helpers remain'] = static function () use ($module) {
    $banned = ['select_query(', 'full_query(', 'update_query(', 'insert_query(',
               'mysql_fetch_assoc(', 'db_escape_string('];

    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($module));

    foreach ($iterator as $file) {
        if (!$file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }

        $source = (string) file_get_contents($file->getPathname());

        foreach ($banned as $needle) {
            if (strpos($source, $needle) !== false) {
                return $needle . ' found in ' . $file->getFilename();
            }
        }
    }

    return true;
};

$tests['schema and migration cover the same columns'] = static function () use ($module) {
    $schema = (string) file_get_contents($module . '/install/schema.sql');
    $migration = (string) file_get_contents($module . '/install/migrations/1.1.0_platform_hardening.sql');

    foreach (['forward_to', 'qr_code_url'] as $column) {
        if (strpos($schema, $column) === false) {
            return 'schema.sql is missing ' . $column;
        }

        if (strpos($migration, $column) === false) {
            return 'migration is missing ' . $column;
        }
    }

    return true;
};

// ------------------------------------------------------------------ crypto

$tests['credentials round-trip through AES-256-GCM'] = static function () {
    if (!Crypto::isAvailable()) {
        return true; // openssl unavailable on this runner; nothing to assert
    }

    $secret = 'SK_live_0123456789abcdef';
    $sealed = Crypto::encrypt($secret);

    return $sealed !== $secret
        && strpos($sealed, Crypto::PREFIX) === 0
        && Crypto::decrypt($sealed) === $secret;
};

$tests['encrypting twice does not double-wrap'] = static function () {
    if (!Crypto::isAvailable()) {
        return true;
    }

    $once = Crypto::encrypt('token');

    return Crypto::encrypt($once) === $once && Crypto::decrypt(Crypto::encrypt($once)) === 'token';
};

$tests['plaintext legacy values decrypt untouched'] = static function () {
    return Crypto::decrypt('legacy-plaintext') === 'legacy-plaintext' && Crypto::encrypt('') === '';
};

$tests['tampered ciphertext is rejected'] = static function () {
    if (!Crypto::isAvailable()) {
        return true;
    }

    $sealed = Crypto::encrypt('sensitive');
    $tampered = substr($sealed, 0, -4) . 'AAAA';

    return Crypto::decrypt($tampered) === '';
};

// ---------------------------------------------------------------- security

$tests['phone number validation is E.164 strict'] = static function () {
    $valid = ['+15551234567', '+2348012345678', '+447700900123'];
    $invalid = ['15551234567', '+0123456', '+1', 'not-a-number', '+1555123456789012'];

    foreach ($valid as $number) {
        if (!Security::isValidPhoneNumber($number)) {
            return $number . ' should be valid';
        }
    }

    foreach ($invalid as $number) {
        if (Security::isValidPhoneNumber($number)) {
            return $number . ' should be invalid';
        }
    }

    return true;
};

$tests['country codes are two alpha characters'] = static function () {
    return Security::isValidCountryCode('US')
        && Security::isValidCountryCode('ng')
        && !Security::isValidCountryCode('USA')
        && !Security::isValidCountryCode('1A');
};

$tests['whitelist filter falls back to the default'] = static function () {
    return Security::oneOf('live', ['sandbox', 'live'], 'sandbox') === 'live'
        && Security::oneOf('evil', ['sandbox', 'live'], 'sandbox') === 'sandbox'
        && Security::oneOf(['array'], ['sandbox'], 'sandbox') === 'sandbox';
};

$tests['free text is stripped of control characters and truncated'] = static function () {
    $dirty = "  hello\x00\x07 world  ";

    return Security::text($dirty) === 'hello world'
        && Security::text('abcdef', 3) === 'abc';
};

$tests['escape neutralises HTML'] = static function () {
    return Security::escape('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;';
};

// --------------------------------------------------------------- providers

$tests['registry advertises the documented capabilities'] = static function () {
    $expected = ['numbers', 'voice', 'sms', 'esim', 'whatsapp', 'email', 'webrtc'];

    return ProviderRegistry::CAPABILITIES === $expected;
};

$tests['every registered provider class exists and is complete'] = static function () {
    foreach (ProviderRegistry::all() as $id => $definition) {
        $class = ProviderRegistry::className($id);

        if (!class_exists($class)) {
            return 'missing class for ' . $id;
        }

        if (!$definition['capabilities']) {
            return $id . ' declares no capabilities';
        }

        foreach (ProviderRegistry::requiredCredentials($id) as $field) {
            if (!in_array($field, ProviderRegistry::credentialFields($id), true)) {
                return $id . ' requires unknown credential ' . $field;
            }
        }
    }

    return true;
};

$tests['required integrations are registered'] = static function () {
    foreach (['twilio' => 'sms', 'vonage' => 'voice', 'airalo' => 'esim', 'truphone' => 'esim'] as $id => $capability) {
        if (!ProviderRegistry::exists($id)) {
            return 'missing provider: ' . $id;
        }

        if (!in_array($capability, ProviderRegistry::capabilities($id), true)) {
            return $id . ' should advertise ' . $capability;
        }
    }

    return true;
};

$tests['no provider pulls in a vendor SDK'] = static function () use ($module) {
    foreach (glob($module . '/lib/Providers/*.php') as $file) {
        $source = (string) file_get_contents($file);

        foreach (['Twilio\\Rest', 'Vonage\\Client', 'SendGrid\\Mail', 'GuzzleHttp\\'] as $needle) {
            if (strpos($source, $needle) !== false) {
                return basename($file) . ' references ' . $needle;
            }
        }
    }

    return true;
};

$tests['provider statuses normalise to the documented vocabulary'] = static function () {
    $calls = ['ringing', 'connected', 'ended', 'failed'];
    $messages = ['queued', 'sent', 'delivered', 'received', 'failed', 'unknown'];

    foreach (['queued', 'ringing', 'in-progress', 'completed', 'busy', 'no-answer', 'anything'] as $status) {
        if (!in_array(TwilioProvider::mapCallStatus($status), $calls, true)) {
            return 'twilio call status ' . $status . ' not normalised';
        }
    }

    foreach (['started', 'ringing', 'answered', 'completed', 'failed', 'rejected'] as $status) {
        if (!in_array(VonageProvider::mapCallStatus($status), $calls, true)) {
            return 'vonage call status ' . $status . ' not normalised';
        }
    }

    foreach (['queued', 'sent', 'delivered', 'undelivered', 'failed', 'weird'] as $status) {
        if (!in_array(TwilioProvider::mapMessageStatus($status), $messages, true)) {
            return 'twilio message status ' . $status . ' not normalised';
        }
    }

    return true;
};

// ------------------------------------------------------------------ routing

$tests['REST surface exposes every documented resource'] = static function () {
    $routes = (new Router())->listRoutes();
    $paths = [];

    foreach ($routes as $route) {
        $paths[] = strtoupper($route['method']) . ' ' . $route['path'];
    }

    $required = [
        'GET /api/health',
        'GET /api/numbers',
        'GET /api/numbers/search',
        'GET /api/numbers/countries',
        'POST /api/numbers/purchase',
        'GET /api/voip/calls',
        'GET /api/voip/token',
        'POST /api/voip/call',
        'GET /api/sms/messages',
        'POST /api/sms/send',
        'POST /api/sms/otp',
        'POST /api/sms/otp/verify',
        'GET /api/esim/plans',
        'GET /api/esim/profiles',
        'POST /api/esim/purchase',
        'GET /api/usage',
        'GET /api/usage/transactions',
    ];

    foreach ($required as $route) {
        if (!in_array($route, $paths, true)) {
            return 'route not registered: ' . $route;
        }
    }

    return true;
};

$tests['every route maps to a callable controller action'] = static function () {
    foreach ((new Router())->listRoutes() as $route) {
        [$class, $method] = $route['handler'];

        if (!class_exists($class)) {
            return 'missing controller ' . $class;
        }

        if (!method_exists($class, $method)) {
            return $class . '::' . $method . '() does not exist';
        }
    }

    return true;
};

$tests['only the health route is unauthenticated'] = static function () {
    foreach ((new Router())->listRoutes() as $route) {
        if ($route['scope'] === '' && $route['path'] !== '/api/health') {
            return $route['path'] . ' has no scope';
        }
    }

    return true;
};

// ------------------------------------------------------------------- runner

$failures = 0;

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

echo "\n" . (count($tests) - $failures) . '/' . count($tests) . " phoneservices checks passed\n";

exit($failures === 0 ? 0 : 1);
