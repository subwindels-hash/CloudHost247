<?php
/**
 * CloudHost247 Marketing — SESSION 2 behavior suite.
 *
 * Subscribers, lists, tags, import/export and the suppression engine. Pure PHP,
 * no network, in-memory fakes (fakes.php); every test calls the real module
 * classes. Run: php tests/marketing/run.php
 */

use CloudHost247\Marketing\Domain\ConsentStatus;
use CloudHost247\Marketing\Domain\SubscriberSource;
use CloudHost247\Marketing\Domain\SubscriberStatus;
use CloudHost247\Marketing\Domain\SuppressionReason;
use CloudHost247\Marketing\Http\AdminController;
use CloudHost247\Marketing\Repositories\ListRepository;
use CloudHost247\Marketing\Repositories\SubscriberRepository;
use CloudHost247\Marketing\Repositories\SuppressionRepository;
use CloudHost247\Marketing\Repositories\TagRepository;
use CloudHost247\Marketing\Services\ExportService;
use CloudHost247\Marketing\Services\ImportService;
use CloudHost247\Marketing\Services\SubscriptionService;

/** Boots the module tables and an authenticated administrator for one test. */
function ch247_marketing_admin()
{
    ch247_marketing_fresh();
    cloudhost247_marketing_activate();
    $_SESSION['adminid'] = 1;
    $_SESSION['adminroleid'] = 1;
    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET = array();
    $_POST = array();
    $_REQUEST = array();
    return new SubscriptionService();
}

function ch247_marketing_post($view, array $post, array $get = array())
{
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_GET = array_merge(array('view' => $view), $get);
    $_POST = array_merge(array('token' => str_repeat('ab', 16)), $post);
    $_REQUEST = $_POST;
    return (new AdminController())->handle();
}

function ch247_marketing_audit_actions()
{
    $actions = array();
    foreach (CH247MarketingFakeDB::rowsRef('mod_cloudhost247_audit_events') as $row) {
        $actions[] = $row['action'];
    }
    return $actions;
}

return array(

// ------------------------------------------------------------------ migration

'1.1.0 adds only the two tag tables and re-activation stays a no-op' => function () {
    ch247_marketing_admin();
    foreach (array('mod_cloudhost247_marketing_tags', 'mod_cloudhost247_marketing_subscriber_tags') as $table) {
        if (empty(CH247MarketingFakeSchema::$created[$table])) { return false; }
    }
    $before = count(CH247MarketingFakeSchema::$created);
    $beforeRows = count(CH247MarketingFakeDB::rowsRef('mod_cloudhost247_marketing_settings'));
    $again = cloudhost247_marketing_activate();
    return $again['status'] === 'success'
        && count(CH247MarketingFakeSchema::$created) === $before
        && count(CH247MarketingFakeDB::rowsRef('mod_cloudhost247_marketing_settings')) === $beforeRows;
},

// ----------------------------------------------------------------- subscribe

'A new subscriber records consent exactly as given and can join lists and tags' => function () {
    $service = ch247_marketing_admin();
    $lists = new ListRepository();
    $list = $lists->create('newsletter', 'Newsletter', 'Opt-in newsletter');

    $result = $service->subscribe(array(
        'email' => 'Alice@Example.COM',
        'first_name' => 'Alice',
        'last_name' => 'Example',
        'company' => 'Example Ltd',
        'country' => 'ng',
        'list_ids' => array((int) $list->id),
        'tags' => array('vip', '2026-q4'),
        'consent_status' => ConsentStatus::GRANTED,
        'consent_source' => 'signup form',
    ));
    if (!$result['ok'] || !$result['created'] || $result['lists_added'] !== 1 || $result['tags_added'] !== 2) { return false; }

    $stored = (new SubscriberRepository())->findByEmail('alice@example.com');
    if (!$stored || $stored->email !== 'alice@example.com') { return false; }   // lower-cased
    if ($stored->status !== SubscriberStatus::SUBSCRIBED) { return false; }
    if ($stored->consent_status !== ConsentStatus::GRANTED || $stored->consent_source !== 'signup form') { return false; }
    if ($stored->country !== 'NG') { return false; }
    if ((new TagRepository())->forSubscriber((int) $stored->id) === array()) { return false; }
    if (count($lists->idsForSubscriber((int) $stored->id)) !== 1) { return false; }

    // Consent is never invented: an address added without evidence stays unknown.
    $silent = $service->subscribe(array('email' => 'silent@example.com'));
    $silentRow = (new SubscriberRepository())->findByEmail('silent@example.com');
    if ($silentRow->consent_status !== ConsentStatus::UNKNOWN || $silentRow->consent_at !== null) { return false; }

    return in_array('subscriber.created', ch247_marketing_audit_actions(), true);
},

'A suppressed address is refused by subscribe() and the refusal is audited' => function () {
    $service = ch247_marketing_admin();
    $service->suppress('blocked@example.com', SuppressionReason::SPAM_COMPLAINT, 'provider complaint');

    $result = $service->subscribe(array('email' => 'blocked@example.com'));
    if ($result['ok'] || $result['reason'] !== 'suppressed') { return false; }
    if ($result['suppression_reason'] !== SuppressionReason::SPAM_COMPLAINT) { return false; }
    if ((new SubscriberRepository())->findByEmail('blocked@example.com') !== null) { return false; } // never created
    $events = CH247MarketingFakeDB::rowsRef('mod_cloudhost247_audit_events');
    $denied = false;
    foreach ($events as $event) {
        if ($event['action'] === 'subscriber.subscribe_refused' && $event['result'] === 'denied') { $denied = true; }
    }
    return $denied;
},

'Unsubscribe is idempotent, records revocation and blocks every future send' => function () {
    $service = ch247_marketing_admin();
    $service->subscribe(array('email' => 'leave@example.com', 'consent_status' => ConsentStatus::GRANTED, 'consent_source' => 'form'));
    if (!$service->checkSendable('leave@example.com')['sendable']) { return false; }

    $first = $service->unsubscribe('leave@example.com');
    $second = $service->unsubscribe('leave@example.com');
    if (!$first['ok'] || !$first['changed']) { return false; }
    if (!$second['ok'] || $second['suppression_created']) { return false; }   // no duplicate suppression row

    if (count(CH247MarketingFakeDB::rowsRef('mod_cloudhost247_marketing_suppressions')) !== 1) { return false; }
    $row = (new SubscriberRepository())->findByEmail('leave@example.com');
    if ($row->status !== SubscriberStatus::UNSUBSCRIBED || $row->consent_status !== ConsentStatus::REVOKED) { return false; }
    $sendable = $service->checkSendable('leave@example.com');
    if ($sendable['sendable'] || $sendable['reason'] !== 'suppressed') { return false; }

    // An address with no subscriber row still gets suppressed: links must work.
    $unknown = $service->unsubscribe('never-seen@example.com');
    return $unknown['ok'] && (new SuppressionRepository())->isSuppressed('never-seen@example.com');
},

'Soft bounces accumulate, hard bounces and crossed thresholds suppress immediately' => function () {
    $service = ch247_marketing_admin();
    $service->subscribe(array('email' => 'soft@example.com'));
    $service->subscribe(array('email' => 'hard@example.com'));

    $one = $service->recordBounce('soft@example.com', 'soft', 3);
    $two = $service->recordBounce('soft@example.com', 'soft', 3);
    if ($one['suppressed'] || $two['suppressed']) { return false; }            // mailbox-full is not death
    if ((new SubscriberRepository())->findByEmail('soft@example.com')->status !== SubscriberStatus::SUBSCRIBED) { return false; }
    $three = $service->recordBounce('soft@example.com', 'soft', 3);
    if (!$three['suppressed']) { return false; }
    if (!(new SuppressionRepository())->isSuppressed('soft@example.com')) { return false; }
    if ((new SubscriberRepository())->findByEmail('soft@example.com')->status !== SubscriberStatus::BOUNCED) { return false; }

    $hard = $service->recordBounce('hard@example.com', 'hard', 3);
    return $hard['suppressed'] && $hard['count'] === 1
        && (new SuppressionRepository())->findByEmail('hard@example.com')->reason === SuppressionReason::HARD_BOUNCE;
},

'Releasing a suppression is explicit, two-step and refuses to weaken a complaint silently' => function () {
    $service = ch247_marketing_admin();
    $service->subscribe(array('email' => 'complaint@example.com'));
    $service->suppress('complaint@example.com', SuppressionReason::SPAM_COMPLAINT, 'reported by recipient');

    // Restoring refuses while the suppression exists.
    if ($service->resubscribe('complaint@example.com')['reason'] !== 'suppressed') { return false; }

    // A protected reason cannot be released without explicit confirmation.
    $blocked = false;
    try { $service->releaseSuppression('complaint@example.com'); } catch (RuntimeException $e) { $blocked = true; }
    if (!$blocked) { return false; }
    if (!(new SuppressionRepository())->isSuppressed('complaint@example.com')) { return false; }

    if (!$service->releaseSuppression('complaint@example.com', true)) { return false; }
    $restored = $service->resubscribe('complaint@example.com', 'admin ticket #4821');
    if (!$restored['ok'] || $restored['subscriber']->status !== SubscriberStatus::SUBSCRIBED) { return false; }
    $actions = ch247_marketing_audit_actions();
    return in_array('suppression.released', $actions, true) && in_array('subscriber.resubscribed', $actions, true);
},

// --------------------------------------------------------------------- lists

'Lists are keyed, duplicate keys are refused, membership is idempotent and archivable' => function () {
    ch247_marketing_admin();
    $lists = new ListRepository();
    $subscribers = new SubscriberRepository();
    $service = new SubscriptionService();

    $list = $lists->create('Newsletter', 'Newsletter');
    if ($list->list_key !== 'newsletter') { return false; }
    try { $lists->create('newsletter', 'Another'); return false; } catch (InvalidArgumentException $e) {}

    $service->subscribe(array('email' => 'a@example.com'));
    $service->subscribe(array('email' => 'b@example.com'));
    $a = $subscribers->findByEmail('a@example.com');
    $b = $subscribers->findByEmail('b@example.com');

    if ($lists->addMembers((int) $list->id, array((int) $a->id, (int) $b->id, (int) $a->id)) !== 2) { return false; }
    if ($lists->addMembers((int) $list->id, array((int) $a->id)) !== 0) { return false; }   // idempotent
    if ($lists->memberCount((int) $list->id) !== 2) { return false; }
    if (count($lists->forSubscriber((int) $a->id)) !== 1) { return false; }
    if ($lists->removeMember((int) $list->id, (int) $a->id) !== 1) { return false; }
    if ($lists->memberCount((int) $list->id) !== 1) { return false; }

    $archived = $lists->archive((int) $list->id);
    if ($archived->status !== 'archived') { return false; }
    // Archiving keeps the membership rows: a sent campaign's audience is history.
    return $lists->memberCount((int) $list->id) === 1 && count($lists->all('active')) === 0;
},

'Tags are normalised, idempotent and never invented from invalid import data' => function () {
    $service = ch247_marketing_admin();
    $tags = new TagRepository();
    $service->subscribe(array('email' => 'tagged@example.com', 'tags' => array('VIP', 'vip', ' 2026-q4 ')));
    $subscriber = (new SubscriberRepository())->findByEmail('tagged@example.com');
    $assigned = $tags->forSubscriber((int) $subscriber->id);
    if (count($assigned) !== 2) { return false; }   // vip + 2026-q4, case- and duplicate-folded

    $tag = $tags->ensure('vip', 'VIP');
    if ($tags->assign((int) $subscriber->id, (int) $tag->id)) { return false; }  // already assigned
    if ($tags->remove((int) $subscriber->id, (int) $tag->id) !== 1) { return false; }

    $ids = $tags->ensureMany(array('ok-tag', '!!!bad tag!!!', '', 'ok-tag'));
    return count($ids) === 1 && $tags->find((int) $ids[0])->tag_key === 'ok-tag';
},

// ---------------------------------------------------------------- repository

'Pagination filters by status, free-text search, list and tag without leaking rows' => function () {
    $service = ch247_marketing_admin();
    $lists = new ListRepository();
    $subscribers = new SubscriberRepository();
    $list = $lists->create('vip-list', 'VIP List');
    $service->subscribe(array('email' => 'ann@alpha.example', 'first_name' => 'Ann', 'company' => 'Alpha', 'tags' => array('gold')));
    $service->subscribe(array('email' => 'bob@beta.example', 'first_name' => 'Bob', 'company' => 'Beta'));
    $service->subscribe(array('email' => 'cid@gamma.example', 'status' => SubscriberStatus::PENDING));
    $ann = $subscribers->findByEmail('ann@alpha.example');
    $cid = $subscribers->findByEmail('cid@gamma.example');
    $lists->addMembers((int) $list->id, array((int) $ann->id));

    $all = $subscribers->paginate(array(), 1, 2);
    if ($all['total'] !== 3 || count($all['rows']) !== 2 || $all['pages'] !== 2) { return false; }
    if ((int) $all['rows'][0]->id < (int) $all['rows'][1]->id) { return false; }   // newest first

    $byStatus = $subscribers->paginate(array('status' => SubscriberStatus::PENDING));
    if ($byStatus['total'] !== 1 || $byStatus['rows'][0]->email !== 'cid@gamma.example') { return false; }

    $bySearch = $subscribers->paginate(array('search' => 'alpha'));
    if ($bySearch['total'] !== 1 || $bySearch['rows'][0]->email !== 'ann@alpha.example') { return false; }
    $byName = $subscribers->paginate(array('search' => 'bob'));
    if ($byName['total'] !== 1) { return false; }

    $byList = $subscribers->paginate(array('list_id' => (int) $list->id));
    if ($byList['total'] !== 1 || $byList['rows'][0]->email !== 'ann@alpha.example') { return false; }

    $tagId = (int) (new TagRepository())->findByKey('gold')->id;
    $byTag = $subscribers->paginate(array('tag_id' => $tagId));
    if ($byTag['total'] !== 1) { return false; }

    $empty = $subscribers->paginate(array('list_id' => 999));
    return $empty['total'] === 0 && $empty['rows'] === array() && $empty['pages'] === 0
        && $cid->status === SubscriberStatus::PENDING;
},

// -------------------------------------------------------------------- import

'Import parsing handles headers, quoted CSV, semicolons and one-address-per-line' => function () {
    ch247_marketing_admin();
    $imports = new ImportService();

    $csv = $imports->parse("email,first_name,company\n\"alice@example.com\",\"Alice\",\"Example, Ltd\"\nbob@example.com,Bob,Beta");
    if (!$csv['ok'] || !$csv['has_header'] || count($csv['rows']) !== 2) { return false; }
    if ($csv['rows'][0][2] !== 'Example, Ltd') { return false; }   // quoted comma preserved
    if ($imports->suggestMapping($csv['header']) !== array(0 => 'email', 1 => 'first_name', 2 => 'company')) { return false; }

    $semi = $imports->parse("alice@example.com;Alice\nbob@example.com;Bob");
    if ($semi['delimiter'] !== ';' || $semi['has_header'] || count($semi['rows']) !== 2) { return false; }

    $plain = $imports->parse("alice@example.com\nbob@example.com\n");
    if (!$plain['ok'] || count($plain['rows']) !== 2 || $plain['rows'][0][0] !== 'alice@example.com') { return false; }

    if ($imports->parse('   ')['ok']) { return false; }
    $tooBig = $imports->parse("email\n" . str_repeat("a@example.com\n", 5), 4);
    return !$tooBig['ok'] && strpos($tooBig['error'], 'limit') !== false;
},

'Import preview writes nothing and reports every skip reason honestly' => function () {
    $service = ch247_marketing_admin();
    $service->suppress('blocked@example.com', SuppressionReason::UNSUBSCRIBED, 'previous unsubscribe');
    $service->subscribe(array('email' => 'existing@example.com'));
    $imports = new ImportService();

    $parsed = $imports->parse("email\nnew@example.com\nexisting@example.com\nblocked@example.com\nnot-an-email\nalice@example.com\nALICE@example.com\n");
    $mapping = array(0 => 'email');
    $preview = $imports->preview($parsed['rows'], $mapping);

    $counts = $preview['counts'];
    if ($counts['total'] !== 6) { return false; }
    if ($counts['created'] !== 2) { return false; }               // new@example.com + alice@example.com
    if ($counts['updated'] !== 1) { return false; }               // existing@example.com
    if ($counts['skipped_suppressed'] !== 1) { return false; }
    if ($counts['skipped_invalid'] !== 1) { return false; }
    if ($counts['skipped_duplicate'] !== 1) { return false; }     // ALICE is alice

    // Preview is a dry run: not one row was written anywhere.
    return count(CH247MarketingFakeDB::rowsRef('mod_cloudhost247_marketing_imports')) === 0
        && (new SubscriberRepository())->findByEmail('new@example.com') === null
        && count(CH247MarketingFakeDB::rowsRef('mod_cloudhost247_marketing_subscribers')) === 1;
},

'Import apply writes the subscribers, the audit record and never resurrects a suppressed address' => function () {
    $service = ch247_marketing_admin();
    $service->suppress('blocked@example.com', SuppressionReason::HARD_BOUNCE, 'hard bounce');
    $lists = new ListRepository();
    $list = $lists->create('imported', 'Imported');
    $imports = new ImportService();

    $parsed = $imports->parse("email,first_name,tags\nalice@example.com,Alice,vip;trade-show\nblocked@example.com,Blocked,vip\nnot-an-email,Nope,vip\n");
    $mapping = array(0 => 'email', 1 => 'first_name', 2 => 'tags');
    $result = $imports->apply($parsed['rows'], $mapping, array(
        'list_ids' => array((int) $list->id),
        'default_tags' => array('imported-2026'),
        'consent_status' => ConsentStatus::GRANTED,
        'consent_source' => 'written opt-in 2026-09',
        'source_label' => 'trade-show.csv',
    ));

    if ($result['counts']['created'] !== 1 || $result['counts']['skipped_suppressed'] !== 1 || $result['counts']['skipped_invalid'] !== 1) { return false; }
    $alice = (new SubscriberRepository())->findByEmail('alice@example.com');
    if (!$alice || $alice->source !== SubscriberSource::IMPORT) { return false; }
    if ($alice->consent_status !== ConsentStatus::GRANTED || $alice->consent_source !== 'written opt-in 2026-09') { return false; }
    if (count($lists->idsForSubscriber((int) $alice->id)) !== 1) { return false; }
    $tags = array();
    foreach ((new TagRepository())->forSubscriber((int) $alice->id) as $tag) { $tags[] = $tag->tag_key; }
    sort($tags);
    if ($tags !== array('imported-2026', 'trade-show', 'vip')) { return false; }

    $records = CH247MarketingFakeDB::rowsRef('mod_cloudhost247_marketing_imports');
    if (count($records) !== 1 || $records[0]['status'] !== 'imported' || $records[0]['source_label'] !== 'trade-show.csv') { return false; }
    $totals = json_decode($records[0]['totals_json'], true);
    if ($totals['created'] !== 1) { return false; }
    if (!in_array('subscribers.imported', ch247_marketing_audit_actions(), true)) { return false; }
    // The suppressed address is still suppressed, still not a subscriber.
    return (new SubscriberRepository())->findByEmail('blocked@example.com') === null
        && (new SuppressionRepository())->isSuppressed('blocked@example.com');
},

'Import apply refuses when no column is mapped to email' => function () {
    ch247_marketing_admin();
    $imports = new ImportService();
    $parsed = $imports->parse("name\nAlice\n");
    $refused = false;
    try { $imports->apply($parsed['rows'], array(0 => 'ignore')); } catch (InvalidArgumentException $e) { $refused = true; }
    return $refused && count(CH247MarketingFakeDB::rowsRef('mod_cloudhost247_marketing_imports')) === 0;
},

// -------------------------------------------------------------------- export

'Export produces auditable CSV, neutralises spreadsheet formulas and honours filters' => function () {
    $service = ch247_marketing_admin();
    $service->subscribe(array('email' => 'safe@example.com', 'company' => '=cmd|\' /C calc\'!A0', 'consent_status' => ConsentStatus::GRANTED, 'consent_source' => 'form'));
    $service->subscribe(array('email' => 'other@example.com', 'status' => SubscriberStatus::PENDING));
    $exporter = new ExportService();

    $csv = $exporter->subscribersCsv(array('status' => SubscriberStatus::SUBSCRIBED));
    $lines = array_values(array_filter(explode("\r\n", $csv)));
    if (count($lines) !== 2) { return false; }                        // header + one subscriber
    if (strpos($lines[0], '"email","first_name"') !== 0) { return false; }
    if (strpos($csv, "'=cmd") === false) { return false; }            // formula neutralised
    if (strpos($csv, 'other@example.com') !== false) { return false; } // filter honoured

    $auditRows = CH247MarketingFakeDB::rowsRef('mod_cloudhost247_audit_events');
    $exported = null;
    foreach ($auditRows as $row) { if ($row['action'] === 'subscribers.exported') { $exported = $row; } }
    if (!$exported) { return false; }
    $after = json_decode($exported['after_json'], true);
    return $after['rows'] === 1 && $after['filters']['status'] === SubscriberStatus::SUBSCRIBED;
},

// -------------------------------------------------------------- admin screens

'Subscriber screens require the subscribers.manage capability and the export returns a file body' => function () {
    $service = ch247_marketing_admin();
    $service->subscribe(array('email' => 'export@example.com'));

    CH247MarketingFakeDB::rowsRef('mod_cloudhost247_capabilities')[] = array(
        'id' => 1, 'module' => 'cloudhost247_marketing', 'capability' => 'marketing.subscribers.manage', 'role_ids' => '2',
    );
    $_SESSION['adminroleid'] = 1;   // role 1 is not allowed by the policy
    $denied = false;
    try {
        ch247_marketing_post('subscribers', array('action' => 'subscribers.export'));
    } catch (RuntimeException $e) { $denied = true; }
    if (!$denied) { return false; }

    // Allowed role: the export comes back as a download payload, and the
    // capability denial above never degraded into a rendered error.
    $_SESSION['adminroleid'] = 2;
    $data = ch247_marketing_post('subscribers', array('action' => 'subscribers.export'));
    if (empty($data['download']) || strpos($data['download']['filename'], '.csv') === false) { return false; }
    if (strpos($data['download']['content'], 'export@example.com') === false) { return false; }

    // GET never mutates and never returns a download.
    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET = array();
    $_POST = array();
    $_REQUEST = array();
    $get = (new AdminController())->handle();
    return $get['download'] === null && $get['view'] === 'dashboard';
},

'Subscriber, list, suppression and import actions are CSRF-protected and audit-logged' => function () {
    $service = ch247_marketing_admin();

    // Missing CSRF token: refused outright.
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_GET = array('view' => 'subscribers');
    $_POST = array('action' => 'subscriber.save', 'email' => 'nope@example.com');
    $_REQUEST = $_POST;
    $refused = false;
    try { (new AdminController())->handle(); } catch (RuntimeException $e) { $refused = true; }
    if (!$refused || (new SubscriberRepository())->findByEmail('nope@example.com') !== null) { return false; }

    // Adding a subscriber.
    $data = ch247_marketing_post('subscribers', array('action' => 'subscriber.save', 'email' => 'added@example.com', 'first_name' => 'Added', 'consent_status' => ConsentStatus::GRANTED, 'consent_source' => 'admin'));
    if ($data['notice'] !== 'Subscriber added.') { return false; }

    // A list and its members.
    $data = ch247_marketing_post('lists', array('action' => 'list.save', 'name' => 'Partners', 'list_key' => 'partners'));
    if ($data['notice'] !== 'List created.') { return false; }
    $list = (new ListRepository())->findByKey('partners');
    $data = ch247_marketing_post('lists', array('action' => 'list.members.add', 'list_id' => (int) $list->id, 'emails' => "added@example.com\nnew-person@example.com"));
    if (strpos($data['notice'], '2 address(es) added') !== 0) { return false; }
    if ((new ListRepository())->memberCount((int) $list->id) !== 2) { return false; }
    if ((new SubscriberRepository())->findByEmail('new-person@example.com') === null) { return false; }

    // Suppress then release.
    $data = ch247_marketing_post('suppressions', array('action' => 'suppression.add', 'email' => 'added@example.com', 'reason' => SuppressionReason::ADMIN_SUPPRESSED, 'detail' => 'duplicate account'));
    if ($data['notice'] !== 'Address suppressed.') { return false; }
    if ($service->checkSendable('added@example.com')['sendable']) { return false; }
    $data = ch247_marketing_post('suppressions', array('action' => 'suppression.release', 'email' => 'added@example.com'));
    if ($data['notice'] === '' || $data['error'] !== '') { return false; }
    if ((new SuppressionRepository())->isSuppressed('added@example.com')) { return false; }

    $actions = ch247_marketing_audit_actions();
    foreach (array('subscriber.created', 'list.created', 'suppression.added', 'suppression.released') as $expected) {
        if (!in_array($expected, $actions, true)) { return false; }
    }
    return true;
},

'Import through the admin screen: preview then apply, and a changed payload is refused' => function () {
    ch247_marketing_admin();
    $content = "email,first_name\nscreen@example.com,Screen\n";

    $_POST = array('token' => str_repeat('ab', 16), 'action' => 'import.preview', 'content' => $content, 'consent_status' => ConsentStatus::GRANTED, 'consent_source' => 'form');
    $previewData = ch247_marketing_post('import', $_POST);
    if (empty($previewData['importPreview'])) { return false; }
    $hash = $previewData['importPreview']['hash'];
    if ($previewData['importPreview']['counts']['created'] !== 1) { return false; }
    if ((new SubscriberRepository())->findByEmail('screen@example.com') !== null) { return false; }  // preview wrote nothing

    // The content changed after the preview: the hash no longer matches.
    $changed = ch247_marketing_post('import', array(
        'action' => 'import.apply', 'content' => $content . "extra@example.com,Extra\n",
        'preview_hash' => $hash, 'consent_status' => ConsentStatus::GRANTED, 'consent_source' => 'form',
    ));
    if (strpos($changed['error'], 'Preview') === false
        && strpos($changed['error'], 'preview') === false) { return false; }
    if ((new SubscriberRepository())->findByEmail('screen@example.com') !== null) { return false; }

    // The same payload applies.
    $applied = ch247_marketing_post('import', array(
        'action' => 'import.apply', 'content' => $content, 'preview_hash' => $hash,
        'consent_status' => ConsentStatus::GRANTED, 'consent_source' => 'form',
    ));
    if (strpos($applied['notice'], 'Import #1 finished: 1 created') !== 0) { return false; }
    $row = (new SubscriberRepository())->findByEmail('screen@example.com');
    return $row !== null && $row->source === SubscriberSource::IMPORT;
},

);
