<?php
/**
 * CloudHost247 Marketing — behavior suite (SESSION 1 + SESSION 2).
 *
 * Pure PHP, no network, fake in-memory storage (see fakes.php); mirrors
 * tests/broker/run.php conventions. Run: php tests/marketing/run.php
 */
define('WHMCS', 1);
error_reporting(E_ALL);
require __DIR__ . '/fakes.php';

$root = dirname(dirname(__DIR__));
require $root . '/modules/addons/cloudhost247_marketing/bootstrap.php';
require $root . '/modules/addons/cloudhost247_marketing/cloudhost247_marketing.php';

use CloudHost247\Marketing\Domain\CampaignStatus;
use CloudHost247\Marketing\Domain\EventType;
use CloudHost247\Marketing\Domain\QueueStatus;
use CloudHost247\Marketing\Domain\ResultKind;
use CloudHost247\Marketing\Domain\SubscriberStatus;
use CloudHost247\Marketing\Domain\SuppressionReason;
use CloudHost247\Marketing\Http\AdminController;
use CloudHost247\Marketing\Repositories\SettingsRepository;
use CloudHost247\Marketing\Security\InputValidator;

$tests = array();

// ---------------------------------------------------------------- domain sets

$tests['CampaignStatus is the exact spec lifecycle and labels never leak unknown state'] = function () {
    $spec = array('draft', 'ready', 'scheduled', 'queued', 'sending', 'paused', 'completed', 'cancelled', 'failed', 'archived');
    if (CampaignStatus::all() !== $spec) { return false; }
    foreach ($spec as $status) { if (!CampaignStatus::isValid($status) || CampaignStatus::label($status) === 'Unknown') { return false; } }
    if (CampaignStatus::label('bogus') !== 'Unknown' || CampaignStatus::isValid('bogus')) { return false; }
    foreach (array('completed', 'cancelled', 'failed', 'archived') as $terminal) { if (!CampaignStatus::isTerminal($terminal)) { return false; } }
    return !CampaignStatus::isTerminal('sending') && !CampaignStatus::isTerminal('draft');
};

$tests['SubscriberStatus is closed and only SUBSCRIBED is sendable'] = function () {
    if (SubscriberStatus::all() !== array('subscribed', 'unsubscribed', 'pending', 'bounced', 'suppressed')) { return false; }
    if (SubscriberStatus::sendableSet() !== array('subscribed')) { return false; }
    return SubscriberStatus::label('nope') === 'Unknown';
};

$tests['QueueStatus, ResultKind, EventType and SuppressionReason are closed sets'] = function () {
    if (QueueStatus::all() !== array('queued', 'sending', 'sent', 'failed', 'skipped')) { return false; }
    if (QueueStatus::label('sent') !== 'Accepted by relay') { return false; } // honesty: SMTP-accepted, not delivered
    if (!ResultKind::isRetryable(ResultKind::TEMPORARY_FAILURE) || !ResultKind::isRetryable(ResultKind::RATE_LIMITED)) { return false; }
    if (!ResultKind::isRetryable(ResultKind::PROVIDER_UNAVAILABLE)) { return false; }
    foreach (array(ResultKind::PERMANENT_FAILURE, ResultKind::AUTHENTICATION_FAILURE, ResultKind::INVALID_RECIPIENT, ResultKind::ACCEPTED) as $kind) {
        if (ResultKind::isRetryable($kind)) { return false; }
    }
    foreach (EventType::all() as $type) { if (EventType::label($type) === 'Unknown') { return false; } }
    foreach (SuppressionReason::all() as $reason) { if (SuppressionReason::label($reason) === 'Unknown') { return false; } }
    return count(SuppressionReason::all()) === 5;
};

// ------------------------------------------------------------------ validator

$tests['InputValidator enforces emails, keys, urls, tokens and bounds'] = function () {
    if (InputValidator::email('  Alice@Example.COM ') !== 'alice@example.com') { return false; }
    foreach (array('not-an-email', 'a b@c.com', str_repeat('x', 200) . '@y.com') as $bad) {
        try { InputValidator::email($bad); return false; } catch (InvalidArgumentException $e) {}
    }
    if (!InputValidator::isPlausibleEmail('ok@test.com') || InputValidator::isPlausibleEmail('bad')) { return false; }
    if (InputValidator::domainPart('a@B.COM') !== 'b.com') { return false; }
    if (InputValidator::key('Marketing-List_1', 'k') !== 'marketing-list_1') { return false; }
    try { InputValidator::key('-bad-key', 'k'); return false; } catch (InvalidArgumentException $e) {}
    if (InputValidator::url('https://example.com/x') !== 'https://example.com/x') { return false; }
    foreach (array('javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://host/x') as $badUrl) {
        try { InputValidator::url($badUrl); return false; } catch (InvalidArgumentException $e) {}
    }
    if (InputValidator::hexToken(hash('sha256', 't')) === '') { return false; }
    try { InputValidator::hexToken('zz'); return false; } catch (InvalidArgumentException $e) {}
    if (InputValidator::positiveInt('25', 1, 500, 'n') !== 25) { return false; }
    try { InputValidator::positiveInt('999', 1, 500, 'n'); return false; } catch (InvalidArgumentException $e) {}
    try { InputValidator::idempotencyKey('has spaces'); return false; } catch (InvalidArgumentException $e) {}
    return InputValidator::idempotencyKey('campaign:1:q') === 'campaign:1:q';
};

// ------------------------------------------------------------------- settings

$tests['SettingsRepository follows defaults, persists overrides and rejects unknown keys'] = function () {
    ch247_marketing_fresh();
    $settings = new SettingsRepository();
    if ($settings->get('batch_size') !== '25') { return false; }           // spec-safe throttle default
    if ($settings->get('default_provider') !== 'cpanel_smtp') { return false; }
    $settings->set('batch_size', '50');
    $settings->set('hourly_limit', '1000');
    if ($settings->get('batch_size') !== '50' || $settings->get('hourly_limit') !== '1000') { return false; }
    if ($settings->intValue('batch_size') !== 50) { return false; }
    try { $settings->set('not_a_setting', 'x'); return false; } catch (InvalidArgumentException $e) {}
    $all = $settings->all();
    return count($all) === count($settings->defaults()) && $all['batch_size'] === '50';
};

// ----------------------------------------------------------------- activation

$tests['Activation installs all module tables idempotently and seeds settings without duplicates'] = function () {
    ch247_marketing_fresh();
    $first = cloudhost247_marketing_activate();
    if (!is_array($first) || $first['status'] !== 'success') { return false; }
    $expectedTables = array(
        'mod_cloudhost247_marketing_campaigns', 'mod_cloudhost247_marketing_subscribers',
        'mod_cloudhost247_marketing_lists', 'mod_cloudhost247_marketing_list_members',
        'mod_cloudhost247_marketing_segments', 'mod_cloudhost247_marketing_templates',
        'mod_cloudhost247_marketing_campaign_recipients', 'mod_cloudhost247_marketing_email_queue',
        'mod_cloudhost247_marketing_email_events', 'mod_cloudhost247_marketing_suppressions',
        'mod_cloudhost247_marketing_automations', 'mod_cloudhost247_marketing_automation_steps',
        'mod_cloudhost247_marketing_automation_runs', 'mod_cloudhost247_marketing_imports',
        'mod_cloudhost247_marketing_links', 'mod_cloudhost247_marketing_settings',
    );
    foreach ($expectedTables as $table) {
        if (empty(CH247MarketingFakeSchema::$created[$table])) { return false; }
    }
    $settingsRows = count(CH247MarketingFakeDB::rowsRef('mod_cloudhost247_marketing_settings'));
    $settings = new SettingsRepository();
    if ($settingsRows !== count($settings->defaults())) { return false; }
    $createdAfterFirst = count(CH247MarketingFakeSchema::$created);
    // Re-activation must be a no-op beyond bookkeeping (spec: installs cleanly, repeat-safe).
    $second = cloudhost247_marketing_activate();
    if (!is_array($second) || $second['status'] !== 'success') { return false; }
    if (count(CH247MarketingFakeSchema::$created) !== $createdAfterFirst) { return false; }
    if (count(CH247MarketingFakeDB::rowsRef('mod_cloudhost247_marketing_settings')) !== $settingsRows) { return false; }
    $deactivate = cloudhost247_marketing_deactivate();
    return is_array($deactivate) && $deactivate['status'] === 'success'
        && count(CH247MarketingFakeDB::rowsRef('mod_cloudhost247_marketing_settings')) === $settingsRows;
};

$tests['Module registration exposes the required WHMCS hooks'] = function () {
    $config = cloudhost247_marketing_config();
    return $config['name'] === 'CloudHost247 Marketing'
        && $config['version'] === '1.2.0'
        && function_exists('cloudhost247_marketing_activate')
        && function_exists('cloudhost247_marketing_deactivate')
        && function_exists('cloudhost247_marketing_output');
};

// ---------------------------------------------------------- admin foundation

$tests['Admin dashboard is real data only: zero-filled until campaigns exist, honestly reports unconfigured SMTP'] = function () {
    ch247_marketing_fresh();
    cloudhost247_marketing_activate();
    $_SESSION['adminid'] = 1;
    $_SESSION['adminroleid'] = 1;
    $data = (new AdminController())->handle();
    if ($data['view'] !== 'dashboard') { return false; }
    if ($data['stats']['subscriber_total'] !== 0 || $data['stats']['events_total'] !== 0) { return false; }
    if ($data['integration']['result_label'] !== 'Not configured') { return false; }
    if ($data['integration']['configured'] !== false || $data['integration']['tested'] !== false) { return false; }
    if (strpos($data['integration']['configure_url'], 'module=cloudhost247_integrations') === false) { return false; }
    foreach ($data['capabilities'] as $cap => $allowed) { if (!$allowed) { return false; } } // no policy = normal addon authorization
    return array_sum(array_map(function ($exists) { return $exists ? 1 : 0; }, $data['tables'])) === count($data['tables']);
};

$tests['Every advertised menu section is routable and unbuilt ones say so instead of falling back to the dashboard'] = function () {
    ch247_marketing_fresh();
    cloudhost247_marketing_activate();
    $_SESSION['adminid'] = 1;
    $_SESSION['adminroleid'] = 1;
    $_SERVER['REQUEST_METHOD'] = 'GET';
    // The menu advertises more sections than the build has landed; each of them
    // must keep its own address and explain itself rather than silently render
    // the dashboard under a different URL.
    $planned = array('analytics' => 9, 'automations' => 10);
    foreach ($planned as $view => $session) {
        $_GET = array('view' => $view);
        $data = (new AdminController())->handle();
        if ($data['view'] !== $view || (int) $data['plannedSession'] !== $session) { return false; }
    }
    // SESSIONS 3 to 5 landed: segments, templates and campaigns are real views.
    foreach (array('segments', 'templates', 'campaigns') as $realView) {
        $_GET = array('view' => $realView);
        $data = (new AdminController())->handle();
        if ($data['view'] !== $realView || (int) $data['plannedSession'] !== 0) { return false; }
    }

    // A genuinely unknown view still resolves to the dashboard.
    $_GET = array('view' => 'does-not-exist');
    $data = (new AdminController())->handle();
    return $data['view'] === 'dashboard' && (int) $data['plannedSession'] === 0;
};

$tests['Settings save requires POST+CSRF and is sanitized, audited and capability-gated'] = function () {
    ch247_marketing_fresh();
    cloudhost247_marketing_activate();
    $_SESSION['adminid'] = 1;
    $_SESSION['adminroleid'] = 1;

    // GET request never mutates settings.
    $_SERVER['REQUEST_METHOD'] = 'GET';
    $before = (new SettingsRepository())->get('hourly_limit');
    (new AdminController())->handle();
    if ((new SettingsRepository())->get('hourly_limit') !== $before) { return false; }

    // Valid save.
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_GET['view'] = 'settings';
    $token = str_repeat('ab', 16);
    $_POST = array('token' => $token, 'setting' => array('hourly_limit' => '800', 'batch_size' => '10', 'default_timezone' => 'Africa/Lagos'));
    $_REQUEST = $_POST;
    $data = (new AdminController())->handle();
    if ($data['notice'] !== 'Settings saved.') { return false; }
    $settings = new SettingsRepository();
    if ($settings->get('hourly_limit') !== '800' || $settings->get('batch_size') !== '10' || $settings->get('default_timezone') !== 'Africa/Lagos') { return false; }
    $auditRows = CH247MarketingFakeDB::rowsRef('mod_cloudhost247_audit_events');
    $found = false;
    foreach ($auditRows as $row) { if ($row['module'] === 'cloudhost247_marketing' && $row['action'] === 'settings.updated') { $found = true; } }
    if (!$found) { return false; }

    // Invalid value is rejected with an Error notice and does not persist.
    $_POST = array('token' => $token, 'setting' => array('batch_size' => '99999'));
    $_REQUEST = $_POST;
    $data = (new AdminController())->handle();
    if (strpos($data['error'], 'Error:') !== 0) { return false; }
    return $settings->get('batch_size') === '10';
};

$tests['Capability policies deny a role without the marketing.settings.manage capability'] = function () {
    ch247_marketing_fresh();
    cloudhost247_marketing_activate();
    CH247MarketingFakeDB::rowsRef('mod_cloudhost247_capabilities')[] = array(
        'id' => 1, 'module' => 'cloudhost247_marketing', 'capability' => 'marketing.settings.manage', 'role_ids' => '2',
    );
    $_SESSION['adminid'] = 1;
    $_SESSION['adminroleid'] = 1; // role 1 not allowed by the policy
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_GET['view'] = 'settings';
    $_POST = array('token' => str_repeat('ab', 16), 'setting' => array('hourly_limit' => '5'));
    $_REQUEST = $_POST;
    $threw = false;
    try { (new AdminController())->handle(); } catch (RuntimeException $e) { $threw = true; }
    return $threw && (new SettingsRepository())->get('hourly_limit') === '500';
};

// ------------------------------------------------------- integration catalog

$tests['The central catalog defines cpanel_smtp as the marketing delivery provider'] = function () {
    ch247_marketing_fresh();
    if (!\CloudHost247\Integrations\Registry\ProviderRegistry::has('cpanel_smtp')) { return false; }
    $definition = \CloudHost247\Integrations\Registry\ProviderRegistry::get('cpanel_smtp');
    if ($definition->category() !== 'email') { return false; }
    $auth = $definition->auth();
    if (!is_array($auth) || (isset($auth['type']) ? $auth['type'] : '') !== 'smtp') { return false; }
    $hasSecretPassword = false;
    $hasHost = false;
    $hasEncryption = false;
    foreach ($definition->fields() as $field) {
        if ($field->key() === 'password' && $field->isSecret()) { $hasSecretPassword = true; }
        if ($field->key() === 'host') { $hasHost = true; }
        if ($field->key() === 'encryption') { $hasEncryption = true; }
    }
    $health = $definition->health();
    return $hasSecretPassword && $hasHost && $hasEncryption
        && is_array($health) && strtoupper(isset($health['method']) ? $health['method'] : '') === 'SMTP';
};

// ---------------------------------------------------- SESSION 2 - subscribers
// Subscribers, lists, tags, import/export and the suppression engine live in
// session2.php so each session keeps its own test file.

foreach (require __DIR__ . '/session2.php' as $name => $test) {
    if (isset($tests[$name])) { throw new RuntimeException('Duplicate marketing test name: ' . $name); }
    $tests[$name] = $test;
}

// ------------------------------------------------------------- SESSION 3 - segments
// The segment DSL, live evaluation and the fail-closed send path live in
// session3.php for the same reason.

foreach (require __DIR__ . '/session3.php' as $name => $test) {
    if (isset($tests[$name])) { throw new RuntimeException('Duplicate marketing test name: ' . $name); }
    $tests[$name] = $test;
}

// ------------------------------------------------------------ SESSION 4 - templates
// The block builder, sanitizer and rendered-output fidelity live in session4.php.

foreach (require __DIR__ . '/session4.php' as $name => $test) {
    if (isset($tests[$name])) { throw new RuntimeException('Duplicate marketing test name: ' . $name); }
    $tests[$name] = $test;
}

// ------------------------------------------------------------ SESSION 5 - campaigns
// The campaign lifecycle, checklist and transport contract live in session5.php.

foreach (require __DIR__ . '/session5.php' as $name => $test) {
    if (isset($tests[$name])) { throw new RuntimeException('Duplicate marketing test name: ' . $name); }
    $tests[$name] = $test;
}

// ------------------------------------------------------------------------- run

$failed = 0;
foreach ($tests as $name => $test) {
    try {
        $ok = $test();
    } catch (\Throwable $e) {
        $ok = false;
        echo 'not ok - ' . $name . ': ' . $e->getMessage() . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ")\n";
        $failed++;
        continue;
    }
    if (!$ok) { echo 'not ok - ' . $name . "\n"; $failed++; }
    else { echo 'ok - ' . $name . "\n"; }
}
echo $failed === 0 ? "All marketing tests passed.\n" : $failed . " marketing test(s) failed.\n";
if ($failed > 0) { exit(1); }
