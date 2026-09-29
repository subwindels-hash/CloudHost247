<?php
/**
 * CloudHost247 Domain Brokerage behavior suite.
 *
 * Exercises the real module classes (domain state machines, provider
 * adapters, routing, repositories, negotiation, payment and transfer
 * services) against an in-memory fake of the WHMCS database layer and a
 * stubbed "no integration configured" API & Integrations manager — exactly
 * how a fresh, uncredentialed installation behaves. No network access, no
 * real database, no WHMCS runtime.
 *
 * Usage: php tests/broker/run.php   (exits non-zero on any failure)
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');

define('WHMCS', true);

$root = dirname(__DIR__, 2);
// bootstrap.php must load first: it only registers PSR-4 autoloaders (no
// eager class references), while fakes.php declares
// CH247BrokerTestLookupBridge implementing
// CloudHost247\Broker\Domain\LookupBridgeInterface at require-time, which
// needs the CloudHost247\Broker\ autoloader already registered to resolve.
require_once $root . '/modules/addons/cloudhost247_broker/bootstrap.php';
require_once __DIR__ . '/fakes.php';

use CloudHost247\Broker\Domain\CaseStatus;
use CloudHost247\Broker\Domain\DomainState;
use CloudHost247\Broker\Domain\DomainStatusResolver;
use CloudHost247\Broker\Domain\PaymentStatus;
use CloudHost247\Broker\Domain\TransferStatus;
use CloudHost247\Broker\Providers\AdapterRegistry;
use CloudHost247\Broker\Providers\AfternicAdapter;
use CloudHost247\Broker\Providers\Capability;
use CloudHost247\Broker\Providers\ConnectionState;
use CloudHost247\Broker\Providers\DomainAgentsAdapter;
use CloudHost247\Broker\Providers\GoDaddyAdapter;
use CloudHost247\Broker\Providers\ManualBrokerAdapter;
use CloudHost247\Broker\Providers\SedoAdapter;
use CloudHost247\Broker\Repositories\CaseRepository;
use CloudHost247\Broker\Repositories\FeeRepository;
use CloudHost247\Broker\Repositories\ProviderConfigRepository;
use CloudHost247\Broker\Repositories\SettingsRepository;
use CloudHost247\Broker\Routing\AcquisitionRouter;
use CloudHost247\Broker\Security\CaseGuard;
use CloudHost247\Broker\Security\InputValidator;
use CloudHost247\Broker\Services\BrokerageService;
use CloudHost247\Broker\Services\CaseNumberGenerator;
use CloudHost247\Broker\Services\FeeCalculator;
use CloudHost247\Broker\Services\NegotiationService;
use CloudHost247\Broker\Services\PaymentService;
use CloudHost247\Broker\Services\TransferService;

$tests = array();

// Every scenario starts from a clean in-memory database.
function ch247_broker_fresh()
{
    CH247BrokerFakeDB::reset();
    $GLOBALS['CH247_BROKER_INVOICES'] = array();
    $GLOBALS['CH247_BROKER_EMAILS'] = array();
}

function ch247_broker_seed_case($overrides = array())
{
    $service = new BrokerageService();
    return $service->createCase(array_merge(array(
        'client_id' => 501,
        'domain' => 'example-broker-test.com',
        'max_budget' => 5000,
        'currency' => 'USD',
        'terms_accepted' => true,
    ), $overrides));
}

/** Walks a freshly created case through the real prerequisite states up to Negotiation. */
function ch247_broker_seed_negotiating_case($overrides = array())
{
    $case = ch247_broker_seed_case($overrides);
    $service = new BrokerageService();
    $service->assignBroker($case->id, 7, 1);
    $service->recordContactAttempt($case->id, 7, 'Reached out via registrar forwarding.');
    return $service->recordOwnerResponse($case->id, 7, 'Owner is open to an offer.');
}

// -------------------------------------------------------------- domain enums

$tests['CaseStatus exposes exactly the documented lifecycle'] = function () {
    $all = CaseStatus::all();
    return count($all) === 15 && in_array(CaseStatus::REQUEST_SUBMITTED, $all, true) && in_array(CaseStatus::DISPUTED, $all, true);
};
$tests['CaseStatus forward transitions are enforced'] = function () {
    return CaseStatus::canTransition(CaseStatus::REQUEST_SUBMITTED, CaseStatus::BROKER_ASSIGNED)
        && !CaseStatus::canTransition(CaseStatus::REQUEST_SUBMITTED, CaseStatus::COMPLETED)
        && !CaseStatus::canTransition(CaseStatus::COMPLETED, CaseStatus::NEGOTIATION);
};
$tests['CaseStatus disputed can be entered from any active status and resumed'] = function () {
    return CaseStatus::canTransition(CaseStatus::NEGOTIATION, CaseStatus::DISPUTED)
        && !CaseStatus::canTransition(CaseStatus::COMPLETED, CaseStatus::DISPUTED)
        && CaseStatus::canTransition(CaseStatus::DISPUTED, CaseStatus::NEGOTIATION)
        && !CaseStatus::canTransition(CaseStatus::DISPUTED, CaseStatus::COMPLETED);
};
$tests['PaymentStatus has no fabricated escrow state'] = function () {
    return PaymentStatus::isValid(PaymentStatus::PAID) && !PaymentStatus::isValid('escrow_held') && PaymentStatus::label('bogus') === 'bogus';
};
$tests['TransferStatus only advances one real step at a time'] = function () {
    return TransferStatus::canAdvance(TransferStatus::AUTHORIZATION_PENDING, TransferStatus::AUTHORIZED)
        && !TransferStatus::canAdvance(TransferStatus::AUTHORIZATION_PENDING, TransferStatus::VERIFIED)
        && !TransferStatus::canAdvance(TransferStatus::COMPLETED, TransferStatus::FAILED)
        && TransferStatus::canAdvance(TransferStatus::PROCESSING, TransferStatus::FAILED);
};
$tests['DomainState never treats a registered domain as for-sale by default'] = function () {
    return DomainState::isBrokerEligible(DomainState::REGISTERED)
        && !DomainState::isBrokerEligible(DomainState::AVAILABLE)
        && !DomainState::isBrokerEligible(DomainState::UNKNOWN)
        && DomainState::label('nonsense') === DomainState::label(DomainState::UNKNOWN);
};
$tests['Capability vocabulary is the closed documented set'] = function () {
    $expected = array('domain_availability', 'domain_search', 'for_sale_lookup', 'brokerage_request', 'owner_contact', 'offer_submission',
        'counteroffer', 'negotiation', 'payment', 'escrow', 'transfer', 'transfer_status', 'domain_delivery', 'domain_registration', 'dns_management', 'domain_contacts');
    $reflection = new ReflectionClass(Capability::class);
    $constants = array_values($reflection->getConstants());
    sort($expected); sort($constants);
    return $expected === $constants;
};
$tests['ConnectionState never defaults an unknown code to Connected'] = function () {
    return ConnectionState::fromIntegrationResultCode('bogus') === ConnectionState::NOT_CONFIGURED
        && ConnectionState::fromIntegrationResultCode('connected') === ConnectionState::CONNECTED;
};

// ---------------------------------------------------------------- validation

$tests['InputValidator normalizes and validates domains'] = function () {
    if (InputValidator::domain('HTTPS://WWW.Example.COM') !== 'example.com') { return false; }
    try { InputValidator::domain('not a domain'); return false; } catch (InvalidArgumentException $e) { return true; }
};
$tests['InputValidator enforces money bounds'] = function () {
    if (InputValidator::money('1234.5') !== 1234.5) { return false; }
    try { InputValidator::money(-1); return false; } catch (InvalidArgumentException $e) {}
    try { InputValidator::money('abc'); return false; } catch (InvalidArgumentException $e) { return true; }
    return false;
};
$tests['InputValidator restricts currency to the supported whitelist'] = function () {
    if (InputValidator::currency('usd') !== 'USD') { return false; }
    try { InputValidator::currency('XXX'); return false; } catch (InvalidArgumentException $e) { return true; }
};
$tests['InputValidator idempotency keys must match the safe format'] = function () {
    if (InputValidator::idempotencyKey('') !== null) { return false; }
    if (InputValidator::idempotencyKey('client-1-abcdefgh') === null) { return false; }
    try { InputValidator::idempotencyKey('bad key with spaces!!'); return false; } catch (InvalidArgumentException $e) { return true; }
};
$tests['InputValidator rejects a deadline in the past'] = function () {
    try { InputValidator::futureDate('2000-01-01'); return false; } catch (InvalidArgumentException $e) { return true; }
};

// ---------------------------------------------------------------- providers

$tests['GoDaddy adapter never reports Connected without a real integration record'] = function () {
    ch247_broker_fresh();
    $adapter = new GoDaddyAdapter(new ProviderConfigRepository());
    return $adapter->connectionState() === ConnectionState::NOT_CONFIGURED
        && $adapter->activeCapabilities() === array()
        && $adapter->checkAvailability('example.com') === null; // never guesses
};
$tests['Sedo and Afternic gate aftermarket capabilities behind an agreement'] = function () {
    ch247_broker_fresh();
    $sedo = new SedoAdapter(new ProviderConfigRepository());
    $afternic = new AfternicAdapter(new ProviderConfigRepository());
    return in_array(Capability::DOMAIN_SEARCH, $sedo->declaredCapabilities(), true)
        && in_array(Capability::BROKERAGE_REQUEST, $sedo->declaredCapabilities(), true)
        && in_array(Capability::FOR_SALE_LOOKUP, $afternic->declaredCapabilities(), true)
        && $sedo->activeCapabilities() === array()   // not configured -> nothing active
        && $afternic->activeCapabilities() === array();
};
$tests['DomainAgents adapter gates every capability on the partner agreement'] = function () {
    ch247_broker_fresh();
    $adapter = new DomainAgentsAdapter(new ProviderConfigRepository());
    return in_array(Capability::OWNER_CONTACT, $adapter->declaredCapabilities(), true)
        && !empty($adapter->declaredCapabilities())
        && $adapter->activeCapabilities() === array(); // not configured -> nothing active, even though declared
};
$tests['Manual broker is always fully active with no external dependency'] = function () {
    $adapter = new ManualBrokerAdapter();
    return $adapter->connectionState() === ConnectionState::MANUAL
        && $adapter->isManual()
        && $adapter->activeCapabilities() === $adapter->declaredCapabilities()
        && $adapter->supports(Capability::OWNER_CONTACT);
};
$tests['AdapterRegistry exposes every built-in provider'] = function () {
    $keys = AdapterRegistry::keys();
    foreach (array('manual', 'godaddy', 'sedo', 'afternic', 'domainagents') as $expected) { if (!in_array($expected, $keys, true)) { return false; } }
    return true;
};

// ------------------------------------------------------------------ routing

$tests['AcquisitionRouter guarantees the manual fallback when nothing is configured'] = function () {
    ch247_broker_fresh();
    $route = (new AcquisitionRouter())->select('');
    return $route['route'] === AcquisitionRouter::ROUTE_D && $route['provider_key'] === ManualBrokerAdapter::KEY;
};
$tests['AcquisitionRouter takes route C when a registrar is known but no provider can help'] = function () {
    ch247_broker_fresh();
    $route = (new AcquisitionRouter())->select('Example Registrar Inc.');
    return $route['route'] === AcquisitionRouter::ROUTE_C;
};
$tests['AcquisitionRouter never invents route A/B without an active connected provider'] = function () {
    ch247_broker_fresh();
    (new ProviderConfigRepository())->save('sedo', array('priority' => 10, 'enabled' => 1, 'partner_agreement_confirmed' => 1));
    $route = (new AcquisitionRouter())->select('');
    // enabled + agreement confirmed is still not enough without a real Connected integration.
    return $route['route'] === AcquisitionRouter::ROUTE_D;
};

// -------------------------------------------------------------- repositories

$tests['CaseNumberGenerator produces sequential, year-scoped case numbers'] = function () {
    ch247_broker_fresh();
    $gen = new CaseNumberGenerator();
    $first = $gen->next('2026');
    $rows = &CH247BrokerFakeDB::rowsRef('mod_cloudhost247_broker_cases');
    $rows[] = array('id' => 1, 'case_number' => $first, 'created_at' => date('Y-m-d H:i:s'));
    unset($rows);
    $second = $gen->next('2026');
    return $first === 'BRK-2026-000001' && $second === 'BRK-2026-000002';
};
$tests['SettingsRepository falls back to safe defaults and persists overrides'] = function () {
    ch247_broker_fresh();
    $settings = new SettingsRepository();
    $before = $settings->isBrokerageEnabled();
    $settings->set('brokerage_enabled', '1');
    return $before === false && $settings->isBrokerageEnabled() === true && $settings->get('manual_broker_fallback') === '1';
};
$tests['FeeRepository CRUD round-trips a fee rule'] = function () {
    ch247_broker_fresh();
    $fees = new FeeRepository();
    $id = $fees->create(array('name' => 'Standard brokerage fee', 'fee_type' => 'percentage', 'applies_to' => 'brokerage_fee', 'amount' => 10, 'min_amount' => 50, 'currency' => null, 'provider_key' => null, 'enabled' => 1));
    $found = $fees->find($id);
    $fees->update($id, array('amount' => 12));
    $updated = $fees->find($id);
    $fees->delete($id);
    return $found->name === 'Standard brokerage fee' && (float) $updated->amount === 12.0 && $fees->find($id) === null;
};

// ------------------------------------------------------------------ fee math

$tests['FeeCalculator applies percentage fees with a minimum floor'] = function () {
    ch247_broker_fresh();
    $fees = new FeeRepository();
    $fees->create(array('name' => 'Brokerage %', 'fee_type' => 'percentage', 'applies_to' => 'brokerage_fee', 'amount' => 10, 'min_amount' => 200, 'currency' => null, 'provider_key' => null, 'enabled' => 1));
    $fees->create(array('name' => 'Transfer flat', 'fee_type' => 'fixed', 'applies_to' => 'transfer_fee', 'amount' => 25, 'min_amount' => null, 'currency' => null, 'provider_key' => null, 'enabled' => 1));
    $calc = new FeeCalculator($fees);
    $small = $calc->calculate(1000, 'USD'); // 10% = 100, floored to 200 minimum
    $large = $calc->calculate(10000, 'USD'); // 10% = 1000, above the floor
    return $small['brokerage_fee'] === 200.0 && $small['transfer_fee'] === 25.0 && $small['total'] === 1225.0
        && $large['brokerage_fee'] === 1000.0;
};
$tests['FeeCalculator prefers a provider-specific rule over a global one'] = function () {
    ch247_broker_fresh();
    $fees = new FeeRepository();
    $fees->create(array('name' => 'Global', 'fee_type' => 'fixed', 'applies_to' => 'service_fee', 'amount' => 10, 'min_amount' => null, 'currency' => null, 'provider_key' => null, 'enabled' => 1));
    $fees->create(array('name' => 'Manual-specific', 'fee_type' => 'fixed', 'applies_to' => 'service_fee', 'amount' => 15, 'min_amount' => null, 'currency' => null, 'provider_key' => 'manual', 'enabled' => 1));
    $calc = new FeeCalculator($fees);
    $result = $calc->calculate(1000, 'USD', 'manual');
    return $result['service_fee'] === 15.0;
};

// ------------------------------------------------------------ brokerage flow

$tests['BrokerageService creates a case with the guaranteed manual route and is idempotent'] = function () {
    ch247_broker_fresh();
    $case = ch247_broker_seed_case(array('idempotency_key' => 'seed-key-0001'));
    $again = (new BrokerageService())->createCase(array(
        'client_id' => 999, 'domain' => 'different-domain-ignored.com', 'max_budget' => 1, 'currency' => 'USD',
        'terms_accepted' => true, 'idempotency_key' => 'seed-key-0001',
    ));
    return $case->status === CaseStatus::MANUAL_BROKER_REQUIRED
        && $case->acquisition_route === AcquisitionRouter::ROUTE_D
        && $again->id === $case->id && $again->domain === $case->domain; // retried request returns the original, not a duplicate
};
$tests['BrokerageService rejects a request without terms acceptance'] = function () {
    ch247_broker_fresh();
    try {
        (new BrokerageService())->createCase(array('client_id' => 1, 'domain' => 'x.com', 'max_budget' => 10, 'currency' => 'USD', 'terms_accepted' => false));
        return false;
    } catch (InvalidArgumentException $e) { return true; }
};
$tests['BrokerageService enforces a real, DB-backed per-customer request rate limit'] = function () {
    ch247_broker_fresh();
    $settings = new SettingsRepository();
    $settings->set('request_rate_limit_per_hour', '2');
    $service = new BrokerageService();
    $service->createCase(array('client_id' => 42, 'domain' => 'rate-limit-one.com', 'max_budget' => 10, 'currency' => 'USD', 'terms_accepted' => true));
    $service->createCase(array('client_id' => 42, 'domain' => 'rate-limit-two.com', 'max_budget' => 10, 'currency' => 'USD', 'terms_accepted' => true));
    try {
        $service->createCase(array('client_id' => 42, 'domain' => 'rate-limit-three.com', 'max_budget' => 10, 'currency' => 'USD', 'terms_accepted' => true));
        return false; // a third request within the hour must be rejected
    } catch (RuntimeException $e) { /* expected */ }
    // A different customer is never affected by another customer's rate limit.
    $other = $service->createCase(array('client_id' => 43, 'domain' => 'rate-limit-other-customer.com', 'max_budget' => 10, 'currency' => 'USD', 'terms_accepted' => true));
    return $other->client_id === 43;
};
$tests['BrokerageService enforces the case status transition map'] = function () {
    ch247_broker_fresh();
    $case = ch247_broker_seed_case();
    $service = new BrokerageService();
    try { $service->transitionStatus($case->id, CaseStatus::COMPLETED, 'admin', 1, 'skip ahead'); return false; }
    catch (RuntimeException $e) { /* expected */ }
    $service->assignBroker($case->id, 7, 1);
    $service->recordContactAttempt($case->id, 7, 'Reached out via registrar forwarding.');
    $updated = $service->recordOwnerResponse($case->id, 7, 'Owner is open to an offer.');
    return $updated->status === CaseStatus::NEGOTIATION;
};
$tests['BrokerageService dispute blocks progress until resolved'] = function () {
    ch247_broker_fresh();
    $case = ch247_broker_seed_case();
    $service = new BrokerageService();
    $service->assignBroker($case->id, 7, 1);
    $disputed = $service->markDisputed($case->id, 1, 'Customer flagged a concern.');
    try { $service->transitionStatus($case->id, CaseStatus::COMPLETED, 'admin', 1, 'cannot skip ahead while disputed'); return false; }
    catch (RuntimeException $e) { /* expected: only the dispute-resume set (or cancel/failed) is allowed while disputed */ }
    $resolved = $service->resolveDispute($case->id, 1, CaseStatus::NEGOTIATION, 'Reviewed and cleared.');
    return $disputed->disputed == 1 && $resolved->disputed == 0 && $resolved->status === CaseStatus::NEGOTIATION;
};

// ----------------------------------------------------------- negotiation flow

$tests['NegotiationService records offers idempotently and derives status correctly'] = function () {
    ch247_broker_fresh();
    $case = ch247_broker_seed_negotiating_case();
    $negotiation = new NegotiationService();
    $offer = $negotiation->submit($case->id, array('amount' => 3000, 'currency' => 'USD', 'from_party' => 'seller', 'to_party' => 'customer', 'idempotency_key' => 'offer-key-1'));
    $again = $negotiation->submit($case->id, array('amount' => 9999, 'currency' => 'USD', 'from_party' => 'seller', 'to_party' => 'customer', 'idempotency_key' => 'offer-key-1'));
    return $offer->id === $again->id && $negotiation->status($offer->id) === 'pending';
};
$tests['NegotiationService requires explicit customer approval before an offer is accepted'] = function () {
    ch247_broker_fresh();
    $case = ch247_broker_seed_negotiating_case();
    $negotiation = new NegotiationService();
    $offer = $negotiation->submit($case->id, array('amount' => 2500, 'currency' => 'USD', 'from_party' => 'seller', 'to_party' => 'customer'));
    $updatedCase = $negotiation->accept($offer->id, 'customer', 501);
    $accepted = $negotiation->acceptedOffer($case->id);
    try { $negotiation->accept($offer->id, 'customer', 501); return false; } catch (RuntimeException $e) { /* already accepted, cannot re-accept */ }
    return $updatedCase->status === CaseStatus::OFFER_ACCEPTED && $accepted->id === $offer->id;
};
$tests['NegotiationService counteroffers move the case to awaiting seller'] = function () {
    ch247_broker_fresh();
    $case = ch247_broker_seed_negotiating_case();
    $negotiation = new NegotiationService();
    $updated = $negotiation->submit($case->id, array('amount' => 2000, 'currency' => 'USD', 'kind' => 'counteroffer', 'from_party' => 'customer', 'to_party' => 'seller', 'client_id' => 501));
    $case2 = (new CaseRepository())->find($case->id);
    return $case2->status === CaseStatus::AWAITING_SELLER;
};

// -------------------------------------------------------------- payment flow

$tests['PaymentService creates one invoice per case and reconciles real WHMCS status'] = function () {
    ch247_broker_fresh();
    $case = ch247_broker_seed_negotiating_case();
    $negotiation = new NegotiationService();
    $offer = $negotiation->submit($case->id, array('amount' => 3000, 'currency' => 'USD', 'from_party' => 'seller', 'to_party' => 'customer'));
    $negotiation->accept($offer->id, 'customer', 501);

    $payments = new PaymentService();
    $payment = $payments->createInvoice($case->id, 3000, 1);
    $again = $payments->createInvoice($case->id, 3000, 1); // idempotent: same invoice, not a duplicate
    if ($payment->id !== $again->id) { return false; }

    $caseAfterInvoice = (new CaseRepository())->find($case->id);
    if ($caseAfterInvoice->status !== CaseStatus::PAYMENT_PENDING) { return false; }

    ch247_broker_set_invoice_status($payment->whmcs_invoice_id, 'Paid');
    $synced = $payments->syncStatus($case->id);
    $caseAfterPaid = (new CaseRepository())->find($case->id);
    return $synced->status === PaymentStatus::PAID && $caseAfterPaid->status === CaseStatus::TRANSFER_PENDING && $caseAfterPaid->payment_status === PaymentStatus::PAID;
};

// ------------------------------------------------------------- transfer flow

$tests['TransferService only completes a case after the transfer is actually verified'] = function () {
    ch247_broker_fresh();
    $case = ch247_broker_seed_negotiating_case();
    $negotiation = new NegotiationService();
    $offer = $negotiation->submit($case->id, array('amount' => 3000, 'currency' => 'USD', 'from_party' => 'seller', 'to_party' => 'customer'));
    $negotiation->accept($offer->id, 'customer', 501);
    $payments = new PaymentService();
    $payment = $payments->createInvoice($case->id, 3000, 1);
    ch247_broker_set_invoice_status($payment->whmcs_invoice_id, 'Paid');
    $payments->syncStatus($case->id);

    $transfers = new TransferService();
    $transfer = $transfers->authorize($case->id, 1);
    try { $transfers->complete($case->id, 1); return false; } catch (RuntimeException $e) { /* not verified yet */ }
    $transfers->initiate($case->id, 1, 'REF-123');
    try { $transfers->verify($case->id, 1); return false; } catch (RuntimeException $e) { /* must confirm+process first */ }
    $transfers->providerConfirmed($case->id, 1);
    $transfers->processing($case->id, 1);
    $transfers->verify($case->id, 1);
    $completed = $transfers->complete($case->id, 1, 'client-account-42');

    $finalCase = (new CaseRepository())->find($case->id);
    return $completed->status === TransferStatus::COMPLETED && $finalCase->status === CaseStatus::COMPLETED;
};
$tests['TransferService blocks authorization while a case is disputed'] = function () {
    ch247_broker_fresh();
    $case = ch247_broker_seed_case();
    $brokerage = new BrokerageService();
    $brokerage->assignBroker($case->id, 7, 1);
    $brokerage->markDisputed($case->id, 1, 'concern raised');
    (new CaseRepository())->update($case->id, array('payment_status' => PaymentStatus::PAID));
    try { (new TransferService())->authorize($case->id, 1); return false; }
    catch (RuntimeException $e) { return true; }
};

// ------------------------------------------------------------------- security

$tests['CaseGuard prevents a customer from accessing another customer\'s case'] = function () {
    ch247_broker_fresh();
    $case = ch247_broker_seed_case(array('client_id' => 501));
    $guard = new CaseGuard(new CaseRepository());
    try { $guard->assertOwnedByClient($case->id, 999); return false; }
    catch (RuntimeException $e) { /* expected */ }
    $owned = $guard->assertOwnedByClient($case->id, 501);
    return $owned->id === $case->id;
};

// --------------------------------------------------------- domain resolution

$tests['DomainStatusResolver flags privacy protection and transfer restriction from real WHOIS text only'] = function () {
    $bridge = new CH247BrokerTestLookupBridge();
    $bridge->availability = array('success' => true, 'available' => false, 'registrar' => 'Example Registrar');
    $bridge->whoisResult = array('success' => true, 'registrar' => 'Example Registrar', 'raw_whois' => "Domain Status: clientTransferProhibited\nRegistrant: REDACTED FOR PRIVACY\n");
    $resolver = new DomainStatusResolver(new GoDaddyAdapter(new ProviderConfigRepository()), $bridge);
    $result = $resolver->resolve('protected-domain.com');
    return $result['state'] === DomainState::TRANSFER_RESTRICTED && $result['privacy_protected'] === true && $result['broker_eligible'] === true;
};
$tests['DomainStatusResolver reports available domains as not brokerage-eligible'] = function () {
    $bridge = new CH247BrokerTestLookupBridge();
    $bridge->availability = array('success' => true, 'available' => true, 'registrar' => null);
    $resolver = new DomainStatusResolver(new GoDaddyAdapter(new ProviderConfigRepository()), $bridge);
    $result = $resolver->resolve('brand-new-domain.com');
    return $result['state'] === DomainState::AVAILABLE && $result['broker_eligible'] === false;
};
$tests['DomainStatusResolver never guesses when every source fails'] = function () {
    $bridge = new CH247BrokerTestLookupBridge();
    $resolver = new DomainStatusResolver(new GoDaddyAdapter(new ProviderConfigRepository()), $bridge);
    $result = $resolver->resolve('unreachable-domain.com');
    return $result['state'] === DomainState::PROVIDER_UNAVAILABLE && $result['source'] === 'unavailable';
};

// ------------------------------------------------------------------------- run

$failed = 0;
foreach ($tests as $name => $test) {
    try {
        $ok = $test();
    } catch (\Throwable $e) {
        $ok = false;
        echo "not ok - $name: {$e->getMessage()} (" . basename($e->getFile()) . ':' . $e->getLine() . ")\n";
        $failed++;
        continue;
    }
    echo ($ok ? 'ok' : 'not ok') . " - $name\n";
    if (!$ok) { $failed++; }
}
echo ($failed === 0 ? 'All broker tests passed.' : "$failed broker test(s) failed.") . "\n";
exit($failed ? 1 : 0);
