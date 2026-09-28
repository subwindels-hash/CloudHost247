<?php
/**
 * CloudHost247 API & Integrations behavioural tests.
 *
 * Runs without WHMCS: every unit under test is database independent, and the
 * transport, SMTP dialer and clock are injected.
 */
$root = dirname(__DIR__, 2);
$base = $root . '/modules/addons/cloudhost247_integrations/lib/';
foreach (array(
    'Support/Environment', 'Support/ResultCode', 'Support/Redactor', 'Support/IntegrationException',
    'Security/MasterKey', 'Security/SecretVault', 'Security/UrlGuard',
    'Registry/FieldDefinition', 'Registry/ProviderDefinition', 'Registry/ProviderCatalog', 'Registry/ProviderRegistry',
    'Api/Transport', 'Api/TransportException', 'Api/CurlTransport', 'Api/Signers/OvhSigner', 'Api/Signers/AwsV4Signer',
    'Api/IntegrationClient', 'Api/SmtpProbe', 'Services/ConnectionTester', 'Services/AdminView',
) as $file) {
    require_once $base . $file . '.php';
}

use CloudHost247\Integrations\Api\IntegrationClient;
use CloudHost247\Integrations\Api\SmtpProbe;
use CloudHost247\Integrations\Api\Signers\AwsV4Signer;
use CloudHost247\Integrations\Api\Transport;
use CloudHost247\Integrations\Api\TransportException;
use CloudHost247\Integrations\Registry\FieldDefinition;
use CloudHost247\Integrations\Registry\ProviderDefinition;
use CloudHost247\Integrations\Registry\ProviderRegistry;
use CloudHost247\Integrations\Security\MasterKey;
use CloudHost247\Integrations\Security\SecretVault;
use CloudHost247\Integrations\Security\UrlGuard;
use CloudHost247\Integrations\Services\AdminView;
use CloudHost247\Integrations\Services\ConnectionTester;
use CloudHost247\Integrations\Support\Environment;
use CloudHost247\Integrations\Support\Redactor;
use CloudHost247\Integrations\Support\ResultCode;

class RecordingTransport implements Transport
{
    public $calls = array();
    private $responses;
    public function __construct(array $responses) { $this->responses = $responses; }
    public function send($method, $url, array $headers, $body, array $limits)
    {
        $this->calls[] = array('method' => $method, 'url' => $url, 'headers' => $headers, 'body' => $body, 'limits' => $limits);
        $next = array_shift($this->responses);
        if ($next instanceof TransportException) { throw $next; }
        if ($next === null) { $next = array('status' => 200, 'body' => '{}', 'latency_ms' => 1); }
        return $next;
    }
    public function headerText($index = 0) { return implode("\n", $this->calls[$index]['headers']); }
}

$tests = array();
$check = function ($name, $value) use (&$tests) { $tests[$name] = (bool) $value; };

/* ------------------------------------------------------- environment ---- */
putenv('CH247_PLATFORM_ENVIRONMENT=');
unset($GLOBALS['ch247_platform_environment']);
$check('environment defaults to production', Environment::active() === Environment::PRODUCTION && !Environment::isExplicit());
putenv('CH247_PLATFORM_ENVIRONMENT=staging');
$check('environment is read from deployment configuration', Environment::active() === 'staging' && Environment::isExplicit());
$check('environment rejects unknown values', (function () {
    try { Environment::assert('live'); return false; } catch (Throwable $e) { return true; }
})());
$check('production is identified explicitly', Environment::isProduction('production') && !Environment::isProduction('staging'));

/* ------------------------------------------------------- result codes --- */
$check('http 2xx maps to connected', ResultCode::fromHttpStatus(204) === ResultCode::CONNECTED);
$check('http 401 maps to authentication failure', ResultCode::fromHttpStatus(401) === ResultCode::AUTHENTICATION_FAILED);
$check('http 403 maps to permission denied', ResultCode::fromHttpStatus(403) === ResultCode::PERMISSION_DENIED);
$check('http 404 maps to invalid endpoint', ResultCode::fromHttpStatus(404) === ResultCode::INVALID_ENDPOINT);
$check('http 422 maps to invalid configuration', ResultCode::fromHttpStatus(422) === ResultCode::INVALID_CONFIGURATION);
$check('http 503 maps to provider unavailable', ResultCode::fromHttpStatus(503) === ResultCode::PROVIDER_UNAVAILABLE);
$check('transport timeout maps to timeout', ResultCode::fromTransportKind('timeout') === ResultCode::TIMEOUT);
$check('unverified state is labelled not verified', ResultCode::label(ResultCode::UNKNOWN) === 'NOT VERIFIED');

/* ------------------------------------------------------------ url guard - */
putenv('CH247_INTEGRATION_ALLOW_PRIVATE_HOSTS=');
$guard = function ($url, array $policy = array()) {
    try { return UrlGuard::normalizeBase($url, $policy); } catch (Throwable $e) { return false; }
};
$check('https is required', $guard('http://api.example.com') === false);
$check('valid https base is accepted', $guard('https://api.example.com/v1/') === 'https://api.example.com/v1');
$check('credentials in the url are rejected', $guard('https://user:pass@api.example.com') === false);
$check('query strings are rejected', $guard('https://api.example.com/v1?key=abc') === false);
$check('path traversal is rejected', $guard('https://api.example.com/../admin') === false);
$check('loopback hosts are rejected', $guard('https://127.0.0.1/api') === false);
$check('private ranges are rejected', $guard('https://10.1.2.3/api') === false && $guard('https://192.168.1.10/api') === false);
$check('link local metadata host is rejected', $guard('https://169.254.169.254/latest') === false);
$check('bare host names are rejected', $guard('https://intranet/api') === false);
$check('host allowlist is enforced', $guard('https://evil.example/api', array('allowed_hosts' => array('api.example.com'))) === false);
$check('host allowlist suffix is honoured', $guard('https://eu.api.example.com/1.0', array('allowed_hosts' => array('.api.example.com'))) === 'https://eu.api.example.com/1.0');
$check('port allowlist is enforced', $guard('https://panel.example.com:9999/api', array('allowed_ports' => array(443, 2087))) === false);
$check('unsafe api paths are rejected', (function () {
    try { UrlGuard::path('/services/../../etc'); return false; } catch (Throwable $e) { return true; }
})());

/* ----------------------------------------------------------- redaction -- */
$check('urls are stripped of query material', strpos(Redactor::url('https://api.example.com/v1?token=abcdef'), 'abcdef') === false);
$check('authorization headers are redacted', strpos(implode(' ', Redactor::headers(array('Authorization: Bearer abcdef123456'))), 'abcdef123456') === false);
$check('masked secrets never reveal a value', strpos(Redactor::maskedSecret('0123456789abcdef', '2026-01-01 00:00:00'), '0123456789abcdef') === false);

/* --------------------------------------------------------------- vault -- */
putenv('CH247_INTEGRATIONS_KEY=');
MasterKey::forget();
$check('vault fails closed without a deployment key', !MasterKey::available() && !SecretVault::available());
putenv('CH247_INTEGRATIONS_KEY=' . str_repeat('a1b2c3d4', 8));
MasterKey::forget();
$context = array('integration_id' => 7, 'field_key' => 'api_key');
$envelope = SecretVault::encrypt('super-secret-value', $context);
$check('vault key becomes available from deployment configuration', MasterKey::available() && SecretVault::available());
$check('envelope is versioned and does not contain the plaintext', strpos($envelope, 'v1.') === 0 && strpos($envelope, 'super-secret-value') === false);
$check('round trip returns the original credential', SecretVault::decrypt($envelope, $context) === 'super-secret-value');
$check('envelope is bound to its integration row', (function () use ($envelope) {
    try { SecretVault::decrypt($envelope, array('integration_id' => 8, 'field_key' => 'api_key')); return false; } catch (Throwable $e) { return true; }
})());
$check('envelope is bound to its credential field', (function () use ($envelope) {
    try { SecretVault::decrypt($envelope, array('integration_id' => 7, 'field_key' => 'client_secret')); return false; } catch (Throwable $e) { return true; }
})());
$check('tampered ciphertext is rejected', (function () use ($envelope, $context) {
    $parts = explode('.', $envelope);
    $raw = base64_decode($parts[3], true);
    $raw[0] = $raw[0] === 'A' ? 'B' : 'A';
    try { SecretVault::decrypt($parts[0] . '.' . $parts[1] . '.' . $parts[2] . '.' . base64_encode($raw), $context); return false; } catch (Throwable $e) { return true; }
})());
$check('two writes of the same credential differ', SecretVault::encrypt('super-secret-value', $context) !== $envelope);
$check('value fingerprints are stable and short', SecretVault::fingerprintValue('abc') === SecretVault::fingerprintValue('abc') && strlen(SecretVault::fingerprintValue('abc')) === 16);
$check('empty credentials are refused', (function () use ($context) {
    try { SecretVault::encrypt('', $context); return false; } catch (Throwable $e) { return true; }
})());

/* ------------------------------------------------------------ registry -- */
ProviderRegistry::reset();
$definitions = ProviderRegistry::all();
$check('registry exposes the provider catalogue', count($definitions) >= 20);
$catalogueValid = true;
$catalogueProblems = array();
foreach ($definitions as $key => $definition) {
    $health = $definition->health();
    $method = strtoupper((string) $health['method']);
    $path = (string) $health['path'];
    if ($method !== 'SMTP' && $path !== '' && strpos($path, '/') !== 0) { $catalogueValid = false; $catalogueProblems[] = $key . ':path'; }
    if (trim((string) $definition->summary()) === '' || trim((string) $definition->vendor()) === '') { $catalogueValid = false; $catalogueProblems[] = $key . ':description'; }
    if (!$definition->usedBy()) { $catalogueValid = false; $catalogueProblems[] = $key . ':usage'; }
    foreach ($definition->fields() as $field) {
        if ($field->isSecret() && $field->defaultValue() !== '') { $catalogueValid = false; $catalogueProblems[] = $key . ':' . $field->key() . ':default'; }
        if ($field->isSecret() && $field->storage() !== FieldDefinition::STORAGE_SECRET) { $catalogueValid = false; $catalogueProblems[] = $key . ':' . $field->key() . ':storage'; }
    }
    if (strpos($path, '{secret}') !== false || strpos($path, '?') !== false && strpos($path, 'key=') !== false) { $catalogueValid = false; $catalogueProblems[] = $key . ':secret-in-path'; }
}
$check('every registered provider is real and fully described', $catalogueValid);
if (!$catalogueValid) { fwrite(STDERR, 'catalogue problems: ' . implode(', ', $catalogueProblems) . PHP_EOL); }
$check('registry groups providers by category', count(ProviderRegistry::grouped()) >= 10);
$check('unknown providers are rejected', (function () {
    try { ProviderRegistry::get('definitely_not_a_provider'); return false; } catch (Throwable $e) { return true; }
})());
$check('registry accepts new providers without redesign', (function () {
    ProviderRegistry::register(ProviderDefinition::fromArray(array(
        'key' => 'future_provider', 'label' => 'Future provider', 'category' => 'monitoring',
        'vendor' => 'Example', 'summary' => 'Runtime registered provider.', 'used_by' => array('test'),
        'fields' => array(array('key' => 'api_key', 'label' => 'API key', 'type' => 'secret', 'required' => true)),
        'auth' => array('type' => 'bearer', 'secret' => 'api_key'),
        'base_url' => array('mode' => ProviderDefinition::BASE_FIXED, 'url' => 'https://api.example.com'),
        'health' => array('method' => 'GET', 'path' => '/ping'),
    )));
    return ProviderRegistry::has('future_provider');
})());
ProviderRegistry::reset();

/* -------------------------------------------------------------- client -- */
$bearer = ProviderDefinition::fromArray(array(
    'key' => 'demo_bearer', 'label' => 'Demo', 'category' => 'monitoring', 'vendor' => 'Demo', 'summary' => 'Demo provider.',
    'used_by' => array('test'),
    'fields' => array(
        array('key' => 'base_url', 'label' => 'Base URL', 'type' => 'url', 'storage' => 'column', 'required' => true),
        array('key' => 'api_key', 'label' => 'API key', 'type' => 'secret', 'required' => true),
    ),
    'auth' => array('type' => 'bearer', 'secret' => 'api_key'),
    'base_url' => array('mode' => ProviderDefinition::BASE_ADMIN),
    'health' => array('method' => 'GET', 'path' => '/account'),
));
$config = array('base_url' => 'https://api.example.com', 'environment' => 'production', 'timeout_seconds' => 10, 'connect_timeout_seconds' => 3, 'retry_attempts' => 3, 'retry_backoff_ms' => 0, 'options' => array());
$transport = new RecordingTransport(array(array('status' => 200, 'body' => '{"ok":true}', 'latency_ms' => 4)));
$client = new IntegrationClient($bearer, $config, array('api_key' => 'tok_live_secret_value'), $transport);
$response = $client->request('GET', '/account');
$check('bearer credential travels in the authorization header', strpos($transport->headerText(), 'Authorization: Bearer tok_live_secret_value') !== false);
$check('credential never appears in the request url', strpos($transport->calls[0]['url'], 'tok_live_secret_value') === false && $transport->calls[0]['url'] === 'https://api.example.com/account');
$check('json responses are decoded for the health contract', $response['json']['ok'] === true);
$check('endpoint descriptions are safe for audit records', strpos($client->describeEndpoint('/account'), 'tok_live_secret_value') === false);

$transport = new RecordingTransport(array(
    array('status' => 503, 'body' => '', 'latency_ms' => 1),
    array('status' => 429, 'body' => '', 'latency_ms' => 1),
    array('status' => 200, 'body' => '{"ok":true}', 'latency_ms' => 1),
));
(new IntegrationClient($bearer, $config, array('api_key' => 'k'), $transport))->request('GET', '/account');
$check('read requests retry on throttling and provider errors', count($transport->calls) === 3);
$transport = new RecordingTransport(array(array('status' => 503, 'body' => '', 'latency_ms' => 1), array('status' => 200, 'body' => '{}', 'latency_ms' => 1)));
(new IntegrationClient($bearer, $config, array('api_key' => 'k'), $transport))->request('POST', '/account');
$check('write requests are never replayed automatically', count($transport->calls) === 1);

$headerProvider = ProviderDefinition::fromArray(array(
    'key' => 'demo_header', 'label' => 'Demo header', 'category' => 'ai', 'vendor' => 'Demo', 'summary' => 'Demo provider.',
    'used_by' => array('test'),
    'fields' => array(array('key' => 'api_key', 'label' => 'API key', 'type' => 'secret', 'required' => true)),
    'auth' => array('type' => 'header', 'secret' => 'api_key', 'header' => 'x-api-key', 'format' => '{secret}', 'extra_headers' => array('anthropic-version' => '{api_version}')),
    'base_url' => array('mode' => ProviderDefinition::BASE_FIXED, 'url' => 'https://api.example.com/v1'),
    'health' => array('method' => 'GET', 'path' => '/models'),
));
$transport = new RecordingTransport(array(array('status' => 200, 'body' => '{}', 'latency_ms' => 1)));
(new IntegrationClient($headerProvider, array('api_version' => '2023-06-01', 'options' => array()), array('api_key' => 'sk-demo'), $transport))->request('GET', '/models');
$check('custom header strategies place the credential in a header', strpos($transport->headerText(), 'x-api-key: sk-demo') !== false && strpos($transport->headerText(), 'anthropic-version: 2023-06-01') !== false);

$pathProvider = ProviderDefinition::fromArray(array(
    'key' => 'demo_path', 'label' => 'Demo path', 'category' => 'telegram', 'vendor' => 'Demo', 'summary' => 'Demo provider.',
    'used_by' => array('test'),
    'fields' => array(array('key' => 'access_token', 'label' => 'Bot token', 'type' => 'secret', 'required' => true)),
    'auth' => array('type' => 'path_token', 'secret' => 'access_token', 'prefix' => 'bot'),
    'base_url' => array('mode' => ProviderDefinition::BASE_FIXED, 'url' => 'https://api.example.com'),
    'health' => array('method' => 'GET', 'path' => '/{path_token}/getMe'),
));
$transport = new RecordingTransport(array(array('status' => 200, 'body' => '{"ok":true}', 'latency_ms' => 1)));
(new IntegrationClient($pathProvider, array('options' => array()), array('access_token' => '123456:AAEabcdefghij'), $transport))->request('GET', '/{path_token}/getMe');
$check('path token protocols use the documented path segment', $transport->calls[0]['url'] === 'https://api.example.com/bot123456:AAEabcdefghij/getMe');
$check('path token protocols never use a query string', strpos($transport->calls[0]['url'], '?') === false);

$formProvider = ProviderDefinition::fromArray(array(
    'key' => 'demo_form', 'label' => 'Demo form', 'category' => 'social', 'vendor' => 'Demo', 'summary' => 'Demo provider.',
    'used_by' => array('test'),
    'fields' => array(
        array('key' => 'base_url', 'label' => 'Base URL', 'type' => 'url', 'storage' => 'column', 'required' => true),
        array('key' => 'api_key', 'label' => 'API key', 'type' => 'secret', 'required' => true),
    ),
    'auth' => array('type' => 'form_field', 'secret' => 'api_key', 'field' => 'key'),
    'base_url' => array('mode' => ProviderDefinition::BASE_ADMIN),
    'health' => array('method' => 'POST', 'path' => '/api/v2', 'form' => array('action' => 'balance')),
));
$transport = new RecordingTransport(array(array('status' => 200, 'body' => '{"balance":"1"}', 'latency_ms' => 1)));
(new IntegrationClient($formProvider, array('base_url' => 'https://panel.example.com', 'options' => array()), array('api_key' => 'panelkey'), $transport))
    ->request('POST', '/api/v2', array('form' => array('action' => 'balance')));
$check('panel protocols put the key in the request body, not the url', strpos($transport->calls[0]['body'], 'key=panelkey') !== false && strpos($transport->calls[0]['url'], 'panelkey') === false);

$ovhProvider = ProviderRegistry::get('ovh');
$transport = new RecordingTransport(array(
    array('status' => 200, 'body' => (string) time(), 'latency_ms' => 1),
    array('status' => 200, 'body' => '{"status":"validated"}', 'latency_ms' => 1),
));
(new IntegrationClient($ovhProvider, array('region' => 'eu', 'options' => array()), array(
    'application_key' => 'application-key', 'application_secret' => 'application-secret', 'consumer_key' => 'consumer-key',
), $transport))->request('GET', '/auth/currentCredential');
$signed = $transport->headerText(1);
$check('ovh requests are signed without leaking the secret', strpos($signed, 'X-Ovh-Signature: $1$') !== false && strpos($signed, 'application-secret') === false);
$check('ovh requests send the consumer key header', strpos($signed, 'X-Ovh-Consumer: consumer-key') !== false);

/* AWS Signature Version 4, published get-vanilla test vector. */
$stringToSign = "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n"
    . "816cd5b414d056048ba4f7c5386d6e0533120fb1fcfa93762cf0fc39e2cf19e0";
$check('aws signature version 4 matches the published test vector',
    AwsV4Signer::signature('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830', 'us-east-1', 'service', $stringToSign)
    === 'b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500');
$check('aws signing keys are derived per date, region and service',
    AwsV4Signer::signingKey('secret', '20150830', 'us-east-1', 's3') !== AwsV4Signer::signingKey('secret', '20150831', 'us-east-1', 's3'));

/* --------------------------------------------------------- smtp probe --- */
/**
 * Deterministic SMTP relay: replays a scripted server conversation and
 * discards whatever the probe writes, so the handshake is exercised without a
 * network connection or a real credential.
 */
class ScriptedSmtpStream
{
    public static $script = array();
    public $context;
    private $buffer = '';
    public function stream_open($path, $mode, $options, &$openedPath)
    {
        $this->buffer = implode("\r\n", self::$script) . "\r\n";
        return true;
    }
    /** One line per read so a following write cannot discard buffered replies. */
    public function stream_read($count)
    {
        $newline = strpos($this->buffer, "\n");
        $length = $newline === false ? min($count, strlen($this->buffer)) : min($count, $newline + 1);
        $chunk = substr($this->buffer, 0, $length);
        $this->buffer = (string) substr($this->buffer, $length);
        return $chunk;
    }
    public function stream_write($data) { return strlen($data); }
    public function stream_eof() { return $this->buffer === ''; }
    public function stream_close() { $this->buffer = ''; }
    public function stream_flush() { return true; }
    public function stream_set_option($option, $arg1, $arg2) { return true; }
    public function stream_stat() { return array(); }
}
stream_wrapper_register('ch247smtp', 'ScriptedSmtpStream');
$smtpScript = function (array $lines) {
    return function ($host, $port, $connectTimeout, $implicitTls) use ($lines) {
        ScriptedSmtpStream::$script = $lines;
        return fopen('ch247smtp://relay', 'r+');
    };
};
$probe = new SmtpProbe($smtpScript(array('220 relay ready', '250-relay', '250 AUTH LOGIN PLAIN', '334 VXNlcm5hbWU6', '334 UGFzc3dvcmQ6', '235 accepted', '221 bye')));
$result = $probe->check(array('host' => 'smtp.example.com', 'port' => 465, 'encryption' => 'ssl', 'username' => 'postmaster@example.com', 'password' => 'secret'));
$check('smtp authentication success is reported as connected', $result['code'] === ResultCode::CONNECTED);
$probe = new SmtpProbe($smtpScript(array('220 relay ready', '250-relay', '250 AUTH LOGIN', '334 VXNlcm5hbWU6', '334 UGFzc3dvcmQ6', '535 5.7.8 bad credentials')));
$result = $probe->check(array('host' => 'smtp.example.com', 'port' => 465, 'encryption' => 'ssl', 'username' => 'postmaster@example.com', 'password' => 'wrong-password'));
$check('smtp rejection is reported as an authentication failure', $result['code'] === ResultCode::AUTHENTICATION_FAILED);
$check('smtp detail never repeats the credential', strpos($result['detail'], 'wrong-password') === false);
$probe = new SmtpProbe($smtpScript(array('220 relay ready', '250 relay only')));
$result = $probe->check(array('host' => 'smtp.example.com', 'port' => 587, 'encryption' => 'tls', 'username' => 'postmaster@example.com', 'password' => 'secret'));
$check('a relay without starttls is reported as invalid configuration', $result['code'] === ResultCode::INVALID_CONFIGURATION);
$result = (new SmtpProbe($smtpScript(array('220 ok'))))->check(array('host' => 'localhost', 'port' => 25, 'encryption' => 'tls', 'username' => 'u', 'password' => 'p'));
$check('smtp requires a fully qualified relay host', $result['code'] === ResultCode::INVALID_CONFIGURATION);
$result = (new SmtpProbe($smtpScript(array('220 ok'))))->check(array('host' => 'smtp.example.com', 'port' => 587, 'encryption' => 'tls', 'username' => '', 'password' => ''));
$check('smtp refuses to test without credentials', $result['code'] === ResultCode::INVALID_CONFIGURATION);

/* -------------------------------------------------- connection tester --- */
$tester = function (array $responses) { return new ConnectionTester(new RecordingTransport($responses)); };
$once = array_merge($config, array('retry_attempts' => 1));
$result = $tester(array(array('status' => 200, 'body' => '{"ok":true}', 'latency_ms' => 5)))->check($bearer, $config, array('api_key' => 'k'));
$check('a healthy provider reports connected', $result['code'] === ResultCode::CONNECTED);
$result = $tester(array(array('status' => 401, 'body' => '{"error":"invalid key"}', 'latency_ms' => 5)))->check($bearer, $config, array('api_key' => 'k'));
$check('rejected credentials report an authentication failure', $result['code'] === ResultCode::AUTHENTICATION_FAILED);
$check('provider error text is never echoed back', strpos($result['detail'], 'invalid key') === false);
$result = $tester(array(array('status' => 403, 'body' => '{}', 'latency_ms' => 5)))->check($bearer, $config, array('api_key' => 'k'));
$check('insufficient scopes report permission denied', $result['code'] === ResultCode::PERMISSION_DENIED);
$result = $tester(array(new TransportException('timeout')))->check($bearer, $once, array('api_key' => 'k'));
$check('a slow provider reports a timeout', $result['code'] === ResultCode::TIMEOUT);
$result = $tester(array(new TransportException('dns')))->check($bearer, $once, array('api_key' => 'k'));
$check('an unresolvable host reports an invalid endpoint', $result['code'] === ResultCode::INVALID_ENDPOINT);

$strict = ProviderDefinition::fromArray(array(
    'key' => 'demo_strict', 'label' => 'Demo strict', 'category' => 'notifications', 'vendor' => 'Demo', 'summary' => 'Demo provider.',
    'used_by' => array('test'),
    'fields' => array(array('key' => 'api_key', 'label' => 'API key', 'type' => 'secret', 'required' => true)),
    'auth' => array('type' => 'bearer', 'secret' => 'api_key'),
    'base_url' => array('mode' => ProviderDefinition::BASE_FIXED, 'url' => 'https://api.example.com'),
    'health' => array('method' => 'GET', 'path' => '/auth.test', 'expect' => array('json' => true, 'equals' => array('ok' => true), 'failure_code' => ResultCode::AUTHENTICATION_FAILED)),
));
$result = $tester(array(array('status' => 200, 'body' => '{"ok":false,"error":"invalid_auth"}', 'latency_ms' => 2)))->check($strict, array('options' => array()), array('api_key' => 'k'));
$check('a 200 response that reports failure is not a fake success', $result['code'] === ResultCode::AUTHENTICATION_FAILED);
$result = $tester(array(array('status' => 200, 'body' => 'not json at all', 'latency_ms' => 2)))->check($strict, array('options' => array()), array('api_key' => 'k'));
$check('an unreadable payload is not treated as connected', $result['code'] === ResultCode::PROVIDER_UNAVAILABLE);
$result = $tester(array(array('status' => 200, 'body' => '{"ok":true}', 'latency_ms' => 2)))->check($strict, array('options' => array()), array('api_key' => 'k'));
$check('a provider that confirms success reports connected', $result['code'] === ResultCode::CONNECTED);

$result = (new ConnectionTester(new RecordingTransport(array())))->check($bearer, array('base_url' => 'http://api.example.com', 'options' => array()), array('api_key' => 'k'));
$check('an unsafe endpoint is reported as invalid configuration', $result['code'] === ResultCode::INVALID_CONFIGURATION);

$check('only sanitized classifications are exposed', ResultCode::all() === array(
    'connected', 'authentication_failed', 'invalid_endpoint', 'timeout', 'provider_unavailable',
    'invalid_configuration', 'permission_denied', 'disabled', 'not_configured', 'unknown',
));

/* ------------------------------------------------------- administration -- */

$resultCodeLabels = array();
foreach (ResultCode::all() as $code) { $resultCodeLabels[$code] = ResultCode::label($code); }
$secretValue = 'sk_live_super_secret_value_9f8c2a7b';
$view = new AdminView('addonmodules.php?module=cloudhost247_integrations');
$ovh = ProviderRegistry::get('ovh');
$stripe = ProviderRegistry::get('stripe');

$chrome = array(
    'environment' => 'production', 'active_environment' => 'production', 'environment_explicit' => true,
    'environment_source' => 'CH247_PLATFORM_ENVIRONMENT', 'environments' => Environment::supported(),
    'vault_ready' => true, 'vault_source' => 'CH247_INTEGRATIONS_KEY', 'key_variable' => 'CH247_INTEGRATIONS_KEY',
    'notice' => '', 'error' => '', 'test' => null, 'token' => 'csrf-token-value',
    'categories' => ProviderRegistry::categories(), 'result_codes' => $resultCodeLabels,
);

$overview = array(
    array(
        'definition' => $ovh, 'display_name' => 'OVHcloud API', 'configured' => true, 'enabled' => true,
        'integration_id' => 7, 'environment' => 'production', 'status' => ResultCode::CONNECTED,
        'status_label' => ResultCode::label(ResultCode::CONNECTED), 'last_checked_at' => '2026-09-28 06:00:00',
        'last_success_at' => '2026-09-28 06:00:00', 'last_failure_at' => null, 'last_failure_reason' => null,
    ),
    array(
        'definition' => $stripe, 'display_name' => 'Stripe', 'configured' => false, 'enabled' => false,
        'integration_id' => 0, 'environment' => 'production', 'status' => ResultCode::NOT_CONFIGURED,
        'status_label' => ResultCode::label(ResultCode::NOT_CONFIGURED), 'last_checked_at' => null,
        'last_success_at' => null, 'last_failure_at' => null, 'last_failure_reason' => null,
    ),
    array(
        'definition' => ProviderRegistry::get('telegram'), 'display_name' => 'Telegram Bot API', 'configured' => true,
        'enabled' => false, 'integration_id' => 9, 'environment' => 'production', 'status' => ResultCode::UNKNOWN,
        'status_label' => ResultCode::label(ResultCode::UNKNOWN), 'last_checked_at' => null,
        'last_success_at' => null, 'last_failure_at' => null, 'last_failure_reason' => null,
    ),
);

$dashboard = $view->render(array_merge($chrome, array('view' => 'dashboard', 'overview' => $overview)));
$check('dashboard renders the required health columns', strpos($dashboard, '<th>Integration</th><th>Status</th><th>Environment</th><th>Last check</th>') !== false);
$check('dashboard offers configure and test actions', strpos($dashboard, '>Configure</a>') !== false && strpos($dashboard, '>Test</button>') !== false);
$check('dashboard shows untested integrations as not verified', strpos($dashboard, 'NOT VERIFIED') !== false && strpos($dashboard, 'Not configured') !== false && strpos($dashboard, 'never') !== false);
$check('dashboard marks a configured but switched off integration as disabled', strpos($dashboard, '>DISABLED</span>') !== false);
$check('dashboard states that no status is simulated', strpos($dashboard, 'no status on this page is simulated') !== false);
$check('dashboard carries a csrf token on every action form', substr_count($dashboard, 'name="token"') >= 2);
$check('administration emits no javascript', stripos($dashboard, '<script') === false && stripos($dashboard, 'onclick=') === false);

$row = (object) array(
    'id' => 7, 'environment' => 'production', 'status' => ResultCode::CONNECTED, 'created_at' => '2026-09-01 10:00:00',
    'updated_at' => '2026-09-28 06:00:00', 'last_success_at' => '2026-09-28 06:00:00', 'last_failure_at' => null,
);
$configure = $view->render(array_merge($chrome, array(
    'view' => 'configure', 'provider' => $stripe, 'row' => $row,
    'configuration' => array('display_name' => 'Stripe', 'enabled' => true, 'timeout_seconds' => 15, 'options' => array()),
    'secret_metadata' => array('api_key' => array('masked' => '••••••••••••1a2b3c4d', 'stale_key' => false, 'rotated_at' => '2026-09-01 10:00:00')),
)));
$check('credential inputs are empty password fields', strpos($configure, 'type="password" id="ch247-field-api_key" name="api_key" value=""') !== false);
$check('a stored credential is shown only as a mask', strpos($configure, '••••••••••••1a2b3c4d') !== false && strpos($configure, $secretValue) === false);
$check('blank credential fields keep the stored value', strpos($configure, 'Leave blank to keep the stored credential') !== false && strpos($configure, 'Leave the field blank to keep it unchanged') !== false);
$check('production saves require an explicit confirmation', strpos($configure, 'name="confirm_production"') !== false && strpos($configure, 'PRODUCTION CONFIGURATION') !== false);
$check('deletion requires an explicit confirmation', strpos($configure, 'name="confirm_delete"') !== false);
$check('rotation replaces one credential at a time', strpos($configure, 'name="operation" value="rotate"') !== false && strpos($configure, 'name="field_key" value="api_key"') !== false);
$check('configure screen documents credentials and scopes', strpos($configure, 'Required scopes') !== false && strpos($configure, 'Connection test') !== false);
$check('configure screen exposes timeout and retry policy', strpos($configure, 'name="timeout_seconds"') !== false && strpos($configure, 'name="retry_attempts"') !== false);

$stale = $view->render(array_merge($chrome, array(
    'view' => 'configure', 'provider' => $stripe, 'row' => $row,
    'configuration' => array('display_name' => 'Stripe', 'enabled' => true, 'options' => array()),
    'secret_metadata' => array('api_key' => array('masked' => '••••••••••••1a2b3c4d', 'stale_key' => true, 'rotated_at' => '2026-01-01 10:00:00')),
)));
$check('credentials encrypted with a previous key are flagged', strpos($stale, 'Encrypted with a previous master key') !== false);

$locked = $view->render(array_merge($chrome, array(
    'view' => 'configure', 'provider' => ProviderRegistry::get('whm'), 'row' => null,
    'configuration' => null, 'secret_metadata' => array(),
)));
$check('endpoint port restrictions are shown to the administrator', strpos($locked, 'Permitted ports: 443, 2087') !== false);
$check('administrator endpoints are documented as https only', strpos($locked, 'Only HTTPS URLs without credentials, query strings or fragments are accepted.') !== false);

$broken = $view->render(array_merge($chrome, array(
    'view' => 'dashboard', 'overview' => $overview, 'vault_ready' => false,
    'error' => 'Credential encryption is unavailable.',
)));
$check('a missing deployment key is reported, not worked around', strpos($broken, 'Credential encryption is not available.') !== false && strpos($broken, 'CH247_INTEGRATIONS_KEY') !== false);

$mixed = $view->render(array_merge($chrome, array(
    'view' => 'dashboard', 'overview' => $overview, 'environment' => 'staging',
    'active_environment' => 'production',
)));
$check('a mismatched environment is called out before saving', strpos($mixed, 'STAGING') !== false && strpos($mixed, 'PRODUCTION') !== false);

$catalog = $view->render(array_merge($chrome, array('view' => 'catalog', 'overview' => $overview)));
$check('catalogue lists required credentials and where to obtain them', strpos($catalog, '<th>Required credentials</th>') !== false && strpos($catalog, 'Where to obtain credentials') !== false);
$check('catalogue states there are no placeholder integrations', strpos($catalog, 'no placeholder integrations') !== false);

$events = $view->render(array_merge($chrome, array(
    'view' => 'events', 'event_filters' => array('provider_key' => 'ovh'),
    'events' => array('rows' => array((object) array(
        'created_at' => '2026-09-28 06:00:00', 'provider_key' => 'ovh', 'environment' => 'production',
        'event_type' => 'health_check', 'result_code' => ResultCode::AUTHENTICATION_FAILED, 'latency_ms' => 412,
        'detail' => 'The provider rejected the stored credentials.', 'correlation_id' => 'ch247-abc123',
    )), 'page' => 1, 'pages' => 1, 'total' => 1),
)));
$check('event history is sanitized and correlatable', strpos($events, 'ch247-abc123') !== false && strpos($events, 'Authentication failed') !== false);
$check('event history never stores provider payloads', strpos($events, 'credentials and stack traces are never stored') !== false);

$all = $dashboard . $configure . $stale . $locked . $broken . $mixed . $catalog . $events;
$check('no rendered screen contains a credential', strpos($all, $secretValue) === false && strpos($all, 'csrf-token-value') !== false);


putenv('CH247_INTEGRATIONS_KEY=');
putenv('CH247_PLATFORM_ENVIRONMENT=');
MasterKey::forget();

$fail = 0;
foreach ($tests as $name => $ok) { echo ($ok ? 'ok' : 'not ok') . " - $name\n"; if (!$ok) { $fail++; } }
exit($fail ? 1 : 0);
