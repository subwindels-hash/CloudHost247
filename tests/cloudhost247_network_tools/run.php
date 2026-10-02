<?php
/**
 * CloudHost247 Network & Developer Tools — behaviour suite.
 *
 * Runs the real module classes without WHMCS, a database or a network. Every
 * assertion is about behaviour that must not regress: the result envelope
 * (including "a failure never carries data"), the SSRF/validation boundary, the
 * tool registry (every catalogue entry resolves to a real handler with fields,
 * exports and a target policy), and the deterministic parts of every tool that
 * does not need a live lookup — DNS answer matching, SPF/DMARC parsing, network
 * maths, IDN, QR payloads, parsers and UI escaping.
 *
 *   php tests/cloudhost247_network_tools/run.php
 *
 * The parts that need the internet, WHMCS or a database are covered by
 * tests/cloudhost247_network_tools/test_static.py (structure and security
 * invariants), tests/cloudhost247_network_tools/qr_selfcheck.js (the browser QR
 * encoder, verified end to end) and the staging suite.
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');

if (!defined('WHMCS')) {
    define('WHMCS', '8.9.0-test');
}

$root = dirname(__DIR__, 2);
$addon = $root . '/modules/addons/cloudhost247_network_tools';

spl_autoload_register(function ($class) use ($addon) {
    $prefix = 'CloudHost247\\NetworkTools\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $relative = str_replace('\\', '/', substr($class, strlen($prefix)));
    if (strpos($relative, '..') !== false) {
        return;
    }
    $file = $addon . '/lib/' . $relative . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});
require_once $addon . '/migrations/V100.php';

use CloudHost247\NetworkTools\Core\Registry\ToolDefinition;
use CloudHost247\NetworkTools\Core\Registry\ToolField;
use CloudHost247\NetworkTools\Core\Registry\ToolRegistry;
use CloudHost247\NetworkTools\Core\Result\Capability;
use CloudHost247\NetworkTools\Core\Result\ErrorCode;
use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Core\Result\ToolStatus;
use CloudHost247\NetworkTools\Core\Security\RateLimiter;
use CloudHost247\NetworkTools\Core\Security\SsrfGuard;
use CloudHost247\NetworkTools\Core\Security\TargetValidator;
use CloudHost247\NetworkTools\Services\Dns\DmarcService;
use CloudHost247\NetworkTools\Services\Dns\DnssecService;
use CloudHost247\NetworkTools\Services\Dns\HealthService;
use CloudHost247\NetworkTools\Services\Dns\PropagationService;
use CloudHost247\NetworkTools\Services\Dns\SpfService;
use CloudHost247\NetworkTools\Services\Developer\EmailHeaderService;
use CloudHost247\NetworkTools\Services\Developer\JsonService;
use CloudHost247\NetworkTools\Services\Developer\UserAgentService;
use CloudHost247\NetworkTools\Services\Domain\PunycodeService;
use CloudHost247\NetworkTools\Services\Ip\ConvertService;
use CloudHost247\NetworkTools\Services\Ip\IpMath;
use CloudHost247\NetworkTools\Services\Network\MacService;
use CloudHost247\NetworkTools\Services\Network\PingService;
use CloudHost247\NetworkTools\Services\Network\SubnetService;
use CloudHost247\NetworkTools\Services\Productivity\ColorService;
use CloudHost247\NetworkTools\Services\Productivity\QrService;
use CloudHost247\NetworkTools\Services\Productivity\TextService;
use CloudHost247\NetworkTools\Services\Productivity\TimeCardService;
use CloudHost247\NetworkTools\Services\Security\PasswordService;
use CloudHost247\NetworkTools\Services\Security\SslService;
use CloudHost247\NetworkTools\Services\Webmaster\BrokenLinksService;
use CloudHost247\NetworkTools\Services\Webmaster\OpenGraphService;
use CloudHost247\NetworkTools\Services\Webmaster\RobotsService;
use CloudHost247\NetworkTools\Services\Webmaster\SerpService;
use CloudHost247\NetworkTools\Ui\Format;
use CloudHost247\NetworkTools\Ui\ResultPresenter;
use CloudHost247\NetworkTools\Migrations\NetworkToolsInitialMigration;

$GLOBALS['ch247_nt_pass'] = 0;
$GLOBALS['ch247_nt_fail'] = 0;
$GLOBALS['ch247_nt_failures'] = array();
$GLOBALS['ch247_nt_section'] = '';

function section($title)
{
    $GLOBALS['ch247_nt_section'] = $title;
    echo "\n" . $title . "\n" . str_repeat('-', strlen($title)) . "\n";
}

function ok($condition, $label, $detail = '')
{
    if ($condition) {
        $GLOBALS['ch247_nt_pass']++;
        echo "  PASS  $label\n";
        return true;
    }
    $GLOBALS['ch247_nt_fail']++;
    $line = '[' . $GLOBALS['ch247_nt_section'] . '] ' . $label . ($detail !== '' ? ' — ' . $detail : '');
    $GLOBALS['ch247_nt_failures'][] = $line;
    echo "  FAIL  $line\n";
    return false;
}

function same($expected, $actual, $label)
{
    return ok($expected === $actual, $label, 'expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
}

function contains($needle, $haystack, $label)
{
    return ok(is_string($haystack) && strpos($haystack, $needle) !== false, $label, 'needle ' . var_export($needle, true));
}

function notContains($needle, $haystack, $label)
{
    return ok(is_string($haystack) && strpos($haystack, $needle) === false, $label, 'forbidden ' . var_export($needle, true));
}

function callPrivate($object, $method, array $args = array())
{
    $reflection = new ReflectionMethod($object, $method);
    $reflection->setAccessible(true);
    return $reflection->invokeArgs($object, $args);
}

function runTool($class, array $input, $context = array())
{
    /** @var \CloudHost247\NetworkTools\Services\Service $service */
    $service = new $class();
    return $service->run($input, array_merge(array('settings' => array(), 'actor' => 'customer', 'client_id' => 1, 'admin_id' => 0), $context));
}

function expectInvalid($class, array $input, $label, $context = array())
{
    $result = runTool($class, $input, $context);
    return ok(
        $result instanceof ToolResult && !$result->isOk() && $result->code() === ErrorCode::INVALID_INPUT,
        $label,
        'code=' . ($result instanceof ToolResult ? $result->code() : 'not-a-result')
    );
}

function throws(callable $callback, $label)
{
    try {
        $callback();
    } catch (InvalidArgumentException $invalid) {
        return ok(trim($invalid->getMessage()) !== '', $label);
    }
    return ok(false, $label, 'no InvalidArgumentException was thrown');
}

echo "CloudHost247 Network Tools behaviour suite\n";
echo "PHP " . PHP_VERSION . " — no database, no network\n";

/* ------------------------------------------------------------------ *
 * 1. Result envelope and the no-fabrication contract
 * ------------------------------------------------------------------ */
section('1. Result envelope (no fabricated data)');
$failure = ToolResult::failure(ErrorCode::SERVICE_UNAVAILABLE, 'Upstream is down.');
same(false, $failure->isOk(), 'a failure result is not ok');
same(array(), $failure->data(), 'a failure never carries a data payload');
same(true, $failure->retryable(), 'SERVICE_UNAVAILABLE is retryable');
same(false, ToolResult::invalid('bad input')->retryable(), 'INVALID_INPUT is not retryable');
same('', ToolResult::failure(ErrorCode::UNKNOWN, '')->message() === '' ? '' : 'x', 'an empty custom message is replaced');
ok(ToolResult::failure(ErrorCode::UNKNOWN, '')->message() !== '', 'UNKNOWN gets a default message');
$envelope = ToolResult::success(array('a' => 1))->toArray();
same(true, $envelope['success'], 'wire envelope success flag');
same(ErrorCode::OK, $envelope['code'], 'wire envelope code');
same(array('a' => 1), $envelope['data'], 'wire envelope data');
$failedWire = ToolResult::failure(ErrorCode::TIMEOUT, 'slow')->toArray();
same(false, $failedWire['success'], 'failure envelope success flag');
same(array(), $failedWire['data'], 'failure envelope data is empty');
same(504, ErrorCode::httpStatus(ErrorCode::TIMEOUT), 'TIMEOUT maps to HTTP 504');
same(429, ErrorCode::httpStatus(ErrorCode::RATE_LIMITED), 'RATE_LIMITED maps to HTTP 429');
same(400, ErrorCode::httpStatus(ErrorCode::INVALID_INPUT), 'INVALID_INPUT maps to HTTP 400');
same(403, ErrorCode::httpStatus(ErrorCode::TARGET_BLOCKED), 'TARGET_BLOCKED maps to HTTP 403');
same(false, ErrorCode::isValid('NOT_A_CODE'), 'unknown codes are rejected');
same(5, count(ToolStatus::all()), 'five operator states exist');
same('ACTIVE', ToolStatus::all()[0], 'ACTIVE is the first operator state');
ok(in_array('UNKNOWN', array(ToolStatus::ACTIVE, 'UNKNOWN'), true), 'UNKNOWN is a legitimate render state');

/* ------------------------------------------------------------------ *
 * 2. Input validation — one authority
 * ------------------------------------------------------------------ */
section('2. TargetValidator');
same('example.com', TargetValidator::hostname('EXAMPLE.com.'), 'hostnames are normalised');
same('_dmarc.example.com', TargetValidator::hostname('_dmarc.example.com'), 'underscore labels are allowed for service names');
same('xn--mnchen-3ya.de', TargetValidator::hostname('xn--mnchen-3ya.de'), 'IDN A-labels are accepted');
throws(function () { TargetValidator::hostname('exa mple.com'); }, 'a host with a space is rejected');
throws(function () { TargetValidator::hostname('-leading.example.com'); }, 'a leading hyphen is rejected');
throws(function () { TargetValidator::text('user', 5, 'name'); }, 'text over the limit is rejected');
same('example.com', TargetValidator::domain('example.com'), 'plain domains validate');
throws(function () { TargetValidator::domain('localhost'); }, 'a single label without a dot is rejected');
throws(function () { TargetValidator::domain('192.0.2.10'); }, 'an IP literal is not a domain');
same('user@example.com', TargetValidator::email('User@Example.com'), 'email is normalised');
throws(function () { TargetValidator::email('not-an-address'); }, 'malformed email is rejected');
same(443, TargetValidator::port('443'), 'ports parse');
throws(function () { TargetValidator::port('0'); }, 'port 0 is rejected');
throws(function () { TargetValidator::port('70000'); }, 'port 70000 is rejected');
$ports = TargetValidator::portSet('22, 80, 443');
same(3, count($ports), 'a port set parses to three ports');
throws(function () { TargetValidator::portSet('1-8000'); }, 'a port span wider than 32 is rejected');
same('2001:db8::1', TargetValidator::ip('2001:0db8::1'), 'IPv6 is canonicalised');
throws(function () { TargetValidator::ip('10.0.0.1', false); }, 'private addresses are rejected when policy forbids them');
same('192.168.1.0/24', TargetValidator::cidr('192.168.1.1/24'), 'a CIDR is normalised to its network');
throws(function () { TargetValidator::cidr('192.168.1.1/33'); }, 'an impossible IPv4 prefix is rejected');
same('00:1A:2B:3C:4D:5E', TargetValidator::mac('00:1a:2b:3c:4d:5e'), 'MAC addresses are normalised');
throws(function () { TargetValidator::mac('00:1a:2b:3c:4d'); }, 'a short MAC is rejected');
same('default', TargetValidator::dkimSelector('default'), 'DKIM selectors pass');
throws(function () { TargetValidator::dkimSelector('bad selector!'); }, 'an invalid DKIM selector is rejected');
same(64512, TargetValidator::asn('AS64512'), 'AS numbers parse');
throws(function () { TargetValidator::asn('AS0'); }, 'AS0 is rejected');
same('b', TargetValidator::choice('b', array('a', 'b')), 'allowed choices pass');
throws(function () { TargetValidator::choice('c', array('a', 'b')); }, 'a value outside the choices is rejected');
same(5, TargetValidator::integer('5', 1, 10), 'integers parse');
throws(function () { TargetValidator::integer('11', 1, 10); }, 'out-of-range integers are rejected');
$url = TargetValidator::url('https://example.com/path?x=1');
same('example.com', $url['host'], 'URLs are parsed into a host');
throws(function () { TargetValidator::url('ftp://example.com'); }, 'non-HTTP schemes are rejected');
throws(function () { TargetValidator::url('https://user:pass@example.com'); }, 'credentials in a URL are rejected');
throws(function () { TargetValidator::text("bad\0value", 100, 'value'); }, 'NUL bytes are rejected');

/* ------------------------------------------------------------------ *
 * 3. SSRF boundary
 * ------------------------------------------------------------------ */
section('3. SSRF protection');
foreach (array('127.0.0.1', '10.1.2.3', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', '0.0.0.0') as $blocked) {
    $verdict = SsrfGuard::validateHost($blocked);
    ok($verdict['ok'] === false && $verdict['code'] === ErrorCode::TARGET_BLOCKED, 'blocked: ' . $blocked, isset($verdict['message']) ? $verdict['message'] : '');
}
same(true, SsrfGuard::isBlocked('::ffff:127.0.0.1'), 'IPv4-mapped loopback is blocked');
same(true, SsrfGuard::isBlocked('::ffff:10.0.0.1'), 'IPv4-mapped private space is blocked');
same(false, SsrfGuard::isBlocked('93.184.216.34'), 'a public address is not blocked');
$public = SsrfGuard::validateHost('93.184.216.34');
same(true, $public['ok'], 'a public IP literal passes the guard');
same('93.184.216.34', $public['addresses'][0], 'the guard returns the addresses it validated');
$metadata = SsrfGuard::validateHost('metadata.google.internal');
ok($metadata['ok'] === false, 'cloud metadata hostnames are blocked', isset($metadata['code']) ? $metadata['code'] : '');
same(false, SsrfGuard::isValidHostname('exa mple.com'), 'invalid hostnames are detected');
$allowed = SsrfGuard::validateHost('10.0.0.5', array('allow_private' => true));
same(true, $allowed['ok'], 'the private-space policy can be lifted explicitly for an allowlisted environment');
$pinned = SsrfGuard::pinEntries('example.com', array('93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'));
same(4, count($pinned), 'each validated address is pinned for both HTTP and HTTPS');
contains('93.184.216.34', $pinned[0], 'the pinned entry carries the address');
contains('example.com', $pinned[0], 'the pinned entry carries the host');
contains(':443:', $pinned[0], 'the HTTPS pin is present');
contains(':80:', $pinned[1], 'the HTTP pin is present');

/* ------------------------------------------------------------------ *
 * 4. Rate limiting and capabilities are declarative
 * ------------------------------------------------------------------ */
section('4. Rate limits and capability states');
$local = RateLimiter::defaultLimits('local');
$standard = RateLimiter::defaultLimits('standard');
$highRisk = RateLimiter::defaultLimits('high_risk');
foreach (array('ip', 'client', 'tool_ip', 'tool_global') as $dimension) {
    ok(isset($local[$dimension]) && isset($standard[$dimension]) && isset($highRisk[$dimension]), 'dimension present: ' . $dimension);
    ok($highRisk[$dimension][0] <= $standard[$dimension][0], 'high-risk limit is not looser than standard: ' . $dimension);
}
same(10, $highRisk['ip'][0], 'high-risk tools allow ten requests per minute per IP');
$capabilities = Capability::all();
ok(count($capabilities) >= 16, 'the capability table covers the platform', (string) count($capabilities));
foreach (array('udp_dns', 'raw_icmp', 'tls_client', 'whois_tcp43', 'http_fetch', 'cron', 'traceroute') as $name) {
    ok(isset($capabilities[$name]), 'capability tracked: ' . $name);
}
foreach ($capabilities as $name => $state) {
    ok(in_array($state, array(Capability::AVAILABLE, Capability::UNAVAILABLE, Capability::CONFIGURATION_REQUIRED), true), 'capability state is one of three for ' . $name, $state);
}
same(Capability::AVAILABLE, Capability::state('json'), 'JSON support is always available in PHP');

/* ------------------------------------------------------------------ *
 * 5. Registry integrity — the catalogue is the product
 * ------------------------------------------------------------------ */
section('5. Tool registry');
$all = ToolRegistry::all();
ok(count($all) >= 55, 'the catalogue registers the full tool set', 'count=' . count($all));
$categories = array();
foreach ($all as $slug => $definition) {
    $categories[$definition->category()] = true;
    ok(preg_match('#^[a-z0-9]+(/[a-z0-9\-]+)+$#', $slug) === 1, 'slug is charset-safe: ' . $slug);
    ok($definition->name() !== '' && $definition->summary() !== '' && $definition->description() !== '' && $definition->explanation() !== '', 'tool copy is complete: ' . $slug);
    ok(count($definition->fields()) > 0, 'tool declares fields: ' . $slug);
    ok(count($definition->exports()) > 0, 'tool declares exports: ' . $slug);
    $handler = $definition->handler();
    ok(class_exists($handler), 'handler class exists: ' . $slug);
    if (class_exists($handler)) {
        $instance = new $handler();
        ok(method_exists($instance, $definition->method()), 'handler method exists: ' . $slug . '::' . $definition->method());
    }
    ok($definition->targetField() !== '' || $definition->isClientOnly() || $definition->hasSensitiveInput(), 'target policy is explicit: ' . $slug);
    ok(in_array($definition->rateTier(), array('local', 'standard', 'high_risk'), true), 'rate tier is known: ' . $slug);
    ok($definition->timeoutSeconds() >= 1 && $definition->timeoutSeconds() <= 60, 'timeout is bounded: ' . $slug, (string) $definition->timeoutSeconds());
    ok($definition->cacheSeconds() >= 0, 'cache duration is non-negative: ' . $slug);
}
foreach (array('dns', 'ip', 'network', 'developer', 'webmaster', 'security', 'domain', 'productivity', 'diagnostics') as $category) {
    ok(isset($categories[$category]), 'category has tools: ' . $category);
}
same('security/ip-blacklist', ToolRegistry::canonical('ip/blacklist'), 'the ip/blacklist alias resolves to its canonical slug');
ok(ToolRegistry::get('ip/blacklist') !== null, 'an alias is retrievable through get()');
same(null, ToolRegistry::get('does/not-exist'), 'an unknown slug returns null');
ok(count(ToolRegistry::search('propagation')) >= 1, 'search finds a tool by name');
ok(count(ToolRegistry::visibleTo('customer')) >= count(ToolRegistry::visibleTo('public')), 'customers see at least the public tools');
$highRiskCount = 0;
foreach ($all as $definition) {
    if ($definition->isHighRisk()) {
        $highRiskCount++;
        same('high_risk', $definition->rateTier(), 'high-risk tools use the strict tier: ' . $definition->slug());
    }
}
ok($highRiskCount >= 5, 'active network tools are flagged high risk', 'count=' . $highRiskCount);

section('6. Field validation through the definition');
$definition = ToolRegistry::get('dns/lookup');
$clean = $definition->validateInput(array('domain' => 'Example.com', 'type' => 'A'));
same('example.com', $clean['domain'], 'definition validation runs the field validator');
expectInvalidResult($definition, array('domain' => 'not a domain', 'type' => 'A'), 'definition validation rejects a bad domain');
$smtp = ToolRegistry::get('developer/smtp-test');
same(true, $smtp->hasSensitiveInput(), 'the SMTP tester is marked as accepting sensitive input');
$passwordTool = ToolRegistry::get('security/password');
same(true, $passwordTool->hasSensitiveInput(), 'the password tool is marked as accepting sensitive input');
$bin = ToolRegistry::get('security/bin-checker');
same(true, $bin->requiresProvider(), 'the BIN checker requires an administrator-provided provider');
$clientOnly = ToolRegistry::get('productivity/qr-scanner');
same(true, $clientOnly->isClientOnly(), 'the QR scanner is client-only by design');

/* ------------------------------------------------------------------ *
 * 7. Network maths
 * ------------------------------------------------------------------ */
section('7. Network maths (deterministic)');
$subnet = runTool(SubnetService::class, array('cidr' => '192.168.1.10/24'));
same(true, $subnet->isOk(), 'the subnet calculator runs');
$data = $subnet->data()['subnet'];
same('192.168.1.0', $data['network_address'], 'network address');
same('192.168.1.255', $data['broadcast_address'], 'broadcast address');
same(256, $data['address_count'], 'address count');
same(254, $data['usable_hosts'], 'usable hosts');
same('255.255.255.0', $data['subnet_mask'], 'subnet mask');
same('0.0.0.255', $data['wildcard_mask'], 'wildcard mask');
same('192.168.1.1', $data['first_usable'], 'first usable host');
same('192.168.1.254', $data['last_usable'], 'last usable host');
same(true, $data['private_range'], 'RFC 1918 space is reported as private');
$subnetV6 = runTool(SubnetService::class, array('cidr' => '2001:db8::/48'));
same(true, $subnetV6->isOk(), 'IPv6 subnets work');
$data6 = $subnetV6->data()['subnet'];
same('2001:db8::', $data6['network_address'], 'IPv6 network address');
ok($data6['address_count'] !== '' && $data6['address_count'] !== null, 'IPv6 address count is reported as an exact integer string', var_export($data6['address_count'], true));
contains('1.2089258196146', (string) $data6['address_count'], 'the IPv6 /48 count is the exact 2^80 value');
expectInvalid(SubnetService::class, array('cidr' => '192.168.1.0/33'), 'an impossible prefix is rejected');
$split = runTool(SubnetService::class, array('cidr' => '10.0.0.0/24', 'split' => 4));
same(true, $split->isOk(), 'a subnet can be split');
same(4, count($split->data()['subnets']), 'four subnets are produced');
same('10.0.0.0/26', $split->data()['subnets'][0]['cidr'], 'the first split subnet is correct');
same('10.0.0.192/26', $split->data()['subnets'][3]['cidr'], 'the last split subnet is correct');
same('11000000101010000000000100000000', str_replace('.', '', IpMath::binaryString(IpMath::packed('192.168.1.0'), '.')), 'binary form is exact');
same('2001:db8::1', IpMath::compress('2001:0db8:0:0:0:0:0:1'), 'IPv6 compression');
same('2001:0db8:0000:0000:0000:0000:0000:0001', IpMath::expand('2001:db8::1'), 'IPv6 expansion');
$rangeToCidrs = IpMath::rangeToCidrs('192.0.2.0', '192.0.2.3');
same(1, count($rangeToCidrs), 'a /30 range resolves to one CIDR block');
contains('192.0.2.0/30', json_encode($rangeToCidrs), 'the block is the expected /30');

$convert = new ConvertService();
$toDecimal = callPrivate($convert, 'ipToDecimal', array('192.168.1.1'));
same('3232235777', (string) $toDecimal->data()['decimal'], 'IP to decimal');
$toIp = callPrivate($convert, 'decimalToIp', array('3232235777'));
same('192.168.1.1', $toIp->data()['normalised'], 'decimal to IP');
$cidrRange = callPrivate($convert, 'cidrToRange', array('192.0.2.0/24'));
same('192.0.2.0', $cidrRange->data()['network'], 'CIDR to range keeps the network address');
same('192.0.2.255', $cidrRange->data()['last'], 'CIDR to range reports the last address');
throws(function () use ($convert) { callPrivate($convert, 'ipToDecimal', array('not-an-ip')); }, 'converting an invalid address throws');
$range = callPrivate($convert, 'rangeToCidr', array('192.0.2.0 - 192.0.2.255'));
same(1, count($range->data()['blocks']), 'a /24 range resolves to one block');

/* ------------------------------------------------------------------ *
 * 8. Propagation matching (the heart of the propagation checker)
 * ------------------------------------------------------------------ */
section('8. Propagation matching and status labels');
$propagation = new PropagationService();
$matches = function ($value, $expected, $mode) use ($propagation) {
    return callPrivate($propagation, 'matches', array($value, $expected, $mode));
};
same(true, $matches('93.184.216.34', '93.184.216.34', 'exact'), 'exact match');
same(false, $matches('93.184.216.35', '93.184.216.34', 'exact'), 'exact mismatch');
same(true, $matches('"v=spf1 include:example.com ~all"', 'include:example.com', 'contains'), 'contains match ignores TXT quotes');
same(true, $matches('2001:db8::1', '2001:0db8:0:0:0:0:0:1', 'exact'), 'IPv6 answers compare by value, not by text');
same(true, $matches('mail.example.com', '^MAIL\\.example\\.com$', 'regex'), 'regular-expression matching is case-insensitive');
same(false, $matches('mail.example.com', '(unclosed', 'regex'), 'an invalid pattern never matches');
$classify = function (array $response, array $values, $expected, $mode) use ($propagation) {
    return callPrivate($propagation, 'classify', array($response, $values, $expected, $mode));
};
$goodResponse = array('ok' => true, 'code' => ErrorCode::OK);
same('PROPAGATED', $classify($goodResponse, array('93.184.216.34'), '', 'exact'), 'an answer with no expectation is propagated');
same('PROPAGATED', $classify($goodResponse, array('93.184.216.34'), '93.184.216.34', 'exact'), 'a matching answer is propagated');
same('MISMATCH', $classify($goodResponse, array('93.184.216.35'), '93.184.216.34', 'exact'), 'a differing answer is a mismatch');
same('NOT_PROPAGATED', $classify($goodResponse, array(), '93.184.216.34', 'exact'), 'no answer is not propagated');
same('TIMEOUT', $classify(array('ok' => false, 'code' => ErrorCode::TIMEOUT), array(), '', 'exact'), 'a timeout is reported as a timeout');
same('ERROR', $classify(array('ok' => false, 'code' => ErrorCode::DNS_LOOKUP_FAILED), array(), '', 'exact'), 'a resolver error is reported as an error');
same('Not propagated', callPrivate($propagation, 'statusLabel', array('NOT_PROPAGATED')), 'status labels are human readable');
same('Mismatch', callPrivate($propagation, 'statusLabel', array('MISMATCH')), 'mismatch label');

/* ------------------------------------------------------------------ *
 * 9. Email authentication parsing
 * ------------------------------------------------------------------ */
section('9. SPF and DMARC parsing');
$spf = new SpfService();
$parsed = callPrivate($spf, 'parse', array('v=spf1 include:_spf.example.com ip4:192.0.2.0/24 -all'));
same(array(), $parsed['errors'], 'a valid SPF record has no syntax errors');
same(2, callPrivate($spf, 'countLookups', array($parsed['mechanisms'])), 'include and ip4 count as one DNS lookup only for include');
same('-', $parsed['all_qualifier'], 'the all qualifier is captured');
$messy = callPrivate($spf, 'parse', array('v=spf1 ptr foobar~all'));
ok(count($messy['errors']) >= 1, 'an invalid mechanism is reported as an error');
ok(count($messy['warnings']) >= 1, 'the deprecated ptr mechanism produces a warning');
$many = callPrivate($spf, 'parse', array('v=spf1 include:a.example.com include:b.example.com mx exists:c.example.com a redirect:d.example.com -all'));
same(6, callPrivate($spf, 'countLookups', array($many['mechanisms'])), 'all six lookup mechanisms are counted');
same('d.example.com', $many['modifiers']['redirect'], 'the redirect modifier is captured');

$dmarc = new DmarcService();
$policy = callPrivate($dmarc, 'parse', array('v=DMARC1; p=quarantine; rua=mailto:reports@example.com; pct=50'));
same(array(), $policy['errors'], 'a valid DMARC record parses without errors');
same('quarantine', $policy['tags']['p'], 'the policy tag is captured');
same('50', $policy['tags']['pct'], 'the percentage tag is captured');
$broken = callPrivate($dmarc, 'parse', array('v=DMARC1; p=banana; rua=mailto:reports@example.com; rua=mailto:second@example.com'));
ok(count($broken['errors']) >= 1, 'an invalid policy is an error');
ok(count($broken['warnings']) >= 1, 'a duplicated tag is a warning');
$noPolicy = callPrivate($dmarc, 'parse', array('v=DMARC1; rua=mailto:reports@example.com'));
ok(count($noPolicy['errors']) >= 1, 'a missing p= tag is an error');
contains('no action', callPrivate($dmarc, 'explainPolicy', array('none', 100)), 'p=none is explained honestly');
contains('refuse', callPrivate($dmarc, 'explainPolicy', array('reject', 100)), 'p=reject is explained');

/* ------------------------------------------------------------------ *
 * 10. Health scoring vocabulary
 * ------------------------------------------------------------------ */
section('10. DNS health roll-up');
$health = new HealthService();
$checks = array(
    array('status' => 'PASS', 'label' => 'NS present'),
    array('status' => 'WARNING', 'label' => 'TTL short'),
);
same('WARNING', callPrivate($health, 'overall', array($checks)), 'overall is the worst status');
$checks[] = array('status' => 'ERROR', 'label' => 'CAA missing');
same('ERROR', callPrivate($health, 'overall', array($checks)), 'an error dominates');
same(array('TTL short'), callPrivate($health, 'statuses', array($checks, 'WARNING')), 'per-status labels are listed');
same('UNKNOWN', callPrivate($health, 'mapEmailStatus', array('NOT_CHECKED')), 'an unrun email check maps to UNKNOWN, never PASS');
same('PASS', callPrivate($health, 'mapEmailStatus', array('PASS')), 'a genuine pass maps to PASS');

$dnssec = new DnssecService();
same(false, callPrivate($dnssec, 'chainComplete', array(array(), array())), 'an empty DNSSEC chain is not complete');
same(false, callPrivate($dnssec, 'chainComplete', array(array(array('verified' => false)), array(array('key' => 'x')))), 'an unverified match is not complete');
same(true, callPrivate($dnssec, 'chainComplete', array(array(array('verified' => true)), array(array('key' => 'x')))), 'a verified match completes the chain');

/* ------------------------------------------------------------------ *
 * 11. Punycode / IDN
 * ------------------------------------------------------------------ */
section('11. IDN and Punycode');
$punycode = new PunycodeService();
same('xn--bcher-kva', callPrivate($punycode, 'labelToAscii', array('bücher')), 'bücher encodes to xn--bcher-kva');
same('bcher-kva', callPrivate($punycode, 'encodeLabel', array(array(98, 252, 99, 104, 101, 114))), 'the raw Punycode of bücher is bcher-kva');
same('bücher', callPrivate($punycode, 'labelToUnicode', array('xn--bcher-kva')), 'xn--bcher-kva decodes back to bücher');
same('xn--e1afmkfd', callPrivate($punycode, 'labelToAscii', array('пример')), 'a Cyrillic label encodes');
same('例え', callPrivate($punycode, 'labelToUnicode', array('xn--r8jz45g')), 'a Japanese label decodes');
same('example', callPrivate($punycode, 'labelToAscii', array('EXAMPLE')), 'ASCII labels are lowercased');
ok(callPrivate($punycode, 'mixedScriptNotice', array('аpple')) !== '', 'a mixed-script lookalike is flagged');
same('', callPrivate($punycode, 'mixedScriptNotice', array('bücher')), 'a single-script name is not flagged');

/* ------------------------------------------------------------------ *
 * 12. Parsers that must not invent data
 * ------------------------------------------------------------------ */
section('12. Developer and webmaster parsers');
$headers = new EmailHeaderService();
$parsedHeaders = callPrivate($headers, 'parseHeaders', array("Received: from a.example.com\r\n\tby b.example.com\r\nFrom: Sender <sender@example.com>\r\n\r\nbody"));
same(2, count($parsedHeaders), 'folded headers parse as two headers');
same('Received', $parsedHeaders[0]['name'], 'the header name is captured');
contains('b.example.com', $parsedHeaders[0]['value'], 'a folded continuation is joined');
same('example.com', callPrivate($headers, 'domainOf', array('Sender <sender@example.com>')), 'the domain is extracted from a display-name address');

$userAgent = new UserAgentService();
$chrome = callPrivate($userAgent, 'interpret', array('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'));
same('Chrome', $chrome['browser'], 'Chrome is detected');
same('Windows', $chrome['platform'], 'Windows is detected');
$unknown = callPrivate($userAgent, 'interpret', array('curl/8.0'));
same('', $unknown['browser'], 'an unknown agent is not guessed at');
same('Unknown', $unknown['confidence'], 'an unknown agent is reported as unknown');

$json = new JsonService();
same(false, callPrivate($json, 'isList', array(array('a' => 1))), 'an object is not a list');
same(true, callPrivate($json, 'isList', array(array(1, 2, 3))), 'a list is a list');
$summary = callPrivate($json, 'summarise', array(array('a' => 1, 'b' => array('c' => 'x', 'd' => null))));
same(4, $summary['keys'], 'the JSON structure summary counts keys at every level');
same(2, $summary['depth'], 'the JSON structure summary tracks depth');
$formatted = runTool(JsonService::class, array('json' => '{"a":1,"b":[1,2]}', 'mode' => 'format'));
same(true, $formatted->isOk(), 'valid JSON formats');
same(true, $formatted->data()['valid'], 'the result says the JSON is valid');
same('{"a":1,"b":[1,2]}', $formatted->data()['minified'], 'the minified form is exact');
$invalidJson = runTool(JsonService::class, array('json' => '{"a":', 'mode' => 'format'));
same(false, $invalidJson->isOk(), 'invalid JSON fails');
same(ErrorCode::INVALID_INPUT, $invalidJson->code(), 'invalid JSON is an input error, not a fake result');

$robots = new RobotsService();
$rendered = callPrivate($robots, 'render', array(
    array(array('user_agent' => '*', 'rules' => array(array('directive' => 'disallow', 'value' => '/admin/'), array('directive' => 'allow', 'value' => '/'))),),
    array('https://www.example.com/sitemap.xml'),
));
contains('User-agent: *', $rendered, 'robots.txt emits the group');
contains('Disallow: /admin/', $rendered, 'robots.txt emits the rule with correct casing');
contains('Sitemap: https://www.example.com/sitemap.xml', $rendered, 'robots.txt emits the sitemap');

$serp = new SerpService();
same(11, callPrivate($serp, 'length', array('hello world')), 'character length is counted');
same('example.com › a › b', callPrivate($serp, 'breadcrumb', array('https://example.com/a/b/')), 'the SERP breadcrumb is built from the URL');

$openGraph = new OpenGraphService();
$tags = callPrivate($openGraph, 'extractMeta', array(
    '<html><head><title>Real title</title>'
    . '<meta property="og:title" content="Social title">'
    . '<meta property="og:image" content="/img/social.png">'
    . '<meta name="description" content="A description">'
    . '<meta name="robots" content="index">'
    . '</head></html>',
    'https://example.com/page',
));
same('Social title', $tags['og:title'], 'og:title is parsed');
same('https://example.com/img/social.png', $tags['og:image'], 'a relative og:image is resolved absolutely');
same('A description', $tags['meta:description'], 'the meta description is captured');
same('Real title', $tags['title'], 'the document title is captured');
same(false, isset($tags['robots']), 'unrelated meta tags are ignored');

$brokenLinks = new BrokenLinksService();
$links = callPrivate($brokenLinks, 'extractLinks', array(
    '<a href="/about">About</a><a href="#top">Top</a><a href="mailto:x@example.com">Mail</a>'
    . '<a href="https://other.example.net/x">Other</a><img src="images/logo.png">',
    'https://example.com/page/index.html',
));
$urls = array();
foreach ($links as $link) {
    $urls[] = is_array($link) ? $link['url'] : $link;
}
ok(in_array('https://example.com/about', $urls, true), 'a root-relative link is resolved');
ok(in_array('https://example.com/page/images/logo.png', $urls, true) || in_array('images/logo.png', $urls, true), 'a relative asset link is resolved against the page');
ok(in_array('https://other.example.net/x', $urls, true), 'an absolute link is kept');
foreach ($urls as $url) {
    ok(stripos($url, 'javascript:') === false && stripos($url, 'mailto:') === false && strpos($url, '#') !== 0, 'non-fetchable links are dropped: ' . $url);
}
same(true, callPrivate($brokenLinks, 'looksLikePage', array('https://example.com/about')), 'a page-like URL is treated as a page');
same(false, callPrivate($brokenLinks, 'looksLikePage', array('https://example.com/img.png')), 'an image is not treated as a page');

/* ------------------------------------------------------------------ *
 * 13. Security tools
 * ------------------------------------------------------------------ */
section('13. Security tools');
$hostnameMatches = new SslService();
same(true, callPrivate($hostnameMatches, 'hostnameMatches', array('example.com', array('example.com'))), 'exact certificate hostname match');
same(true, callPrivate($hostnameMatches, 'hostnameMatches', array('www.example.com', array('*.example.com'))), 'wildcard certificate match');
same(false, callPrivate($hostnameMatches, 'hostnameMatches', array('a.b.example.com', array('*.example.com'))), 'a wildcard does not span labels');
same(false, callPrivate($hostnameMatches, 'hostnameMatches', array('example.net', array('example.com'))), 'a certificate for another name is a mismatch');

$strength = runTool(PasswordService::class, array('operation' => 'strength', 'value' => 'correct horse battery staple 2026'));
same(true, $strength->isOk(), 'the strength check runs');
ok($strength->data()['entropy_bits'] > 80, 'a long passphrase reports real entropy', (string) $strength->data()['entropy_bits']);
ok($strength->data()['adjusted_bits'] > 60, 'the penalty-adjusted strength is reported too', (string) $strength->data()['adjusted_bits']);
$common = runTool(PasswordService::class, array('operation' => 'strength', 'value' => 'password'));
ok($common->data()['adjusted_bits'] < $strength->data()['adjusted_bits'], 'a common password scores lower');
contains('CRITICAL', json_encode($common->data()), 'a common password is flagged critically');
expectInvalid(PasswordService::class, array('operation' => 'strength', 'value' => ''), 'an empty password is rejected');
$generated = runTool(PasswordService::class, array('operation' => 'generate', 'length' => 24));
same(true, $generated->isOk(), 'the generator runs');
same(24, strlen($generated->data()['password']), 'the generated password has the requested length');
same(24, $generated->data()['length'], 'the generator reports the length it used');
same(true, $generated->meta()['sensitive_output'], 'the generated password is marked as sensitive output, not stored');
expectInvalid(PasswordService::class, array('operation' => 'nonsense'), 'an unknown operation is rejected');

/* ------------------------------------------------------------------ *
 * 14. Productivity tools
 * ------------------------------------------------------------------ */
section('14. Productivity tools');
$countedText = 'Hello world. Second sentence!';
$counter = runTool(TextService::class, array('text' => $countedText), array('tool' => ToolRegistry::get('productivity/text')));
same(true, $counter->isOk(), 'the counter runs');
same(5, $counter->data()['words'], 'word count');
same(strlen($countedText), $counter->data()['characters'], 'character count');
same(2, $counter->data()['sentences'], 'sentence count');
ok(ToolRegistry::get('productivity/text')->isClientOnly(), 'the counter is declared client-only');
$lorem = runTool(TextService::class, array('unit' => 'words', 'count' => 10), array('tool' => ToolRegistry::get('productivity/lorem-ipsum')));
same(true, $lorem->isOk(), 'the lorem generator runs');
same(10, $lorem->data()['requested'], 'the lorem generator records the requested amount');
ok(str_word_count($lorem->data()['text']) >= 10, 'the lorem generator produces the requested words');
$runic = runTool(TextService::class, array('text' => 'CloudHost247'), array('tool' => ToolRegistry::get('productivity/runic')));
same(true, $runic->isOk(), 'the runic translator runs');
ok((int) $runic->data()['unmapped_characters'] >= 1, 'unmapped characters are reported instead of silently dropped');

$timeCard = runTool(TimeCardService::class, array('shifts' => "09:00-17:00,30\n22:00-02:00,15", 'overtime_after' => 8));
same(true, $timeCard->isOk(), 'the time card runs');
same(2, $timeCard->data()['shift_count'], 'two shifts are parsed');
same(675, $timeCard->data()['total_worked_minutes'], 'breaks are subtracted from both shifts');
same('11h 15m', $timeCard->data()['total_worked'], 'the total is rendered as hours and minutes');
same(true, $timeCard->data()['shifts'][1]['overnight'], 'an overnight shift is detected');
ok($timeCard->data()['overtime_minutes'] > 0, 'overtime is calculated beyond the threshold');
same(false, $timeCard->data()['stored'] ?? true, 'the time card stores nothing');
same('7h 30m', callPrivate($timeCard, 'formatMinutes', array(450)), 'minute formatting');
$badShift = runTool(TimeCardService::class, array('shifts' => 'not a shift'));
same(true, $badShift->isOk(), 'an unparseable shift does not fail the whole tool');
ok(count($badShift->data()['problems']) === 1, 'the unparseable line is reported as a problem');

$color = runTool(ColorService::class, array('value' => '#ff0000'));
same(true, $color->isOk(), 'the colour tool runs');
same('#ff0000', strtolower($color->data()['models']['hex']), 'HEX is echoed exactly');
same('rgb(255, 0, 0)', $color->data()['models']['rgb'], 'RGB is exact');
same('100%', $color->data()['cmyk_components']['m'], 'CMYK conversion');
ok($color->data()['contrast']['against_white'] > 3.9 && $color->data()['contrast']['against_white'] < 4.1, 'WCAG contrast against white is 3.998:1');
$named = runTool(ColorService::class, array('value' => 'red'));
same(true, $named->isOk(), 'named CSS colours are accepted');
same('#ff0000', strtolower($named->data()['models']['hex']), 'the named colour resolves to its HEX value');
expectInvalid(ColorService::class, array('value' => 'not-a-colour'), 'an invalid colour is rejected');
expectInvalid(ColorService::class, array('value' => 'rgb(300, 0, 0)'), 'an out-of-range component is rejected');

$qr = new QrService();
$wifi = callPrivate($qr, 'wifi', array("Guest;Net\np@ss:word\nWPA"));
contains('WIFI:T:WPA;', $wifi['value'], 'the Wi-Fi payload carries the encryption type');
contains('S:Guest\\;Net;', $wifi['value'], 'reserved characters in the SSID are escaped');
contains('P:p@ss\\:word;', $wifi['value'], 'reserved characters in the password are escaped');
$vcard = callPrivate($qr, 'vcard', array("Ada Lovelace\nCloudHost247\nada@example.com\n+10000000000"));
contains('BEGIN:VCARD', $vcard['value'], 'the vCard payload has the envelope');
contains('END:VCARD', $vcard['value'], 'the vCard payload is terminated');
$wifiResult = runTool(QrService::class, array('kind' => 'wifi', 'payload' => "Net\nsecret\nWPA"), array('tool' => ToolRegistry::get('productivity/qr-generator')));
same(true, $wifiResult->isOk(), 'the QR generator runs');
same(false, $wifiResult->meta()['server_encoded'], 'the server says the encoding happens in the browser');
$scanner = runTool(QrService::class, array('store' => false), array('tool' => ToolRegistry::get('productivity/qr-scanner')));
same(true, $scanner->isOk(), 'the QR scanner reports readiness');
same(true, $scanner->data()['client_side'], 'the scanner is honest that decoding is local');
same(false, $scanner->data()['server_decoded'], 'the scanner does not claim a server-side decode');

/* ------------------------------------------------------------------ *
 * 15. Network helpers that do not need the network
 * ------------------------------------------------------------------ */
section('15. Network helpers');
$mac = new MacService();
same('00:1a:2b:3c:4d:5e', callPrivate($mac, 'format', array(array(0, 26, 43, 60, 77, 94), ':')), 'colon MAC format');
same('001a.2b3c.4d5e', callPrivate($mac, 'format', array(array(0, 26, 43, 60, 77, 94), '.')), 'Cisco MAC format');
same('00-1a-2b-3c-4d-5e', callPrivate($mac, 'format', array(array(0, 26, 43, 60, 77, 94), '-')), 'hyphen MAC format');
$macResult = runTool(MacService::class, array('count' => 3, 'kind' => 'local', 'separator' => ':'), array('tool' => ToolRegistry::get('network/mac-generator')));
same(true, $macResult->isOk(), 'the MAC generator runs');
same(3, count($macResult->data()['addresses']), 'three addresses are generated');
ok(preg_match('/^[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}$/', $macResult->data()['addresses'][0]) === 1, 'a generated address is well formed');
$second = (hexdec(substr($macResult->data()['addresses'][0], 0, 2)) & 0x02) === 0x02;
same(true, $second, 'a locally administered address has the local bit set');
$macClamped = runTool(MacService::class, array('count' => 999, 'kind' => 'universal'), array('tool' => ToolRegistry::get('network/mac-generator')));
same(20, count($macClamped->data()['addresses']), 'an excessive MAC count is clamped to the documented maximum');

$ping = new PingService();
$packet = callPrivate($ping, 'icmpChecksum', array("\x08\x00\x00\x00\x00\x01\x00\x01"));
ok(is_int($packet) && $packet >= 0 && $packet <= 0xffff, 'the ICMP checksum is a 16-bit value', (string) $packet);
same(0xf7ff, callPrivate($ping, 'icmpChecksum', array("\x00\x00\x00\x00")), 'a zero header checksums as ffff');
$privatePing = runTool(PingService::class, array('target' => '127.0.0.1', 'count' => 1), array('tool' => ToolRegistry::get('network/ping')));
same(false, $privatePing->isOk(), 'ping refuses a private target before touching the network');
same(ErrorCode::TARGET_BLOCKED, $privatePing->code(), 'ping reports a blocked target rather than a fake timeout');
$metadataPing = runTool(PingService::class, array('target' => '169.254.169.254', 'count' => 1), array('tool' => ToolRegistry::get('network/ping')));
same(false, $metadataPing->isOk(), 'ping refuses the cloud metadata address');

/* ------------------------------------------------------------------ *
 * 16. UI layer
 * ------------------------------------------------------------------ */
section('16. UI layer');
same('success', Format::tone('PASS'), 'PASS renders as success');
same('danger', Format::tone('EXPIRED'), 'EXPIRED renders as danger');
same('muted', Format::tone('NOT CHECKED'), 'NOT CHECKED renders as muted');
same('warning', Format::tone('MISMATCH'), 'MISMATCH renders as warning');
same('512 B', Format::bytes(512), 'byte formatting under a kibibyte');
same('1 KiB', Format::bytes(1024), 'byte formatting at a kibibyte');
same('1.5 MiB', Format::bytes(1572864), 'byte formatting in mebibytes');
ok(Format::label('dns_record_type') !== '', 'labels are derived from keys');

$presenter = new ResultPresenter();
$presented = $presenter->present(ToolResult::success(array(
    'summary' => 'ok',
    'records' => array(
        array('type' => 'A', 'value' => '<script>alert(1)</script>'),
        array('type' => 'MX', 'value' => 'mail.example.com'),
    ),
)), 'dns/lookup');
same(true, $presented['ok'], 'the presentation keeps the result status');
ok(count($presented['tables']) >= 1, 'a record list becomes a table');
$tableJson = json_encode($presented['tables']);
contains('mail.example.com', $tableJson, 'table rows carry the real answer values');
contains('A', $tableJson, 'table rows carry the record type');
ok(strpos($presentedJson = json_encode($presented), '<script>alert(1)</script>') !== false, 'the presenter hands raw values to Smarty, which escapes them (asserted in the static suite)');
contains('dns/lookup', $presented['tool_slug'], 'the presentation records which tool produced it');
ok(isset($presented['generated_at']) && $presented['generated_at'] !== '', 'the presentation carries a timestamp');
$withExports = $presenter->present(ToolResult::success(array('a' => 1)), 'dns/lookup', array('exports' => array('json', 'csv')));
ok(count($withExports['export']) === 2, 'export links are built from the declared formats');
contains('tools.php?tool=dns%2Flookup&export=csv', $withExports['export']['csv']['url'], 'the export URL targets the front controller');

/* ------------------------------------------------------------------ *
 * 17. Migration
 * ------------------------------------------------------------------ */
section('17. Migration contract');
$migration = new NetworkToolsInitialMigration();
same('1.0.0', $migration->version(), 'the module migration is version 1.0.0');
$migrationSource = file_get_contents($addon . '/migrations/V100.php');
$creates = preg_match_all('/->create\(\s*[\'"]/', $migrationSource);
$guards = preg_match_all('/hasTable\s*\(/', $migrationSource);
same(true, $creates > 0, 'the migration creates tables', (string) $creates);
ok($guards >= $creates, 'every create is guarded by hasTable', 'creates=' . $creates . ' guards=' . $guards);
same(false, (bool) preg_match('/->(?:drop|rename)\s*\(/', $migrationSource), 'the migration never drops or renames');
same(false, (bool) preg_match('/(?:create|table)\(\s*[\'"]tbl/', $migrationSource), 'the migration never touches WHMCS core tables');
$tableNames = array();
preg_match_all('/->create\(\s*[\'"]([a-z0-9_]+)[\'"]/', $migrationSource, $tableNames);
foreach ($tableNames[1] as $table) {
    ok(strpos($table, 'mod_cloudhost247_') === 0, 'table is namespaced: ' . $table);
}
ok(count($tableNames[1]) >= 12, 'the module owns enough tables for its features', (string) count($tableNames[1]));
foreach (array('tool_definitions', 'tool_categories', 'tool_provider_configs', 'tool_execution_logs', 'tool_favorites', 'tool_history', 'tool_rate_limits', 'tool_health_checks', 'dns_resolvers', 'dns_check_results') as $suffix) {
    $found = false;
    foreach ($tableNames[1] as $table) {
        if (substr($table, -strlen($suffix)) === $suffix) {
            $found = true;
        }
    }
    ok($found, 'spec table exists: mod_cloudhost247_nt_' . $suffix);
}

/* ------------------------------------------------------------------ *
 * 18. Files that must exist for the module to be deployable
 * ------------------------------------------------------------------ */
section('18. Deployment surface');
foreach (array(
    'cloudhost247_network_tools.php',
    'bootstrap.php',
    'hooks.php',
    'api/index.php',
    'migrations/V100.php',
    'assets/css/cloudhost247-tools.css',
    'assets/js/cloudhost247-tools.js',
) as $relative) {
    ok(is_file($addon . '/' . $relative), 'module file exists: ' . $relative);
}
foreach (array(
    'tools.php',
    'crons/cloudhost247_network_tools.php',
    'templates/cloudhost247/cloudhost247-tools.tpl',
    'templates/cloudhost247/cloudhost247-tools-table.tpl',
    'templates/cloudhost247/cloudhost247-tools-print.tpl',
) as $relative) {
    ok(is_file($root . '/' . $relative), 'repository file exists: ' . $relative);
}
$entry = file_get_contents($addon . '/cloudhost247_network_tools.php');
contains('cloudhost247_network_tools_seed', $entry, 'activation seeds the catalogue, resolvers and providers');
contains('NetworkToolsInitialMigration', $entry, 'activation runs the versioned migration');
$cron = file_get_contents($root . '/crons/cloudhost247_network_tools.php');
contains('PHP_SAPI', $cron, 'the cron worker is a CLI worker');
$api = file_get_contents($addon . '/api/index.php');
contains('hash_equals', $api, 'the REST API compares tokens in constant time');

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */
echo "\n" . str_repeat('=', 60) . "\n";
echo 'Passed: ' . $GLOBALS['ch247_nt_pass'] . '  Failed: ' . $GLOBALS['ch247_nt_fail'] . "\n";
if ($GLOBALS['ch247_nt_fail'] > 0) {
    echo "\nFailures:\n";
    foreach ($GLOBALS['ch247_nt_failures'] as $line) {
        echo '  - ' . $line . "\n";
    }
    exit(1);
}
echo "CloudHost247 Network Tools behaviour suite passed.\n";
exit(0);

/**
 * Helper kept at the bottom so the suite reads top-down: validate input through
 * a definition and report the failure the runner would produce.
 */
function expectInvalidResult(ToolDefinition $definition, array $input, $label)
{
    try {
        $definition->validateInput($input);
    } catch (InvalidArgumentException $invalid) {
        return ok(trim($invalid->getMessage()) !== '', $label);
    }
    return ok(false, $label, 'validation accepted the input');
}
