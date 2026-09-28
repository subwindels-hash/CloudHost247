<?php
/**
 * CloudHost247 SMM behavior test suite.
 *
 * Runs the real module logic (adapters, state machine, status mapping,
 * reconciliation, catalog diff, client-area gating, redaction) against
 * in-memory fakes and scripted provider responses. No WHMCS, no database,
 * no network: FakeTransport answers from tests/smm/fixtures.
 *
 * Usage: php tests/smm/run.php   (exits non-zero on any failure)
 */

// Real module classes load FIRST: the fakes implement these interfaces
// (HttpTransport, ProviderFinder, OrderStore, ApiRecorder), and PHP resolves
// "implements" when the declaration executes — interfaces must exist by then.
$root = dirname(__DIR__, 2);
$lib = $root . '/modules/addons/cloudhost247_smm/lib/';
require_once $lib . 'Support/ModuleException.php';
require_once $lib . 'Support/AdapterException.php';
require_once $lib . 'Support/TransportException.php';
require_once $lib . 'Support/UrlPolicy.php';
require_once $lib . 'Support/Crypto.php';
require_once $lib . 'Support/Redactor.php';
require_once $lib . 'Support/StatusMap.php';
require_once $lib . 'Support/Validator.php';
require_once $lib . 'Support/HttpTransport.php';
require_once $lib . 'Support/CurlTransport.php';
require_once $lib . 'Adapters/ProviderAdapter.php';
require_once $lib . 'Adapters/GenericSmmAdapter.php';
require_once $lib . 'Adapters/AdapterFactory.php';
require_once $lib . 'Contracts/ProviderFinder.php';
require_once $lib . 'Contracts/OrderStore.php';
require_once $lib . 'Contracts/ApiRecorder.php';
require_once $lib . 'Services/OrderService.php';
require_once $lib . 'Services/StatusSyncService.php';
require_once $lib . 'Services/ReconciliationService.php';
require_once $lib . 'Services/CatalogSync.php';
require_once $lib . 'Services/Automation.php';
require_once $lib . 'Services/ClientAreaService.php';

require_once __DIR__ . '/fakes.php';

use CloudHost247\Smm\Adapters\AdapterFactory;
use CloudHost247\Smm\Adapters\GenericSmmAdapter;
use CloudHost247\Smm\Services\Automation;
use CloudHost247\Smm\Services\CatalogSync;
use CloudHost247\Smm\Services\ClientAreaService;
use CloudHost247\Smm\Services\OrderService;
use CloudHost247\Smm\Services\ReconciliationService;
use CloudHost247\Smm\Services\StatusSyncService;
use CloudHost247\Smm\Support\AdapterException;
use CloudHost247\Smm\Support\Crypto;
use CloudHost247\Smm\Support\Redactor;
use CloudHost247\Smm\Support\StatusMap;
use CloudHost247\Smm\Support\TransportException;
use CloudHost247\Smm\Support\UrlPolicy;
use CloudHost247\Smm\Support\Validator;
use CloudHost247\Smm\Test\FakeApiRecorder;
use CloudHost247\Smm\Test\FakeOrderStore;
use CloudHost247\Smm\Test\FakeProviderFinder;
use CloudHost247\Smm\Test\FakeTransport;
use CloudHost247\Smm\Test\TestUrlPolicy;

$tests = array();
$fixtures = __DIR__ . '/fixtures/';
function check(&$tests, $name, $ok)
{
    $tests[$name] = (bool) $ok;
}

// ---------------------------------------------------------------- UrlPolicy
check($tests, 'url policy accepts https host (fake DNS)', TestUrlPolicy::assertProviderEndpoint('https://panel.example.com/api/v2') === 'https://panel.example.com/api/v2');
foreach (array(
    'provider http rejected' => 'http://panel.example.com/api',
    'provider javascript scheme rejected' => 'javascript://panel.example.com/x',
    'provider credentials rejected' => 'https://user:pass@panel.example.com/api',
    'provider missing host rejected' => 'https:///api',
) as $name => $url) {
    try {
        TestUrlPolicy::assertProviderEndpoint($url);
        check($tests, $name, false);
    } catch (RuntimeException $e) {
        check($tests, $name, true);
    }
}
try {
    TestUrlPolicy::assertProviderEndpoint('https://192.0.2.10/api'); // public IP literal, no DNS needed
    check($tests, 'provider public IP literal accepted', true);
} catch (RuntimeException $e) {
    check($tests, 'provider public IP literal accepted', false);
}
foreach (array(
    'provider private IPv4 rejected' => 'https://10.0.0.5/api',
    'provider loopback rejected' => 'https://127.0.0.1/api',
    'provider CGNAT range rejected' => 'https://100.64.0.1/api',
    'provider link-local rejected' => 'https://169.254.169.254/api',
    'provider IPv6 loopback rejected' => 'https://[::1]/api',
    'provider IPv6 unique-local rejected' => 'https://[fd00::1]/api',
) as $name => $url) {
    try {
        TestUrlPolicy::assertProviderEndpoint($url);
        check($tests, $name, false);
    } catch (RuntimeException $e) {
        check($tests, $name, true);
    }
}
TestUrlPolicy::$ips = array('10.20.30.40'); // DNS answer flips private
try {
    TestUrlPolicy::assertProviderEndpoint('https://evil-rebind.example.com/api');
    check($tests, 'SSRF via hostname resolving private rejected', false);
} catch (RuntimeException $e) {
    check($tests, 'SSRF via hostname resolving private rejected', true);
}
TestUrlPolicy::$ips = array('203.0.113.10');
try {
    Validator::targetLink('javascript:alert(1)');
    check($tests, 'target link scheme trick rejected', false);
} catch (RuntimeException $e) {
    check($tests, 'target link scheme trick rejected', true);
}
try {
    $link = Validator::targetLink('https://www.instagram.com/somepage/');
    check($tests, 'target link https accepted', $link === 'https://www.instagram.com/somepage/');
} catch (RuntimeException $e) {
    check($tests, 'target link https accepted', false);
}

// --------------------------------------------------------------- Validator
check($tests, 'quantity below provider minimum rejected', (function () {
    try { Validator::quantity(50, 100, 10000); return false; } catch (RuntimeException $e) { return true; }
})());
check($tests, 'quantity above provider maximum rejected', (function () {
    try { Validator::quantity(20000, 100, 10000); return false; } catch (RuntimeException $e) { return true; }
})());
check($tests, 'quantity non-numeric rejected', (function () {
    try { Validator::quantity('abc', null, null); return false; } catch (RuntimeException $e) { return true; }
})());
check($tests, 'quantity zero rejected', (function () {
    try { Validator::quantity(0, null, null); return false; } catch (RuntimeException $e) { return true; }
})());
check($tests, 'quantity valid accepted', Validator::quantity('500', 100, 10000) === 500);
check($tests, 'quantity unknown bounds allowed', Validator::quantity('5000', null, null) === 5000);

// ---------------------------------------------------------------- StatusMap
check($tests, 'status normalize pending', StatusMap::normalize('Pending') === StatusMap::PENDING);
check($tests, 'status normalize in progress (spaced)', StatusMap::normalize('In progress') === StatusMap::IN_PROGRESS);
check($tests, 'status normalize inprogress (squashed)', StatusMap::normalize('InProgress') === StatusMap::IN_PROGRESS);
check($tests, 'status normalize processing', StatusMap::normalize('Processing') === StatusMap::PROCESSING);
check($tests, 'status normalize completed', StatusMap::normalize('Completed') === StatusMap::COMPLETED);
check($tests, 'status normalize partial', StatusMap::normalize('Partial') === StatusMap::PARTIAL);
check($tests, 'status normalize cancelled (UK spelling)', StatusMap::normalize('Cancelled') === StatusMap::CANCELED);
check($tests, 'status normalize refunded', StatusMap::normalize('Refunded') === StatusMap::REFUNDED);
check($tests, 'status normalize garbage -> unknown', StatusMap::normalize('Something New') === StatusMap::UNKNOWN);
check($tests, 'status terminal detection', StatusMap::isTerminal(StatusMap::COMPLETED) && StatusMap::isTerminal(StatusMap::CANCELED) && StatusMap::isTerminal(StatusMap::FAILED) && StatusMap::isTerminal(StatusMap::REFUNDED));
check($tests, 'status non-terminal detection', !StatusMap::isTerminal(StatusMap::PENDING) && !StatusMap::isTerminal(StatusMap::IN_PROGRESS) && !StatusMap::isTerminal(StatusMap::PARTIAL));
$tr = StatusMap::resolveTransition('completed', 'pending');
check($tests, 'terminal status not overwritten (conflict flagged)', $tr['apply'] === 'completed' && $tr['conflict'] === true);
$tr = StatusMap::resolveTransition('completed', 'completed');
check($tests, 'same terminal status kept without conflict', $tr['apply'] === 'completed' && $tr['conflict'] === false);
$tr = StatusMap::resolveTransition('pending', 'in_progress');
check($tests, 'non-terminal progression applied', $tr['apply'] === 'in_progress' && $tr['conflict'] === false);
$tr = StatusMap::resolveTransition('', 'unknown');
check($tests, 'unknown observation on empty status stays unknown', $tr['apply'] === 'unknown' && $tr['conflict'] === false);

// ------------------------------------------------------------------- Crypto
$sealed = Crypto::encrypt('sk-live-abcdef123456');
check($tests, 'crypto roundtrip via WHMCS-style primitives', Crypto::decrypt($sealed) === 'sk-live-abcdef123456');
check($tests, 'crypto envelope is prefixed and not plaintext', strpos($sealed, 'whmcs:') === 0 && strpos($sealed, 'sk-live-abcdef123456') === false);
$hint = Crypto::displayHint('sk-live-abcdef123456');
check($tests, 'crypto display hint is masked', strpos($hint, 'abcdef123456') === false && substr($hint, -4) === '3456');
check($tests, 'crypto refuses unreadable envelope', (function () {
    try { Crypto::decrypt('garbage'); return false; } catch (\CloudHost247\Smm\Support\ModuleException $e) { return true; }
})());

// ----------------------------------------------------------------- Redactor
$redacted = Redactor::redactRequest(array('key' => 'SECRET', 'action' => 'add', 'service' => '12', 'link' => 'https://x.example/1'));
check($tests, 'redaction hides api key in request', strpos(json_encode($redacted), 'SECRET') === false && $redacted['key'] === '[REDACTED]');
$redactedResponse = Redactor::redactResponse(array('key' => 'SECRET', 'order' => 42));
check($tests, 'redaction scrubs key echoed by provider', strpos($redactedResponse, 'SECRET') === false && strpos($redactedResponse, '[REDACTED]') !== false);
check($tests, 'redaction truncates huge responses', strlen(Redactor::redactResponse(str_repeat('x', 9000))) <= Redactor::MAX_EXCERPT + 32);

// --------------------------------------------------------- GenericSmmAdapter
$transport = new FakeTransport(array(array('status' => 200, 'body' => file_get_contents($fixtures . 'services.json'))));
$adapter = new GenericSmmAdapter('https://192.0.2.10/api/v2', 'test-key', $transport, 10);
$services = $adapter->fetchServices();
check($tests, 'adapter parses catalog', count($services) === 4);
$first = $services[0];
check($tests, 'adapter normalizes service fields', $first['provider_service_id'] === '12' && $first['min_quantity'] === 100 && $first['max_quantity'] === 10000 && (float) $first['rate'] === 0.9 && $first['refill'] === true && $first['cancel'] === true && $first['category'] === 'Instagram Followers');
check($tests, 'adapter skips malformed catalog rows', (function () use ($services) {
    foreach ($services as $s) { if ($s['provider_service_id'] === '999') { return false; } }
    return true;
})());
check($tests, 'adapter probes refill capability from catalog', $adapter->observedCapabilities() === array('refill' => true, 'cancel' => true));

$transport = FakeTransport::fromFixture($fixtures . 'add.json');
$adapter = new GenericSmmAdapter('https://192.0.2.10/api/v2', 'test-key', $transport, 10);
$result = $adapter->submitOrder('12', 'https://www.instagram.com/x/', 500);
check($tests, 'adapter submit returns provider order id', $result['provider_order_id'] === '235412');
check($tests, 'adapter submit sends key+action+form', $transport->requests[0]['data']['action'] === 'add' && $transport->requests[0]['data']['key'] === 'test-key' && $transport->requests[0]['data']['quantity'] === '500');

$transport = FakeTransport::fromFixture($fixtures . 'add_error.json');
$adapter = new GenericSmmAdapter('https://192.0.2.10/api/v2', 'test-key', $transport, 10);
try {
    $adapter->submitOrder('12', 'https://www.instagram.com/x/', 500);
    check($tests, 'adapter surfaces provider rejection', false);
} catch (AdapterException $e) {
    check($tests, 'adapter surfaces provider rejection', strpos($e->getMessage(), 'Incorrect service ID') !== false);
}

$transport = FakeTransport::fromFixture($fixtures . 'status_processing.json');
$adapter = new GenericSmmAdapter('https://192.0.2.10/api/v2', 'test-key', $transport, 10);
$status = $adapter->orderStatus('235412');
check($tests, 'adapter status parsing', $status['status'] === 'Processing' && $status['remains'] === 500 && $status['start_count'] === 3572 && $status['charge'] === '0.27' && $status['currency'] === 'USD');

$transport = FakeTransport::fromFixture($fixtures . 'balance_error.json');
$adapter = new GenericSmmAdapter('https://192.0.2.10/api/v2', 'test-key', $transport, 10);
$result = $adapter->testConnection();
check($tests, 'adapter connection test reports bad key', $result['ok'] === false && strpos($result['detail'], 'Incorrect API key') !== false);

$transport = FakeTransport::fromFixture($fixtures . 'balance.json');
$adapter = new GenericSmmAdapter('https://192.0.2.10/api/v2', 'test-key', $transport, 10);
$result = $adapter->testConnection();
check($tests, 'adapter connection test ok with balance', $result['ok'] === true && $result['balance'] === '8.53' && $result['currency'] === 'USD');

$transport = FakeTransport::fromFixture($fixtures . 'refill.json');
$adapter = new GenericSmmAdapter('https://192.0.2.10/api/v2', 'test-key', $transport, 10, true, true);
$result = $adapter->requestRefill('235412');
check($tests, 'adapter refill returns refill id', $result['refill_id'] === '9981');

$adapter = new GenericSmmAdapter('https://192.0.2.10/api/v2', 'test-key', new FakeTransport(), 10, false, false);
try {
    $adapter->requestRefill('235412');
    check($tests, 'adapter refill refused when unsupported', false);
} catch (AdapterException $e) {
    check($tests, 'adapter refill refused when unsupported', true);
}

$transport = new FakeTransport(array(array('status' => 200, 'body' => file_get_contents($fixtures . 'notjson.txt'))));
$adapter = new GenericSmmAdapter('https://192.0.2.10/api/v2', 'test-key', $transport, 10);
try {
    $adapter->orderStatus('235412');
    check($tests, 'adapter non-JSON response -> transport failure (unknown outcome)', false);
} catch (TransportException $e) {
    check($tests, 'adapter non-JSON response -> transport failure (unknown outcome)', true);
}

// AdapterFactory with encrypted envelope + fake transport
$factory = new AdapterFactory(new FakeTransport(array(array('status' => 200, 'body' => file_get_contents($fixtures . 'balance.json')))));
$providerRow = (object) array(
    'adapter' => 'generic', 'api_url' => 'https://192.0.2.10/api/v2',
    'api_key_encrypted' => Crypto::encrypt('factory-key'), 'request_timeout' => 15,
    'refill_supported' => null, 'cancel_supported' => null,
);
$built = $factory->forProvider($providerRow);
check($tests, 'factory builds generic adapter from encrypted row', $built instanceof GenericSmmAdapter);
check($tests, 'factory test through adapter', $built->testConnection()['ok'] === true);

// ------------------------------------------- OrderService: happy path + idempotency
function buildOrderService(FakeProviderFinder $finder, FakeOrderStore $orders, FakeApiRecorder $recorder, FakeTransport $transport)
{
    return new OrderService($finder, $orders, $recorder, new AdapterFactory($transport));
}

$finder = new FakeProviderFinder();
$finder->addProvider(1);
$finder->addMapping(7, 555, 1, 12);
$finder->addService(12, 1);
$orders = new FakeOrderStore();
$recorder = new FakeApiRecorder();
$transport = new FakeTransport(array(array('status' => 200, 'body' => file_get_contents($fixtures . 'add.json'))));
$service = buildOrderService($finder, $orders, $recorder, $transport);

$result = $service->submitForService(array(
    'whmcs_service_id' => 9001, 'whmcs_order_id' => 123, 'whmcs_client_id' => 42,
    'whmcs_product_id' => 555, 'target_url' => 'https://www.instagram.com/x/', 'quantity' => 500,
));
check($tests, 'order submission accepted', $result['ok'] === true && $result['state'] === OrderService::STATE_ACCEPTED && $result['provider_order_id'] === '235412');
$row = $orders->findByServiceId(9001);
check($tests, 'order stored with snapshot + provider order id', $row !== null && $row->provider_order_id === '235412' && $row->provider_name === 'Test Provider 1' && $row->service_name === 'Instagram Followers - Real' && $row->quantity === 500);
check($tests, 'order records refill/cancel support snapshot', (int) $row->refill_supported === 1 && (int) $row->cancel_supported === 1);
check($tests, 'submission api call logged once with correlation id', count($recorder->calls) === 1 && $recorder->calls[0]['operation'] === 'add' && $recorder->calls[0]['correlation_id'] !== '');

// THE idempotency test: repeated provisioning calls must NOT re-submit.
$result2 = $service->submitForService(array(
    'whmcs_service_id' => 9001, 'whmcs_order_id' => 123, 'whmcs_client_id' => 42,
    'whmcs_product_id' => 555, 'target_url' => 'https://www.instagram.com/x/', 'quantity' => 500,
));
check($tests, 'repeat submission is idempotent (no second API call)', $result2['ok'] === true && $transport->calls() === 1 && $result2['provider_order_id'] === '235412');
$result3 = $service->submitForService(array(
    'whmcs_service_id' => 9001, 'whmcs_order_id' => 123, 'whmcs_client_id' => 42,
    'whmcs_product_id' => 555, 'target_url' => 'https://www.instagram.com/x/', 'quantity' => 500,
));
check($tests, 'third submission still no API call', $transport->calls() === 1 && $result3['ok'] === true);

// Validation guard: quantity below mapping minimum never reaches the wire.
$transport2 = new FakeTransport();
$service2 = buildOrderService($finder, new FakeOrderStore(), new FakeApiRecorder(), $transport2);
$result = $service2->submitForService(array(
    'whmcs_service_id' => 9002, 'whmcs_order_id' => 124, 'whmcs_client_id' => 42,
    'whmcs_product_id' => 555, 'target_url' => 'https://www.instagram.com/x/', 'quantity' => 10,
));
check($tests, 'quantity below minimum rejected before any API call', $result['ok'] === false && $transport2->calls() === 0);

// Unmapped product: no order row, no API call.
$result = $service2->submitForService(array(
    'whmcs_service_id' => 9003, 'whmcs_order_id' => 125, 'whmcs_client_id' => 42,
    'whmcs_product_id' => 777, 'target_url' => 'https://www.instagram.com/x/', 'quantity' => 500,
));
check($tests, 'unmapped product rejected safely', $result['ok'] === false && $transport2->calls() === 0 && $service2 !== null);

// -------------------------------------------- OrderService: rejection + retry
$finder = new FakeProviderFinder();
$finder->addProvider(1);
$finder->addMapping(7, 555, 1, 12);
$finder->addService(12, 1);
$orders = new FakeOrderStore();
$recorder = new FakeApiRecorder();
$transport = new FakeTransport(array(
    array('status' => 200, 'body' => file_get_contents($fixtures . 'add_error.json')),
    array('status' => 200, 'body' => file_get_contents($fixtures . 'add.json')),
));
$service = buildOrderService($finder, $orders, $recorder, $transport);
$result = $service->submitForService(array(
    'whmcs_service_id' => 9100, 'whmcs_order_id' => 200, 'whmcs_client_id' => 43,
    'whmcs_product_id' => 555, 'target_url' => 'https://www.instagram.com/y/', 'quantity' => 500,
));
$row = $orders->findByServiceId(9100);
check($tests, 'provider rejection stored as rejected', $result['ok'] === false && $row->submission_state === OrderService::STATE_REJECTED && strpos($row->error_message, 'Incorrect service ID') !== false);
$result = $service->submitForService(array(
    'whmcs_service_id' => 9100, 'whmcs_order_id' => 200, 'whmcs_client_id' => 43,
    'whmcs_product_id' => 555, 'target_url' => 'https://www.instagram.com/y/', 'quantity' => 500,
));
check($tests, 'rejected order does not auto-resubmit', $result['ok'] === false && $transport->calls() === 1);
$result = $service->retrySubmission((int) $row->id, 1);
check($tests, 'admin retry resubmits exactly once and succeeds', $result['ok'] === true && $transport->calls() === 2 && $orders->findByServiceId(9100)->submission_state === OrderService::STATE_ACCEPTED);
$result = $service->retrySubmission((int) $row->id, 1);
check($tests, 'retry after acceptance blocked (idempotent)', $result['ok'] === false && $transport->calls() === 2);

// ------------------------------------ OrderService: unknown outcome handling
$finder = new FakeProviderFinder();
$finder->addProvider(1);
$finder->addMapping(7, 555, 1, 12);
$finder->addService(12, 1);
$orders = new FakeOrderStore();
$recorder = new FakeApiRecorder();
$transport = new FakeTransport();
$transport->queueFailure('cURL error: connection timed out');
$service = buildOrderService($finder, $orders, $recorder, $transport);
$result = $service->submitForService(array(
    'whmcs_service_id' => 9200, 'whmcs_order_id' => 300, 'whmcs_client_id' => 44,
    'whmcs_product_id' => 555, 'target_url' => 'https://www.instagram.com/z/', 'quantity' => 500,
));
$row = $orders->findByServiceId(9200);
check($tests, 'lost response -> uncertain (reconciliation required)', $result['ok'] === false && $row->submission_state === OrderService::STATE_UNCERTAIN);
check($tests, 'lost response message carries correlation id', strpos($result['message'], 'reference') !== false && $result['correlation_id'] !== '');
$result = $service->submitForService(array(
    'whmcs_service_id' => 9200, 'whmcs_order_id' => 300, 'whmcs_client_id' => 44,
    'whmcs_product_id' => 555, 'target_url' => 'https://www.instagram.com/z/', 'quantity' => 500,
));
check($tests, 'uncertain order NEVER auto-resubmits', $result['ok'] === false && $transport->calls() === 1 && $result['state'] === OrderService::STATE_UNCERTAIN);
$result = $service->attachProviderOrder((int) $row->id, '999123', 1);
check($tests, 'reconciliation attach records provider order id', $result['ok'] === true && $orders->findById((int) $row->id)->provider_order_id === '999123');
check($tests, 'in-flight claim prevents concurrent double submit', (function () use ($finder, $orders) {
    $store = new FakeOrderStore();
    $svc = buildOrderService($finder, $store, new FakeApiRecorder(), new FakeTransport());
    $svc->submitForService(array(
        'whmcs_service_id' => 9300, 'whmcs_order_id' => 400, 'whmcs_client_id' => 45,
        'whmcs_product_id' => 555, 'target_url' => 'https://www.instagram.com/w/', 'quantity' => 500,
    ));
    $row = $store->findByServiceId(9300);
    // simulate a second worker racing: state is accepted, a claim attempt fails
    return $store->claimForSubmission((int) $row->id) === false;
})());

// ------------------------------------------------------- StatusSyncService
function orderRow($id, $serviceId, $providerId, $status)
{
    return (object) array(
        'id' => $id, 'whmcs_service_id' => $serviceId, 'whmcs_client_id' => 77,
        'whmcs_order_id' => 0, 'whmcs_product_id' => 0, 'mapping_id' => 0,
        'provider_id' => $providerId, 'provider_service_id' => '12',
        'provider_name' => 'Test Provider ' . $providerId, 'service_name' => 'Service ' . $id,
        'provider_order_id' => 'P' . $id, 'target_url' => 'https://www.example.com/t/' . $id,
        'quantity' => 500, 'start_count' => null, 'remains' => null,
        'customer_price' => 1.5, 'provider_cost' => 0.9, 'currency' => 'USD',
        'submission_state' => 'accepted', 'order_status' => $status,
        'provider_status_raw' => '', 'suspended' => 0, 'needs_review' => 0,
        'refill_supported' => 0, 'cancel_supported' => 0,
        'last_refill_id' => '', 'last_refill_status' => '',
        'error_message' => '', 'correlation_id' => 'corr' . $id,
        'submitted_at' => date('Y-m-d H:i:s'), 'last_status_at' => date('Y-m-d H:i:s'),
        'last_sync_at' => null, 'created_at' => date('Y-m-d H:i:s'),
        'updated_at' => date('Y-m-d H:i:s'),
    );
}
$finder = new FakeProviderFinder();
$finder->addProvider(1);
$finder->addProvider(2);
$orders = new FakeOrderStore();
$orders->rows[1] = orderRow(1, 101, 1, 'pending');
$orders->rows[2] = orderRow(2, 102, 1, 'completed'); // stale terminal: outside the recheck window
$orders->rows[2]->last_status_at = date('Y-m-d H:i:s', time() - 172800);
$orders->rows[3] = orderRow(3, 103, 2, 'pending');   // other provider
$recorder = new FakeApiRecorder();
$transport = new FakeTransport(array(
    array('status' => 200, 'body' => file_get_contents($fixtures . 'status_inprogress.json')),
    array('status' => 200, 'body' => file_get_contents($fixtures . 'status_processing.json')),
));
$sync = new StatusSyncService($finder, $orders, $recorder, new AdapterFactory($transport));
$summary = $sync->syncBatch(50);
check($tests, 'status sync polls eligible orders only (stale terminal skipped)', $transport->calls() === 2 && $summary['checked'] === 2);
check($tests, 'status sync applies normalized transition', $orders->rows[1]->order_status === 'in_progress' && $orders->rows[1]->remains === 250 && $orders->rows[1]->start_count === 3572);
check($tests, 'status sync records event with correlation id', count($orders->events) === 2 && $orders->events[0]->event === 'status_change');

// Terminal conflict: a FRESHLY terminal order is re-verified inside the
// window; the provider contradicting it must not overwrite the stored status.
$finder = new FakeProviderFinder();
$finder->addProvider(1);
$orders = new FakeOrderStore();
$orders->rows[1] = orderRow(1, 201, 1, 'completed');
$transport = new FakeTransport(array(array('status' => 200, 'body' => file_get_contents($fixtures . 'status_inprogress.json'))));
$recorder = new FakeApiRecorder();
$sync = new StatusSyncService($finder, $orders, $recorder, new AdapterFactory($transport));
$summary = $sync->syncBatch(50);
check($tests, 'verified terminal status never overwritten', $orders->rows[1]->order_status === 'completed' && $orders->rows[1]->needs_review === 1);
check($tests, 'terminal conflict flagged in summary + event', $summary['conflicts'] === 1 && $orders->events[0]->event === 'status_conflict');

// Provider isolation: provider 1 fails, provider 2 still synced.
$finder = new FakeProviderFinder();
$finder->addProvider(1);
$finder->addProvider(2);
$orders = new FakeOrderStore();
$orders->rows[1] = orderRow(1, 301, 1, 'pending');
$orders->rows[2] = orderRow(2, 302, 1, 'pending');
$orders->rows[3] = orderRow(3, 303, 2, 'pending');
$transport = new FakeTransport(array(
    array('status' => 0, 'error' => 'cURL error: timeout'), // provider 1 first order fails
    array('status' => 200, 'body' => file_get_contents($fixtures . 'status_completed.json')), // provider 2 still polled
));
$recorder = new FakeApiRecorder();
$sync = new StatusSyncService($finder, $orders, $recorder, new AdapterFactory($transport));
$summary = $sync->syncBatch(50);
check($tests, 'provider isolation: failing provider skipped after first error', $transport->calls() === 2 && $summary['providers_skipped'] === 1 && isset($finder->errors[1]));
check($tests, 'provider isolation: other provider still synced', $orders->rows[3]->order_status === 'completed');
check($tests, 'provider error recorded on provider row', $finder->providers[1]->connection_status === 'error');

// ---------------------------------------------------- ReconciliationService
// Case 1: uncertain + attached provider order id + provider knows it -> accepted.
$finder = new FakeProviderFinder();
$finder->addProvider(1);
$orders = new FakeOrderStore();
$row = orderRow(1, 401, 1, null);
$row->submission_state = 'uncertain';
$row->provider_order_id = '555001';
$orders->rows[1] = $row;
$transport = new FakeTransport(array(array('status' => 200, 'body' => file_get_contents($fixtures . 'status_processing.json'))));
$recorder = new FakeApiRecorder();
$recon = new ReconciliationService($finder, $orders, $recorder, new AdapterFactory($transport));
$summary = $recon->process(50);
check($tests, 'reconciliation verifies without resubmitting', $orders->rows[1]->submission_state === 'accepted' && $transport->lastAction() === 'status' && $summary['resolved'] === 1);

// Case 2: uncertain + provider does not know the order -> rejected (retry-safe).
$orders = new FakeOrderStore();
$row = orderRow(1, 402, 1, null);
$row->submission_state = 'uncertain';
$row->provider_order_id = '555002';
$orders->rows[1] = $row;
$transport = new FakeTransport(array(array('status' => 200, 'body' => file_get_contents($fixtures . 'status_notfound.json'))));
$recon = new ReconciliationService($finder, $orders, new FakeApiRecorder(), new AdapterFactory($transport));
$summary = $recon->process(50);
check($tests, 'reconciliation: unknown provider order -> rejected (never resubmitted)', $orders->rows[1]->submission_state === 'rejected' && $transport->lastAction() === 'status');

// Case 3: uncertain without provider order id -> manual attention, no API call.
$orders = new FakeOrderStore();
$row = orderRow(1, 403, 1, null);
$row->submission_state = 'uncertain';
$row->provider_order_id = '';
$orders->rows[1] = $row;
$transport = new FakeTransport();
$recon = new ReconciliationService($finder, $orders, new FakeApiRecorder(), new AdapterFactory($transport));
$summary = $recon->process(50);
check($tests, 'reconciliation: no provider id -> flagged for manual attention', $summary['needs_manual_attention'] === 1 && $transport->calls() === 0 && $orders->rows[1]->submission_state === 'uncertain');

// ----------------------------------------------------------- CatalogSync
$fetched = array(
    array('provider_service_id' => '12', 'name' => 'Instagram Followers - Real', 'category' => 'Instagram', 'description' => '', 'type' => 'Default', 'min_quantity' => 100, 'max_quantity' => 10000, 'rate' => '0.90', 'currency' => 'USD', 'refill' => true, 'cancel' => true, 'provider_status' => 'active'),
    array('provider_service_id' => '99', 'name' => 'New Service', 'category' => 'New', 'description' => '', 'type' => 'Default', 'min_quantity' => 1, 'max_quantity' => 100, 'rate' => '0.50', 'currency' => 'USD', 'refill' => false, 'cancel' => false, 'provider_status' => 'active'),
    // service 31 disappeared in an earlier sync (existing id 7, available=0) and now returns
    array('provider_service_id' => '31', 'name' => 'YouTube Views', 'category' => 'YouTube', 'description' => '', 'type' => 'Default', 'min_quantity' => 1000, 'max_quantity' => 1000000, 'rate' => '1.20', 'currency' => 'USD', 'refill' => true, 'cancel' => false, 'provider_status' => 'active'),
);
$existing = array(
    (object) array('id' => 5, 'provider_service_id' => '12', 'name' => 'Instagram Followers - Real', 'category' => 'Instagram', 'description' => '', 'type' => 'Default', 'min_quantity' => 100, 'max_quantity' => 10000, 'rate' => '0.90', 'currency' => 'USD', 'refill' => 1, 'cancel' => 1, 'provider_status' => 'active', 'available' => 1),
    (object) array('id' => 6, 'provider_service_id' => '27', 'name' => 'TikTok Likes', 'category' => 'TikTok', 'description' => '', 'type' => 'Default', 'min_quantity' => 50, 'max_quantity' => 5000, 'rate' => '0.10', 'currency' => 'USD', 'refill' => 0, 'cancel' => 0, 'provider_status' => 'active', 'available' => 1),
    (object) array('id' => 7, 'provider_service_id' => '31', 'name' => 'YouTube Views', 'category' => 'YouTube', 'description' => '', 'type' => 'Default', 'min_quantity' => 1000, 'max_quantity' => 1000000, 'rate' => '1.20', 'currency' => 'USD', 'refill' => 1, 'cancel' => 0, 'provider_status' => 'active', 'available' => 0),
);
$plan = CatalogSync::merge($fetched, $existing);
check($tests, 'catalog merge detects new service', count($plan['add']) === 1 && $plan['add'][0]['provider_service_id'] === '99');
check($tests, 'catalog merge keeps unchanged rows', $plan['unchanged'] === 1 && !isset($plan['update'][5]));
check($tests, 'catalog merge deactivates missing (never deletes)', $plan['deactivate'] === array(6));
check($tests, 'catalog merge reactivates returning service', isset($plan['update'][7]) && $plan['update'][7]['available'] === 1);
$changed = $fetched;
$changed[0]['rate'] = '1.10';
$plan = CatalogSync::merge($changed, $existing);
check($tests, 'catalog merge detects price change', isset($plan['update'][5]) && (float) $plan['update'][5]['rate'] === 1.10);

// ----------------------------------------------------------- Automation::isDue
check($tests, 'automation isDue: never run -> due', Automation::isDue(null, 900));
check($tests, 'automation isDue: recent run -> not due', Automation::isDue(date('Y-m-d H:i:s', time() - 60), 900) === false);
check($tests, 'automation isDue: stale run -> due', Automation::isDue(date('Y-m-d H:i:s', time() - 1000), 900) === true);
check($tests, 'automation isDue: floors runaway intervals', Automation::isDue(date('Y-m-d H:i:s', time() - 30), 0) === false);

// --------------------------------------------------------- ClientAreaService
$finder = new FakeProviderFinder();
$finder->addProvider(1);
$orders = new FakeOrderStore();
$row = orderRow(1, 501, 1, 'completed');
$row->whmcs_client_id = 77;
$row->service_name = 'Instagram Followers - Real';
$row->refill_supported = 1;
$row->cancel_supported = 1;
$row->last_refill_id = '';
$row->last_refill_status = '';
$orders->rows[1] = $row;
$recorder = new FakeApiRecorder();
$transport = new FakeTransport(array(array('status' => 200, 'body' => file_get_contents($fixtures . 'refill.json'))));
$client = new ClientAreaService($finder, $orders, $recorder, new AdapterFactory($transport));

$foreign = $client->viewForService(501, 999); // wrong client
$own = $client->viewForService(501, 77);
check($tests, 'client area enforces ownership', $foreign === null && $own !== null && $own['service_name'] === 'Instagram Followers - Real');
$public = json_encode($own);
check($tests, 'client view exposes no provider internals', strpos($public, 'api_url') === false && strpos($public, 'provider_order_id') === false && strpos($public, 'error_message') === false);
check($tests, 'client view gates refill on completed+supported', $own['refill_allowed'] === true);
$result = $client->requestRefill(501, 77);
check($tests, 'client refill request accepted', $result['ok'] === true && $orders->rows[1]->last_refill_id === '9981');
$result = $client->requestRefill(501, 77);
check($tests, 'duplicate refill blocked while one in progress', $result['ok'] === false && $transport->calls() === 1);
$result = $client->requestRefill(501, 999);
check($tests, 'refill refuses wrong owner', $result['ok'] === false && $transport->calls() === 1);

$pending = orderRow(2, 502, 1, 'pending');
$pending->whmcs_client_id = 77;
$pending->refill_supported = 1;
$pending->cancel_supported = 1;
$pending->last_refill_id = '';
$pending->last_refill_status = '';
$orders->rows[2] = $pending;
$view2 = $client->viewForService(502, 77);
check($tests, 'pending order: cancel offered, refill not', $view2['cancel_allowed'] === true && $view2['refill_allowed'] === false);

$noCancel = orderRow(3, 503, 1, 'pending');
$noCancel->whmcs_client_id = 77;
$noCancel->refill_supported = 0;
$noCancel->cancel_supported = 0;
$orders->rows[3] = $noCancel;
$view3 = $client->viewForService(503, 77);
check($tests, 'unsupported capability hides buttons', $view3['cancel_allowed'] === false && $view3['refill_allowed'] === false);

// ---------------------------------------------------------------- report
$fail = 0;
foreach ($tests as $name => $ok) {
    echo ($ok ? 'ok' : 'not ok') . " - $name\n";
    if (!$ok) { $fail++; }
}
echo count($tests) . " tests, $fail failures\n";
exit($fail ? 1 : 0);
