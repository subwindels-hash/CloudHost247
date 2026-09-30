<?php
/**
 * CloudHost247 Cart Recovery — behaviour suite.
 *
 * Pure PHP, no network, in-memory storage (see fakes.php); mirrors the
 * tests/marketing/run.php conventions. Run: php tests/cart_recovery/run.php
 */
define('WHMCS', 1);
error_reporting(E_ALL);

$root = dirname(dirname(__DIR__));
require $root . '/modules/addons/cloudhost247_cart_recovery/bootstrap.php';
require __DIR__ . '/fakes.php';

use CloudHost247\CartRecovery\AdminController;
use CloudHost247\CartRecovery\Analytics;
use CloudHost247\CartRecovery\CartSnapshot;
use CloudHost247\CartRecovery\EmailService;
use CloudHost247\CartRecovery\Lock;
use CloudHost247\CartRecovery\Log;
use CloudHost247\CartRecovery\MigrationRunner;
use CloudHost247\CartRecovery\RecoveryService;
use CloudHost247\CartRecovery\ReminderService;
use CloudHost247\CartRecovery\Schema;
use CloudHost247\CartRecovery\SettingsRepository;
use CloudHost247\CartRecovery\TokenService;
use WHMCS\Database\Capsule;

$tests = array();

/** Capture an authenticated cart and return the recovery row. */
function ch247_capture_authenticated($cart = null, $clientId = 42, $email = 'buyer@example.com')
{
    ch247_cart_client($clientId, $email);
    return RecoveryService::capture(array(
        'cart' => $cart === null ? ch247_cart_sample() : $cart,
        'client_id' => $clientId,
        'session_key' => hash('sha256', 'session-' . $clientId),
        'email' => $email,
        'first_name' => 'Ada',
        'last_name' => 'Ng',
        'currency' => 'NGN',
        'totals' => array('subtotal' => 54000.00, 'total' => 54000.00),
    ));
}

/** Drive a record all the way to "abandoned with reminder N due". */
function ch247_make_due($recoveryId, $reminderNumber = 1)
{
    ch247_cart_age($recoveryId, 7200);
    RecoveryService::markAbandoned(50);
    $delay = SettingsRepository::reminderDelay($reminderNumber);
    ch247_cart_age_abandonment($recoveryId, $delay + 60);
    return RecoveryService::find($recoveryId);
}

// ------------------------------------------------------------------ migrations

$tests['Migrations are versioned, idempotent and repeatable'] = function () {
    ch247_cart_fresh();
    if (MigrationRunner::pending() !== array()) { return false; }
    $applied = MigrationRunner::appliedVersions();
    if ($applied !== array(100, 101)) { return false; }
    // Running again must not re-apply or throw.
    if (MigrationRunner::migrate() !== array()) { return false; }
    foreach (array(Schema::RECOVERIES, Schema::REMINDER_LOGS, Schema::SUPPRESSIONS, Schema::SETTINGS) as $table) {
        if (!Capsule::schema()->hasTable($table)) { return false; }
    }
    return Capsule::schema()->hasColumn(Schema::RECOVERIES, 'unsubscribe_hash')
        && Capsule::schema()->hasColumn(Schema::REMINDER_LOGS, 'attempts');
};

$tests['Default settings match the documented defaults'] = function () {
    ch247_cart_fresh();
    $s = SettingsRepository::all();
    return $s['enabled'] === '1'
        && $s['abandonment_threshold'] === '3600'
        && $s['reminder_1_delay'] === '3600'
        && $s['reminder_2_delay'] === '86400'
        && $s['reminder_3_delay'] === '259200'
        && $s['maximum_reminders'] === '3'
        && $s['token_lifetime'] === '604800'
        && $s['guest_recovery'] === '1'
        && $s['unsubscribe'] === '1';
};

$tests['Settings are validated, clamped and never accept unknown keys'] = function () {
    ch247_cart_fresh();
    SettingsRepository::save(array(
        'abandonment_threshold' => '10',        // below the floor
        'maximum_reminders' => '99',            // above the ceiling
        'enabled' => '0',
        'evil_key' => 'dropped',
    ));
    $s = SettingsRepository::all();
    return $s['abandonment_threshold'] === '60'
        && $s['maximum_reminders'] === '3'
        && $s['enabled'] === '0'
        && !array_key_exists('evil_key', $s);
};

// ---------------------------------------------------------------- cart capture

$tests['Authenticated cart capture stores a sanitised snapshot'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    if (!$id) { return false; }
    $row = RecoveryService::find($id);
    if ($row->status !== Schema::STATUS_ACTIVE || (int) $row->client_id !== 42) { return false; }
    if ($row->email !== 'buyer@example.com' || $row->currency !== 'NGN') { return false; }
    if ((float) $row->cart_total !== 54000.00) { return false; }
    $json = $row->cart_snapshot;
    // No payment or credential data may survive the snapshot.
    foreach (array('4111111111111111', 'hunter2', '123456', 'sessiontoken', 'must-not-be-copied') as $forbidden) {
        if (strpos($json, $forbidden) !== false) { return false; }
    }
    $items = CartSnapshot::items($json);
    if (count($items) !== 2) { return false; }
    $restored = CartSnapshot::restore($json);
    return isset($restored['products'][0]['pid'])
        && (int) $restored['products'][0]['pid'] === 12
        && isset($restored['products'][0]['configoptions'])
        && !isset($restored['products'][0]['cvv'])
        && !isset($restored['sessiontoken']);
};

$tests['Refreshing the cart page updates one record instead of creating duplicates'] = function () {
    ch247_cart_fresh();
    $first = ch247_capture_authenticated();
    $second = ch247_capture_authenticated();
    $third = ch247_capture_authenticated();
    return $first === $second && $second === $third
        && (int) RecoveryService::table()->count() === 1;
};

$tests['A meaningful cart change resets the abandonment timer'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    ch247_cart_age($id, 7200);
    RecoveryService::markAbandoned(50);
    if (RecoveryService::find($id)->status !== Schema::STATUS_ABANDONED) { return false; }
    $cart = ch247_cart_sample();
    $cart['products'][0]['qty'] = 3;
    ch247_capture_authenticated($cart);
    $row = RecoveryService::find($id);
    return $row->status === Schema::STATUS_ACTIVE
        && $row->abandoned_at === null
        && $row->next_reminder_at === null;
};

$tests['Emptying the cart closes the recovery record and stops reminders'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    $result = ch247_capture_authenticated(array('products' => array(), 'domains' => array()));
    $row = RecoveryService::find($id);
    return $result === null
        && $row->status === Schema::STATUS_CLOSED
        && $row->next_reminder_at === null;
};

$tests['A new cart after a closed one starts a fresh lifecycle'] = function () {
    ch247_cart_fresh();
    $first = ch247_capture_authenticated();
    ch247_capture_authenticated(array('products' => array()));
    $second = ch247_capture_authenticated();
    return $second !== $first
        && (int) RecoveryService::table()->count() === 2
        && RecoveryService::find($second)->status === Schema::STATUS_ACTIVE;
};

$tests['Guest carts are only tracked once checkout supplies an email'] = function () {
    ch247_cart_fresh();
    $session = hash('sha256', 'guest-session');
    $anonymous = RecoveryService::capture(array('cart' => ch247_cart_sample(), 'client_id' => 0, 'session_key' => $session));
    if ($anonymous !== null || (int) RecoveryService::table()->count() !== 0) { return false; }
    $id = RecoveryService::attachEmail('guest@example.com', 0, $session, array('cart' => ch247_cart_sample(), 'first_name' => 'Guest'));
    if (!$id) { return false; }
    $row = RecoveryService::find($id);
    return $row->client_id === null && $row->email === 'guest@example.com' && $row->session_key === $session;
};

$tests['Guest recovery can be disabled by settings'] = function () {
    ch247_cart_fresh();
    SettingsRepository::save(array('guest_recovery' => '0'));
    $id = RecoveryService::attachEmail('guest@example.com', 0, hash('sha256', 'g2'), array('cart' => ch247_cart_sample()));
    return $id === null && (int) RecoveryService::table()->count() === 0;
};

$tests['Capture is skipped entirely when the addon is disabled'] = function () {
    ch247_cart_fresh();
    SettingsRepository::save(array('enabled' => '0'));
    return ch247_capture_authenticated() === null && (int) RecoveryService::table()->count() === 0;
};

// ----------------------------------------------------------------- abandonment

$tests['A cart below the threshold is not marked abandoned'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    ch247_cart_age($id, 600); // 10 minutes < 1 hour
    RecoveryService::markAbandoned(50);
    return RecoveryService::find($id)->status === Schema::STATUS_ACTIVE;
};

$tests['Reaching the threshold marks the cart abandoned and schedules reminder 1'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    ch247_cart_age($id, 7200);
    if (RecoveryService::markAbandoned(50) !== 1) { return false; }
    $row = RecoveryService::find($id);
    $expected = strtotime($row->abandoned_at) + 3600;
    return $row->status === Schema::STATUS_ABANDONED
        && abs(strtotime($row->next_reminder_at) - $expected) <= 2;
};

$tests['Disabled reminders are skipped when computing the schedule'] = function () {
    ch247_cart_fresh();
    SettingsRepository::save(array('enable_reminder_1' => '0'));
    $base = '2026-01-01 00:00:00';
    $next = RecoveryService::scheduleFor($base, 0);
    if ($next !== date('Y-m-d H:i:s', strtotime($base) + 86400)) { return false; }
    if (RecoveryService::nextReminderNumber(0) !== 2) { return false; }
    SettingsRepository::save(array('maximum_reminders' => '2'));
    return RecoveryService::scheduleFor($base, 2) === null && RecoveryService::nextReminderNumber(2) === 0;
};

// -------------------------------------------------------------------- reminders

$tests['Reminder 1 is sent, logged and schedules reminder 2'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    ch247_make_due($id, 1);
    $result = ReminderService::process();
    if ($result['sent'] !== 1) { return false; }
    $row = RecoveryService::find($id);
    if ((int) $row->last_reminder_number !== 1 || !$row->last_reminder_at) { return false; }
    $expected = strtotime($row->abandoned_at) + 86400;
    if (abs(strtotime($row->next_reminder_at) - $expected) > 2) { return false; }
    $log = Capsule::table(Schema::REMINDER_LOGS)->where('recovery_id', $id)->where('reminder_number', 1)->first();
    if (!$log || $log->status !== 'sent' || $log->template_name !== 'CloudHost247 Abandoned Cart Reminder 1') { return false; }
    $sent = $GLOBALS['CH247_MAIL_SENT'];
    return count($sent) === 1 && $sent[0]['client_id'] === 42 && $sent[0]['template'] === 'CloudHost247 Abandoned Cart Reminder 1';
};

$tests['Reminders 2 and 3 follow their configured delays, then the sequence stops'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    ch247_make_due($id, 1);
    ReminderService::process();
    ch247_cart_age_abandonment($id, 86400 + 60);
    RecoveryService::table()->where('id', $id)->update(array('next_reminder_at' => date('Y-m-d H:i:s', time() - 60)));
    ReminderService::process();
    if ((int) RecoveryService::find($id)->last_reminder_number !== 2) { return false; }
    ch247_cart_age_abandonment($id, 259200 + 60);
    RecoveryService::table()->where('id', $id)->update(array('next_reminder_at' => date('Y-m-d H:i:s', time() - 60)));
    ReminderService::process();
    $row = RecoveryService::find($id);
    if ((int) $row->last_reminder_number !== 3 || $row->next_reminder_at !== null) { return false; }
    // A fourth run must not send anything more.
    $before = count($GLOBALS['CH247_MAIL_SENT']);
    ReminderService::process();
    return count($GLOBALS['CH247_MAIL_SENT']) === $before && $before === 3;
};

$tests['Maximum reminders setting caps the sequence'] = function () {
    ch247_cart_fresh();
    SettingsRepository::save(array('maximum_reminders' => '1'));
    $id = ch247_capture_authenticated();
    ch247_make_due($id, 1);
    ReminderService::process();
    $row = RecoveryService::find($id);
    return (int) $row->last_reminder_number === 1
        && $row->next_reminder_at === null
        && count($GLOBALS['CH247_MAIL_SENT']) === 1;
};

$tests['A disabled reminder is never delivered'] = function () {
    ch247_cart_fresh();
    SettingsRepository::save(array('enable_reminder_1' => '0'));
    $id = ch247_capture_authenticated();
    ch247_cart_age($id, 7200);
    RecoveryService::markAbandoned(50);
    ch247_cart_age_abandonment($id, 86400 + 60);
    ReminderService::process();
    $sent = $GLOBALS['CH247_MAIL_SENT'];
    return count($sent) === 1 && $sent[0]['template'] === 'CloudHost247 Abandoned Cart Reminder 2'
        && (int) RecoveryService::find($id)->last_reminder_number === 2;
};

$tests['Duplicate/overlapping cron runs cannot send the same reminder twice'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    ch247_make_due($id, 1);
    ReminderService::process();
    ReminderService::process();
    ReminderService::process();
    $logs = Capsule::table(Schema::REMINDER_LOGS)->where('recovery_id', $id)->where('reminder_number', 1)->count();
    return count($GLOBALS['CH247_MAIL_SENT']) === 1 && $logs === 1;
};

$tests['The reminder log enforces one row per recovery and reminder number'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    $now = date('Y-m-d H:i:s');
    $row = array('recovery_id' => $id, 'reminder_number' => 1, 'email' => 'x@example.com',
        'template_name' => 't', 'status' => 'pending', 'attempts' => 0, 'created_at' => $now, 'updated_at' => $now);
    Capsule::table(Schema::REMINDER_LOGS)->insert($row);
    try {
        Capsule::table(Schema::REMINDER_LOGS)->insert($row);
        return false; // the unique key must reject this
    } catch (\Throwable $e) {
        return Capsule::table(Schema::REMINDER_LOGS)->where('recovery_id', $id)->count() === 1;
    }
};

$tests['A failed delivery is recorded, not marked sent, and retried later'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    ch247_make_due($id, 1);
    $GLOBALS['CH247_MAIL_FAIL'] = true;
    $result = ReminderService::process();
    if ($result['failed'] !== 1 || $result['sent'] !== 0) { return false; }
    $log = Capsule::table(Schema::REMINDER_LOGS)->where('recovery_id', $id)->first();
    if ($log->status !== 'failed' || !$log->failed_at || (int) $log->attempts !== 1) { return false; }
    if ($log->error_message === '' || $log->error_message === null) { return false; }
    $row = RecoveryService::find($id);
    if (strtotime($row->next_reminder_at) <= time()) { return false; } // controlled retry, not a tight loop
    if ((int) $row->last_reminder_number !== 0) { return false; }
    // An immediate re-run must not retry before the retry delay.
    ReminderService::process();
    if (count($GLOBALS['CH247_MAIL_SENT']) !== 0) { return false; }
    // Once the retry delay has passed and the transport recovers, it sends.
    $GLOBALS['CH247_MAIL_FAIL'] = false;
    $past = date('Y-m-d H:i:s', time() - 7200);
    Capsule::table(Schema::REMINDER_LOGS)->where('recovery_id', $id)->update(array('failed_at' => $past));
    RecoveryService::table()->where('id', $id)->update(array('next_reminder_at' => date('Y-m-d H:i:s', time() - 60)));
    ReminderService::process();
    $log = Capsule::table(Schema::REMINDER_LOGS)->where('recovery_id', $id)->first();
    return $log->status === 'sent' && (int) $log->attempts === 2 && count($GLOBALS['CH247_MAIL_SENT']) === 1;
};

$tests['Retries are bounded by the max_retries policy'] = function () {
    ch247_cart_fresh();
    SettingsRepository::save(array('max_retries' => '2', 'retry_delay' => '300'));
    $id = ch247_capture_authenticated();
    ch247_make_due($id, 1);
    $GLOBALS['CH247_MAIL_FAIL'] = true;
    for ($attempt = 0; $attempt < 5; $attempt++) {
        Capsule::table(Schema::REMINDER_LOGS)->where('recovery_id', $id)->update(array('failed_at' => date('Y-m-d H:i:s', time() - 7200)));
        RecoveryService::table()->where('id', $id)->update(array('next_reminder_at' => date('Y-m-d H:i:s', time() - 60)));
        ReminderService::process();
    }
    $log = Capsule::table(Schema::REMINDER_LOGS)->where('recovery_id', $id)->where('reminder_number', 1)->first();
    return (int) $log->attempts === 2 && $log->status === 'failed';
};

$tests['Suppressed recipients never receive a reminder'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    ch247_make_due($id, 1);
    RecoveryService::suppress('buyer@example.com', 0, 'unsubscribe');
    $result = ReminderService::process();
    return $result['sent'] === 0
        && count($GLOBALS['CH247_MAIL_SENT']) === 0
        && RecoveryService::find($id)->status === Schema::STATUS_UNSUBSCRIBED;
};

$tests['An expired token stops reminders and expires the record'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    ch247_make_due($id, 1);
    RecoveryService::table()->where('id', $id)->update(array('token_expires_at' => date('Y-m-d H:i:s', time() - 60)));
    $result = ReminderService::process();
    return $result['sent'] === 0
        && count($GLOBALS['CH247_MAIL_SENT']) === 0
        && RecoveryService::find($id)->status === Schema::STATUS_EXPIRED;
};

$tests['An emptied cart discovered by cron is closed instead of reminded'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    ch247_make_due($id, 1);
    RecoveryService::table()->where('id', $id)->update(array('cart_snapshot' => CartSnapshot::encode(CartSnapshot::capture(array()))));
    ReminderService::process();
    return count($GLOBALS['CH247_MAIL_SENT']) === 0
        && RecoveryService::find($id)->status === Schema::STATUS_CLOSED;
};

$tests['Cron batching never processes more than the configured batch size'] = function () {
    ch247_cart_fresh();
    SettingsRepository::save(array('batch_size' => '2'));
    for ($client = 1; $client <= 5; $client++) {
        $id = ch247_capture_authenticated(null, $client, 'buyer' . $client . '@example.com');
        ch247_make_due($id, 1);
    }
    $result = ReminderService::process();
    return $result['processed'] === 2 && $result['sent'] === 2;
};

$tests['The cron lock prevents concurrent workers'] = function () {
    ch247_cart_fresh();
    if (!Lock::acquire('cron')) { return false; }
    if (Lock::acquire('cron')) { return false; }  // second worker is refused
    if (!Lock::release('cron')) { return false; }
    return Lock::acquire('cron');
};

// -------------------------------------------------------------------- recovery

$tests['Token entropy, hashing and storage rules hold'] = function () {
    ch247_cart_fresh();
    $a = TokenService::generate();
    $b = TokenService::generate();
    if ($a === $b || strlen($a) !== 64 || !TokenService::valid($a)) { return false; }
    if (TokenService::valid('nope') || TokenService::valid(str_repeat('z', 64))) { return false; }
    if (TokenService::hash($a) === $a || strlen(TokenService::hash($a)) !== 64) { return false; }
    if (TokenService::unsubscribeToken($a) === $a || TokenService::unsubscribeToken($a) === TokenService::hash($a)) { return false; }
    $id = ch247_capture_authenticated();
    $row = RecoveryService::find($id);
    // The raw token is never stored in a lookup column.
    return $row->token_hash !== null && strlen($row->token_hash) === 64
        && $row->unsubscribe_hash !== null
        && TokenService::valid(TokenService::open($row->token_ciphertext))
        && TokenService::hash(TokenService::open($row->token_ciphertext)) === $row->token_hash;
};

$tests['A valid token restores the cart and marks the record recovered'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    ch247_make_due($id, 1);
    ReminderService::process();
    $raw = TokenService::open(RecoveryService::find($id)->token_ciphertext);
    $session = array('uid' => 0);
    $result = RecoveryService::recover($raw, $session);
    if (!$result['ok'] || $result['reason'] !== 'recovered') { return false; }
    if (!isset($session['cart']['products'][0]['pid']) || (int) $session['cart']['products'][0]['pid'] !== 12) { return false; }
    // Restoration must not touch identity or leak secrets into the session.
    if ($session['uid'] !== 0 || isset($session['cart']['sessiontoken'])) { return false; }
    $row = RecoveryService::find($id);
    return $row->status === Schema::STATUS_RECOVERED && $row->recovered_at && $row->next_reminder_at === null;
};

$tests['Invalid, unknown and expired tokens fail safely without restoring a cart'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    $session = array();
    if (RecoveryService::recover('not-a-token', $session)['reason'] !== 'invalid_token') { return false; }
    if (RecoveryService::recover(str_repeat('a', 64), $session)['reason'] !== 'invalid_token') { return false; }
    if (isset($session['cart'])) { return false; }
    $raw = TokenService::open(RecoveryService::find($id)->token_ciphertext);
    RecoveryService::table()->where('id', $id)->update(array('token_expires_at' => date('Y-m-d H:i:s', time() - 5)));
    $result = RecoveryService::recover($raw, $session);
    return !$result['ok'] && $result['reason'] === 'expired'
        && !isset($session['cart'])
        && RecoveryService::find($id)->status === Schema::STATUS_EXPIRED;
};

$tests['A converted cart cannot be re-opened with its old recovery link'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    $raw = TokenService::open(RecoveryService::find($id)->token_ciphertext);
    RecoveryService::convert($id, 9001, 95000.00, 'NGN');
    $session = array();
    $result = RecoveryService::recover($raw, $session);
    return !$result['ok'] && $result['reason'] === 'already_converted' && !isset($session['cart']);
};

$tests['One customer token can never restore another customer cart'] = function () {
    ch247_cart_fresh();
    $mine = ch247_capture_authenticated(null, 1, 'one@example.com');
    $cartB = ch247_cart_sample();
    $cartB['products'][0]['pid'] = 99;
    $cartB['products'][0]['productname'] = 'Someone Else Plan';
    RecoveryService::capture(array('cart' => $cartB, 'client_id' => 2, 'session_key' => hash('sha256', 'b'), 'email' => 'two@example.com'));
    $raw = TokenService::open(RecoveryService::find($mine)->token_ciphertext);
    $session = array();
    RecoveryService::recover($raw, $session);
    return (int) $session['cart']['products'][0]['pid'] === 12
        && strpos(json_encode($session['cart']), 'Someone Else Plan') === false;
};

// ------------------------------------------------------------------ unsubscribe

$tests['Unsubscribe uses a distinct token that cannot restore a cart'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    $raw = TokenService::open(RecoveryService::find($id)->token_ciphertext);
    $unsub = TokenService::unsubscribeToken($raw);
    $session = array();
    // The unsubscribe token must be useless as a recovery credential.
    if (RecoveryService::recover($unsub, $session)['ok']) { return false; }
    if (isset($session['cart'])) { return false; }
    $result = RecoveryService::unsubscribe($unsub);
    if (!$result['ok']) { return false; }
    $row = RecoveryService::find($id);
    return $row->status === Schema::STATUS_UNSUBSCRIBED
        && $row->unsubscribed_at
        && RecoveryService::isSuppressed('buyer@example.com', 42);
};

$tests['An invalid unsubscribe token is rejected and changes nothing'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    $result = RecoveryService::unsubscribe(str_repeat('c', 64));
    return !$result['ok']
        && RecoveryService::find($id)->status === Schema::STATUS_ACTIVE
        && (int) Capsule::table(Schema::SUPPRESSIONS)->count() === 0;
};

$tests['Unsubscribing suppresses future carts for the same customer'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    $raw = TokenService::open(RecoveryService::find($id)->token_ciphertext);
    RecoveryService::unsubscribe(TokenService::unsubscribeToken($raw));
    $again = ch247_capture_authenticated();
    return $again === null && (int) RecoveryService::table()->where('status', Schema::STATUS_ACTIVE)->count() === 0;
};

// ------------------------------------------------------------------ conversion

$tests['Checkout conversion stops reminders and stores the authoritative revenue'] = function () {
    ch247_cart_fresh();
    // Authoritative WHMCS records: the order/invoice total differs from the cart snapshot.
    Capsule::table('tblorders')->insert(array('id' => 500, 'userid' => 42, 'invoiceid' => 700, 'amount' => 52000.00));
    Capsule::table('tblinvoices')->insert(array('id' => 700, 'total' => 51000.00, 'currency' => 3));
    Capsule::table('tblcurrencies')->insert(array('id' => 3, 'code' => 'NGN'));
    $id = ch247_capture_authenticated();
    ch247_make_due($id, 1);
    if (!RecoveryService::convertForCheckout(42, hash('sha256', 'session-42'), 500, 700)) { return false; }
    $row = RecoveryService::find($id);
    if ($row->status !== Schema::STATUS_CONVERTED || (int) $row->order_id !== 500) { return false; }
    if ((float) $row->recovered_revenue !== 51000.00) { return false; } // invoice total, not cart_total
    if ((float) $row->cart_total === (float) $row->recovered_revenue) { return false; }
    $result = ReminderService::process();
    return $result['sent'] === 0 && count($GLOBALS['CH247_MAIL_SENT']) === 0 && $row->next_reminder_at === null;
};

$tests['Conversion never guesses: an unmatched checkout converts nothing'] = function () {
    ch247_cart_fresh();
    ch247_capture_authenticated(null, 42);
    $converted = RecoveryService::convertForCheckout(0, '', 0, 0);
    return $converted === false
        && (int) RecoveryService::table()->where('status', Schema::STATUS_CONVERTED)->count() === 0;
};

$tests['A recovered cart that converts is counted once as converted'] = function () {
    ch247_cart_fresh();
    Capsule::table('tblorders')->insert(array('id' => 11, 'userid' => 42, 'invoiceid' => 0, 'amount' => 30000.00));
    $id = ch247_capture_authenticated();
    $raw = TokenService::open(RecoveryService::find($id)->token_ciphertext);
    $session = array();
    RecoveryService::recover($raw, $session);
    RecoveryService::convertForCheckout(42, hash('sha256', 'session-42'), 11, 0);
    $stats = Analytics::summary();
    return $stats['converted'] === 1 && $stats['recovered'] === 0 && (float) $stats['recovered_revenue'] === 30000.00;
};

// --------------------------------------------------------------------- emails

$tests['Email templates are created once and never overwritten'] = function () {
    ch247_cart_fresh();
    if (EmailService::ensureTemplates() !== 3) { return false; }
    Capsule::table('tblemailtemplates')->where('name', 'CloudHost247 Abandoned Cart Reminder 1')
        ->update(array('subject' => 'Admin edited subject'));
    if (EmailService::ensureTemplates() !== 0) { return false; }
    $row = Capsule::table('tblemailtemplates')->where('name', 'CloudHost247 Abandoned Cart Reminder 1')->first();
    return $row->subject === 'Admin edited subject'
        && (int) Capsule::table('tblemailtemplates')->count() === 3
        && $row->type === 'general';
};

$tests['Merge variables carry the documented names and safe values'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    $record = RecoveryService::find($id);
    $raw = TokenService::open($record->token_ciphertext);
    $vars = EmailService::mergeVariables($record, $raw);
    $required = array('customer_name', 'customer_first_name', 'customer_email', 'cart_items', 'cart_total',
        'cart_currency', 'recovery_url', 'recovery_expires', 'unsubscribe_url', 'company_name', 'company_domain');
    foreach ($required as $key) {
        if (!array_key_exists($key, $vars)) { return false; }
    }
    if (strpos($vars['recovery_url'], $raw) === false) { return false; }
    // The unsubscribe URL must not embed the recovery token.
    if (strpos($vars['unsubscribe_url'], $raw) !== false) { return false; }
    return strpos($vars['cart_items'], 'CloudHost247 Business Hosting') !== false
        && strpos($vars['cart_items'], '4111111111111111') === false;
};

$tests['Cart item HTML is escaped so a product name cannot inject markup'] = function () {
    ch247_cart_fresh();
    $cart = ch247_cart_sample();
    $cart['products'][0]['productname'] = '<script>alert(1)</script>';
    $id = ch247_capture_authenticated($cart);
    $html = EmailService::itemsHtml(RecoveryService::find($id)->cart_snapshot);
    return strpos($html, '<script>') === false && strpos($html, '&lt;script&gt;') !== false;
};

$tests['Guest reminders are delivered through the WHMCS mailer, not a new SMTP stack'] = function () {
    ch247_cart_fresh();
    $id = RecoveryService::attachEmail('guest@example.com', 0, hash('sha256', 'guest'), array('cart' => ch247_cart_sample(), 'first_name' => 'Gina'));
    ch247_make_due($id, 1);
    $result = ReminderService::process();
    if ($result['sent'] !== 1) { return false; }
    $sent = $GLOBALS['CH247_MAIL_SENT'][0];
    return $sent['transport'] === 'whmcs-mail'
        && $sent['to'] === 'guest@example.com'
        && strpos($sent['body'], 'Recover My Cart') !== false
        && strpos($sent['body'], '{$recovery_url}') === false;
};

$tests['Default email copy makes no false reservation or price guarantee'] = function () {
    $copy = strtolower(EmailService::defaultBody(1) . ' ' . EmailService::defaultBody(2) . ' ' . EmailService::defaultBody(3));
    foreach (array('reserved for you', 'price is guaranteed', 'your order has been placed', 'guaranteed price', 'act now') as $claim) {
        if (strpos($copy, $claim) !== false) { return false; }
    }
    return strpos($copy, 'nothing has been ordered yet') !== false
        && strpos($copy, 'not reserved') !== false
        && strpos($copy, 'unsubscribe_url') !== false;
};

// ---------------------------------------------------------------------- admin

$tests['Admin dashboard reports zeroes on an empty installation'] = function () {
    ch247_cart_fresh();
    $stats = Analytics::summary();
    foreach (array('abandoned', 'active', 'recovered', 'converted', 'expired', 'unsubscribed', 'reminders_sent') as $key) {
        if ($stats[$key] !== 0) { return false; }
    }
    return $stats['recovery_rate'] === 0.0 && $stats['recovered_revenue'] === 0.0;
};

$tests['Recovery rate uses the documented definition'] = function () {
    ch247_cart_fresh();
    // 4 eligible carts: 1 recovered, 1 converted, 1 abandoned, 1 expired => 50%.
    $ids = array();
    for ($client = 1; $client <= 4; $client++) {
        $ids[] = ch247_capture_authenticated(null, $client, 'c' . $client . '@example.com');
    }
    RecoveryService::table()->where('id', $ids[0])->update(array('status' => Schema::STATUS_RECOVERED));
    RecoveryService::table()->where('id', $ids[1])->update(array('status' => Schema::STATUS_CONVERTED));
    RecoveryService::table()->where('id', $ids[2])->update(array('status' => Schema::STATUS_ABANDONED));
    RecoveryService::table()->where('id', $ids[3])->update(array('status' => Schema::STATUS_EXPIRED));
    $stats = Analytics::summary();
    return $stats['eligible'] === 4 && $stats['recovery_rate'] === 50.0 && $stats['conversion_rate'] === 25.0;
};

$tests['Admin list filters by status and searches customer, email and order'] = function () {
    ch247_cart_fresh();
    $a = ch247_capture_authenticated(null, 1, 'ada@example.com');
    $b = ch247_capture_authenticated(null, 2, 'grace@example.com');
    RecoveryService::table()->where('id', $b)->update(array('status' => Schema::STATUS_CONVERTED, 'order_id' => 777, 'first_name' => 'Grace'));
    if (count(Analytics::records(Schema::STATUS_CONVERTED)['rows']) !== 1) { return false; }
    if (count(Analytics::records('', 'grace@example.com')['rows']) !== 1) { return false; }
    if (count(Analytics::records('', '777')['rows']) !== 1) { return false; }
    if (count(Analytics::records('', 'Grace')['rows']) !== 1) { return false; }
    return count(Analytics::records()['rows']) === 2 && count(Analytics::records('', 'nobody@example.com')['rows']) === 0;
};

$tests['Reminder history shows sent entries and the schedule for pending ones'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    ch247_make_due($id, 1);
    ReminderService::process();
    $history = AdminController::historyView(RecoveryService::find($id));
    if (count($history) !== 3) { return false; }
    if ($history[0]['status'] !== 'sent' || $history[0]['sent_at'] === '') { return false; }
    return $history[1]['status'] === 'pending' && $history[1]['scheduled'] !== ''
        && $history[2]['status'] === 'pending';
};

$tests['Admin POST actions require a valid CSRF token'] = function () {
    ch247_cart_fresh();
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_REQUEST['token'] = 'wrong-token';
    $view = AdminController::handle(array('modulelink' => 'addonmodules.php?module=x'), array('action' => 'save_settings', 'enabled' => '0'), array());
    $_SERVER['REQUEST_METHOD'] = 'GET';
    return $view['errors'] && strpos($view['errors'][0], 'Security token') !== false
        && SettingsRepository::get('enabled') === '1';
};

$tests['Admin screen refuses unauthorised administrators'] = function () {
    ch247_cart_fresh();
    $GLOBALS['CH247_ADMIN_DENIED'] = true;
    $view = AdminController::handle(array('modulelink' => 'addonmodules.php?module=x'), array(), array());
    $GLOBALS['CH247_ADMIN_DENIED'] = false;
    return $view['authorised'] === false && !isset($view['stats']);
};

$tests['Manual processing and manual actions respect the same state rules'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    ch247_make_due($id, 1);
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_REQUEST['token'] = str_repeat('ab', 16);
    $link = 'addonmodules.php?module=cloudhost247_cart_recovery';
    AdminController::handle(array('modulelink' => $link), array('action' => 'process_due'), array());
    if (count($GLOBALS['CH247_MAIL_SENT']) !== 1) { return false; }
    // A manual "send reminder" immediately afterwards must not duplicate it.
    AdminController::handle(array('modulelink' => $link), array('action' => 'send_reminder', 'recovery_id' => $id), array());
    if (count($GLOBALS['CH247_MAIL_SENT']) !== 1) { return false; }
    AdminController::handle(array('modulelink' => $link), array('action' => 'cancel_recovery', 'recovery_id' => $id), array());
    $_SERVER['REQUEST_METHOD'] = 'GET';
    return RecoveryService::find($id)->status === Schema::STATUS_CLOSED;
};

$tests['Admin retry of a failed reminder never re-sends a delivered one'] = function () {
    ch247_cart_fresh();
    $id = ch247_capture_authenticated();
    ch247_make_due($id, 1);
    ReminderService::process();
    if (ReminderService::retry($id, 1) !== 'skipped') { return false; }
    return count($GLOBALS['CH247_MAIL_SENT']) === 1;
};

// ------------------------------------------------------------------- security

$tests['Search input is parameterised and cannot inject SQL wildcards or syntax'] = function () {
    ch247_cart_fresh();
    ch247_capture_authenticated(null, 1, 'ada@example.com');
    $result = Analytics::records('', "' OR 1=1 --");
    $wildcard = Analytics::records('', '%');
    return count($result['rows']) === 0 && count($wildcard['rows']) === 0;
};

$tests['Log context is scrubbed of anything credential-like'] = function () {
    $safe = Log::scrub(array(
        'recovery_id' => 5,
        'token' => 'abc123',
        'password' => 'hunter2',
        'api_key' => 'k',
        'nested' => array('cvv' => '123', 'count' => 2),
    ));
    return $safe['recovery_id'] === 5
        && $safe['token'] === '[redacted]'
        && $safe['password'] === '[redacted]'
        && $safe['api_key'] === '[redacted]'
        && $safe['nested']['cvv'] === '[redacted]'
        && $safe['nested']['count'] === 2;
};

$tests['Persisted error text drops long credential-like strings'] = function () {
    $message = Log::safeError(new \RuntimeException('failed with secret ' . str_repeat('a', 40)));
    return strpos($message, str_repeat('a', 40)) === false
        && strpos($message, '[redacted]') !== false
        && strlen($message) <= 500;
};

$tests['The snapshot never persists payment or credential fields'] = function () {
    ch247_cart_fresh();
    $cart = ch247_cart_sample();
    $cart['products'][0]['ccnumber'] = '5555444433332222';
    $cart['products'][0]['gatewaysecret'] = 'sk_live_x';
    $cart['authtoken'] = 'abc';
    $json = CartSnapshot::encode(CartSnapshot::capture($cart, 'NGN'));
    foreach (array('5555444433332222', 'sk_live_x', 'abc', 'hunter2', '4111111111111111') as $forbidden) {
        if (strpos($json, $forbidden) !== false) { return false; }
    }
    return true;
};

$tests['Fingerprints are stable for equal carts and differ for changed ones'] = function () {
    $a = ch247_cart_sample();
    $b = ch247_cart_sample();
    if (CartSnapshot::fingerprint($a) !== CartSnapshot::fingerprint($b)) { return false; }
    $b['products'][0]['qty'] = 5;
    return CartSnapshot::fingerprint($a) !== CartSnapshot::fingerprint($b);
};

// ---------------------------------------------------------------------- hooks

require_once $root . '/modules/addons/cloudhost247_cart_recovery/hooks.php';

$tests['ClientAreaPageCart hook captures the live WHMCS session cart'] = function () {
    ch247_cart_fresh();
    ch247_cart_client(42, 'buyer@example.com');
    $_SESSION['uid'] = 42;
    $_SESSION['cart'] = ch247_cart_sample();
    $_SESSION['currency'] = 'NGN';
    cloudhost247_cart_recovery_page_cart(array('total' => 'NGN54,000.00'));
    $row = RecoveryService::table()->first();
    if (!$row || (int) $row->client_id !== 42) { return false; }
    // A second identical page view must not write a second record.
    cloudhost247_cart_recovery_page_cart(array());
    return (int) RecoveryService::table()->count() === 1 && $row->email === 'buyer@example.com';
};

$tests['ShoppingCartValidateCheckout captures the guest email and returns no errors'] = function () {
    ch247_cart_fresh();
    $_SESSION['cart'] = ch247_cart_sample();
    $errors = cloudhost247_cart_recovery_validate_checkout(array('email' => 'guest@example.com', 'firstname' => 'Gina', 'lastname' => 'O'));
    if ($errors !== array()) { return false; }
    $row = RecoveryService::table()->first();
    return $row && $row->email === 'guest@example.com' && $row->client_id === null;
};

$tests['AfterShoppingCartCheckout converts the cart and clears the session marker'] = function () {
    ch247_cart_fresh();
    Capsule::table('tblorders')->insert(array('id' => 88, 'userid' => 42, 'invoiceid' => 0, 'amount' => 41000.00));
    ch247_cart_client(42, 'buyer@example.com');
    $_SESSION['uid'] = 42;
    $_SESSION['cart'] = ch247_cart_sample();
    cloudhost247_cart_recovery_page_cart(array());
    cloudhost247_cart_recovery_after_checkout(array('UserID' => 42, 'OrderID' => 88));
    $row = RecoveryService::table()->first();
    return $row->status === Schema::STATUS_CONVERTED
        && (int) $row->order_id === 88
        && (float) $row->recovered_revenue === 41000.00
        && !isset($_SESSION['ch247_cart_recovery_fp']);
};

$tests['OrderPaid is a safe secondary conversion path and never double-counts'] = function () {
    ch247_cart_fresh();
    Capsule::table('tblorders')->insert(array('id' => 91, 'userid' => 42, 'invoiceid' => 0, 'amount' => 25000.00));
    ch247_cart_client(42, 'buyer@example.com');
    ch247_capture_authenticated();
    cloudhost247_cart_recovery_order_paid(array('orderId' => 91));
    $converted = (int) RecoveryService::table()->where('status', Schema::STATUS_CONVERTED)->count();
    cloudhost247_cart_recovery_order_paid(array('orderId' => 91));
    return $converted === 1
        && (int) RecoveryService::table()->where('status', Schema::STATUS_CONVERTED)->count() === 1;
};

$tests['Hook failures are swallowed so the cart and checkout keep working'] = function () {
    ch247_cart_fresh();
    $_SESSION['cart'] = 'not-an-array';
    $_SESSION['uid'] = 'bogus';
    cloudhost247_cart_recovery_page_cart('not-an-array-either');
    $errors = cloudhost247_cart_recovery_validate_checkout(array('email' => array('nested')));
    cloudhost247_cart_recovery_after_checkout(array());
    cloudhost247_cart_recovery_order_paid(array('orderId' => 'x'));
    return $errors === array() && (int) RecoveryService::table()->count() === 0;
};

// ------------------------------------------------------------------------- run

$failed = 0;
foreach ($tests as $name => $test) {
    try {
        $ok = $test();
    } catch (\Throwable $e) {
        echo 'not ok - ' . $name . ': ' . $e->getMessage() . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ")\n";
        $failed++;
        continue;
    }
    if (!$ok) {
        echo 'not ok - ' . $name . "\n";
        $failed++;
    } else {
        echo 'ok - ' . $name . "\n";
    }
}
echo $failed === 0 ? "All cart recovery tests passed.\n" : $failed . " cart recovery test(s) failed.\n";
if ($failed > 0) {
    exit(1);
}
