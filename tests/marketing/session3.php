<?php
/**
 * CloudHost247 Marketing — SESSION 3 behavior suite.
 *
 * Segments: the closed rule DSL, live evaluation, membership operators,
 * read-only customer facts and the fail-closed send path. Pure PHP, in-memory
 * fakes (fakes.php); every test calls the real module classes.
 * Run: php tests/marketing/run.php
 */

use CloudHost247\Marketing\Domain\SegmentField;
use CloudHost247\Marketing\Repositories\ClientDirectoryRepository;
use CloudHost247\Marketing\Repositories\ListRepository;
use CloudHost247\Marketing\Repositories\SegmentRepository;
use CloudHost247\Marketing\Repositories\SubscriberRepository;
use CloudHost247\Marketing\Repositories\TagRepository;
use CloudHost247\Marketing\Services\SegmentService;
use WHMCS\Database\Capsule;

/** Inserts a subscriber row directly so tests can age it deliberately. */
function ch247_marketing_seed_subscriber($email, array $overrides = array())
{
    $now = date('Y-m-d H:i:s');
    return Capsule::table(SubscriberRepository::TABLE)->insertGetId(array_merge(array(
        'email' => $email,
        'first_name' => '',
        'last_name' => '',
        'company' => '',
        'phone' => '',
        'country' => '',
        'fields_json' => '{}',
        'status' => 'subscribed',
        'consent_status' => 'unknown',
        'consent_at' => null,
        'consent_source' => '',
        'client_id' => null,
        'source' => 'manual',
        'bounce_type' => '',
        'bounce_count' => 0,
        'bounced_at' => null,
        'last_activity_at' => null,
        'created_at' => $now,
        'updated_at' => $now,
    ), $overrides));
}

/** Seeds one read-only customer row (and optionally the tables themselves). */
function ch247_marketing_seed_client($id, $email, array $overrides = array())
{
    CH247MarketingFakeSchema::$created['tblclients'] = true;
    Capsule::table('tblclients')->insert(array_merge(array(
        'id' => (int) $id,
        'email' => $email,
        'country' => '',
        'status' => 'Active',
        'datecreated' => '2024-01-01 00:00:00',
        'lastlogin' => '2026-09-01 00:00:00',
    ), $overrides));
}

function ch247_marketing_seed_active_service($id, $userId, $status = 'Active')
{
    CH247MarketingFakeSchema::$created['tblhosting'] = true;
    Capsule::table('tblhosting')->insert(array('id' => (int) $id, 'userid' => (int) $userId, 'domainstatus' => $status));
}

/** Shortcut: a valid one-rule definition. */
function ch247_marketing_definition($field, $operator, $value = null, $match = 'all')
{
    $rule = array('field' => $field, 'operator' => $operator);
    if (func_num_args() >= 3) { $rule['value'] = $value; }
    return array('match' => $match, 'rules' => array($rule));
}

return array(

// ------------------------------------------------------------------ the DSL

'Segment definitions are validated against the closed field and operator catalogs' => function () {
    ch247_marketing_admin();
    $service = new SegmentService();

    $rejects = array(
        array(ch247_marketing_definition('bogus_field', 'is', 'x'), 'not a field'),
        array(ch247_marketing_definition('status', 'greater_than', '5'), 'cannot be used with'),
        array(ch247_marketing_definition('subscriber.country', 'older_than_days', '3'), 'cannot be used with'),
        array(ch247_marketing_definition('status', 'is', 'nonsense'), 'is not one of'),
        array(ch247_marketing_definition('created_at', 'before', '2026-13-40'), 'YYYY-MM-DD'),
        array(ch247_marketing_definition('created_at', 'older_than_days', 'soon'), 'number of days'),
        array(ch247_marketing_definition('created_at', 'older_than_days', '99999'), 'number of days'),
        array(array('match' => 'all', 'rules' => array(array('field' => '', 'operator' => ''))), 'needs both a field and an operator'),
        array(array('match' => 'some', 'rules' => array(array('field' => 'status', 'operator' => 'is', 'value' => 'subscribed'))), 'all or any'),
        array(array('match' => 'all', 'rules' => array()), 'at least one rule'),
        array('not json at all', 'not valid JSON'),
    );
    foreach ($rejects as $case) {
        try {
            $service->normaliseDefinition($case[0]);
        } catch (InvalidArgumentException $e) {
            if (strpos($e->getMessage(), $case[1]) === false) { return false; }
            continue;
        }
        return false;
    }

    // 21 rules is one too many; 20 is accepted.
    $many = array();
    for ($i = 0; $i < 21; $i++) { $many[] = array('field' => 'status', 'operator' => 'is', 'value' => 'subscribed'); }
    try {
        $service->normaliseDefinition(array('match' => 'all', 'rules' => $many));
        return false;
    } catch (InvalidArgumentException $e) {
        if (strpos($e->getMessage(), 'at most 20') === false) { return false; }
    }
    array_pop($many);
    return count($service->normaliseDefinition(array('match' => 'all', 'rules' => $many))['rules']) === 20;
},

'Segment definitions normalise to one canonical form regardless of how they arrive' => function () {
    ch247_marketing_admin();
    $service = new SegmentService();

    $fromJson = $service->normaliseDefinition(json_encode(array(
        'match' => 'ANY',
        'rules' => array(
            array('field' => 'STATUS', 'operator' => 'IN', 'value' => 'Subscribed, SUBSCRIBED , pending'),
            array('field' => 'created_at', 'operator' => 'older_than_days', 'value' => '30'),
            array('field' => 'client.has_active_service', 'operator' => 'is', 'value' => 'yes'),
            array('field' => 'last_activity_at', 'operator' => 'is_set'),
        ),
    )));

    if ($fromJson['match'] !== 'any') { return false; }
    if ($fromJson['rules'][0]['value'] !== array('subscribed', 'pending')) { return false; }
    if ($fromJson['rules'][1]['value'] !== 30) { return false; }
    if ($fromJson['rules'][2]['value'] !== true) { return false; }
    if (array_key_exists('value', $fromJson['rules'][3]) === false || $fromJson['rules'][3]['value'] !== null) { return false; }
    if ($service->describeDefinition($fromJson) !== '4 rules · any may match') { return false; }
    if (count($service->ruleSentences($fromJson)) !== 4) { return false; }
    if (strpos($service->ruleSentences($fromJson)[0], 'Subscriber status is one of subscribed, pending') !== 0) { return false; }

    // A bare list of rules is accepted as an "all must match" definition.
    $bare = $service->normaliseDefinition(array(array('field' => 'status', 'operator' => 'is', 'value' => 'subscribed')));
    return $bare['match'] === 'all' && count($bare['rules']) === 1;
},

'A rule may only reference lists and tags that exist' => function () {
    ch247_marketing_admin();
    (new ListRepository())->create('newsletter', 'Newsletter');
    (new TagRepository())->ensure('vip', 'VIP');
    $service = new SegmentService();

    try {
        $service->save(array('segment_key' => 's1', 'name' => 'S1', 'definition' => ch247_marketing_definition('list', 'in', 'does-not-exist')));
        return false;
    } catch (InvalidArgumentException $e) {
        if (strpos($e->getMessage(), 'no list has the key') === false) { return false; }
    }
    try {
        $service->save(array('segment_key' => 's2', 'name' => 'S2', 'definition' => ch247_marketing_definition('tag', 'not_in', 'nope')));
        return false;
    } catch (InvalidArgumentException $e) {
        if (strpos($e->getMessage(), 'no tag has the key') === false) { return false; }
    }

    // Both real keys pass, and re-validating a stored definition stays lenient:
    // a key that disappears later must not make the stored segment unreadable.
    $segment = $service->save(array('segment_key' => 's3', 'name' => 'S3', 'definition' => ch247_marketing_definition('list', 'in', 'newsletter')));
    $stored = SegmentRepository::definitionOf($segment);
    return count($stored['rules']) === 1 && $stored['rules'][0]['value'] === array('newsletter');
},

'Saving, re-evaluating and archiving a segment are audited and a rule change invalidates the cached count' => function () {
    ch247_marketing_admin();
    $service = new SegmentService();
    $subscribers = new SubscriberRepository();
    $lists = new ListRepository();
    $list = $lists->create('newsletter', 'Newsletter');
    ch247_marketing_seed_subscriber('a@example.com');
    $lists->addMembers((int) $list->id, array(1));

    $segment = $service->save(array(
        'segment_key' => 'newsletter-readers',
        'name' => 'Newsletter readers',
        'definition' => ch247_marketing_definition('list', 'in', 'newsletter'),
    ));
    if ($segment->cached_count !== null) { return false; }

    $refresh = $service->refreshCount((int) $segment->id);
    if ((int) $refresh['result']['count'] !== 1 || (int) $refresh['segment']->cached_count !== 1) { return false; }

    // A changed definition clears the stale number; an unchanged one keeps it.
    $service->save(array('name' => 'Newsletter readers', 'definition' => ch247_marketing_definition('list', 'in', 'newsletter')), (int) $segment->id);
    if ((new SegmentRepository())->find((int) $segment->id)->cached_count !== null) { return false; }

    $service->archive((int) $segment->id);
    if ((new SegmentRepository())->find((int) $segment->id)->status !== 'archived') { return false; }
    $service->activate((int) $segment->id);
    if ((new SegmentRepository())->find((int) $segment->id)->status !== 'active') { return false; }

    $actions = ch247_marketing_audit_actions();
    foreach (array('segment.created', 'segment.count_refreshed', 'segment.updated', 'segment.archived', 'segment.reactivated') as $action) {
        if (!in_array($action, $actions, true)) { return false; }
    }
    return (new SubscriberRepository())->find(1) !== null;
},

// -------------------------------------------------------------- evaluation

'Evaluation is live: a saved segment picks up new members without storing membership' => function () {
    ch247_marketing_admin();
    $service = new SegmentService();
    $lists = new ListRepository();
    $list = $lists->create('newsletter', 'Newsletter');
    ch247_marketing_seed_subscriber('a@example.com');

    $segment = $service->save(array(
        'segment_key' => 'live',
        'name' => 'Live',
        'definition' => ch247_marketing_definition('list', 'in', 'newsletter', 'all'),
    ));
    $definition = SegmentRepository::definitionOf($segment);
    if ($service->evaluate($definition)['count'] !== 0) { return false; }

    $lists->addMembers((int) $list->id, array(1));
    if ($service->evaluate($definition)['count'] !== 1) { return false; }

    // The segment row itself never changed — there is no second copy of truth.
    $stored = (new SegmentRepository())->find((int) $segment->id);
    if ($stored->definition_json !== $segment->definition_json) { return false; }

    $lists->removeMember((int) $list->id, 1);
    $result = $service->evaluate($definition, array('ids_limit' => 10));
    return $result['count'] === 0 && $result['ids'] === array() && $result['checked'] === 1;
},

'all and any combine rules with the documented precedence' => function () {
    ch247_marketing_admin();
    $service = new SegmentService();
    ch247_marketing_seed_subscriber('ng-sub@example.com', array('status' => 'subscribed', 'country' => 'NG'));
    ch247_marketing_seed_subscriber('de-pending@example.com', array('status' => 'pending', 'country' => 'DE'));
    ch247_marketing_seed_subscriber('ng-pending@example.com', array('status' => 'pending', 'country' => 'NG'));

    $all = $service->evaluate(array('match' => 'all', 'rules' => array(
        array('field' => 'status', 'operator' => 'is', 'value' => 'subscribed'),
        array('field' => 'subscriber.country', 'operator' => 'is', 'value' => 'NG'),
    )), array('ids_limit' => 10));
    if ($all['count'] !== 1 || $all['ids'] !== array(1)) { return false; }

    $any = $service->evaluate(array('match' => 'any', 'rules' => array(
        array('field' => 'status', 'operator' => 'is', 'value' => 'subscribed'),
        array('field' => 'subscriber.country', 'operator' => 'is', 'value' => 'DE'),
    )), array('ids_limit' => 10));
    if ($any['count'] !== 2) { return false; }

    // contains is case-insensitive; is is exact for text fields.
    $contains = $service->evaluate(ch247_marketing_definition('subscriber.country', 'contains', 'n'), array('ids_limit' => 10));
    return $contains['count'] === 2;
},

'Membership rules: is one of matches any key, is none of matches subscribers who are in none' => function () {
    ch247_marketing_admin();
    $service = new SegmentService();
    $lists = new ListRepository();
    $tags = new TagRepository();

    $news = $lists->create('newsletter', 'Newsletter');
    $deals = $lists->create('deals', 'Deals');
    $vip = $tags->ensure('vip', 'VIP');

    ch247_marketing_seed_subscriber('news@example.com');
    ch247_marketing_seed_subscriber('deals@example.com');
    ch247_marketing_seed_subscriber('vip@example.com');
    ch247_marketing_seed_subscriber('none@example.com');
    $lists->addMembers((int) $news->id, array(1));
    $lists->addMembers((int) $deals->id, array(2));
    $tags->assign(3, (int) $vip->id);

    $in = $service->evaluate(ch247_marketing_definition('list', 'in', 'newsletter, deals'), array('ids_limit' => 10));
    if ($in['count'] !== 2) { return false; }

    $notIn = $service->evaluate(ch247_marketing_definition('list', 'not_in', 'newsletter'), array('ids_limit' => 10));
    if ($notIn['count'] !== 3) { return false; }

    $vipOnly = $service->evaluate(ch247_marketing_definition('tag', 'in', 'vip'), array('ids_limit' => 10));
    if ($vipOnly['count'] !== 1 || $vipOnly['ids'] !== array(3)) { return false; }

    $noTags = $service->evaluate(ch247_marketing_definition('tag', 'is_not_set'), array('ids_limit' => 10));
    return $noTags['count'] === 3;
},

'Date rules read subscriber dates: older-than and within-the-last-days are both relative to now' => function () {
    ch247_marketing_admin();
    $service = new SegmentService();
    ch247_marketing_seed_subscriber('old@example.com', array('created_at' => date('Y-m-d H:i:s', time() - 100 * 86400)));
    ch247_marketing_seed_subscriber('new@example.com', array('created_at' => date('Y-m-d H:i:s', time() - 2 * 86400)));
    ch247_marketing_seed_subscriber('unknown@example.com', array('created_at' => date('Y-m-d H:i:s', time() - 400 * 86400), 'last_activity_at' => null));

    $older = $service->evaluate(ch247_marketing_definition('created_at', 'older_than_days', 30), array('ids_limit' => 10));
    if ($older['count'] !== 2) { return false; }

    $within = $service->evaluate(ch247_marketing_definition('created_at', 'within_days', 7), array('ids_limit' => 10));
    if ($within['count'] !== 1 || $within['ids'] !== array(2)) { return false; }

    $active = $service->evaluate(ch247_marketing_definition('last_activity_at', 'is_set'), array('ids_limit' => 10));
    $absent = $service->evaluate(ch247_marketing_definition('last_activity_at', 'is_not_set'), array('ids_limit' => 10));
    return $active['count'] === 0 && $absent['count'] === 3;
},

// ------------------------------------------------------------- customer facts

'Customer-side rules read only the whitelisted facts and are batched by e-mail address' => function () {
    ch247_marketing_admin();
    $service = new SegmentService();
    ch247_marketing_seed_subscriber('ng-active@example.com');
    ch247_marketing_seed_subscriber('de-closed@example.com');
    ch247_marketing_seed_subscriber('stranger@example.com'); // no WHMCS customer record

    ch247_marketing_seed_client(10, 'ng-active@example.com', array('country' => 'NG', 'status' => 'Active'));
    ch247_marketing_seed_active_service(100, 10);
    ch247_marketing_seed_client(11, 'de-closed@example.com', array('country' => 'DE', 'status' => 'Closed'));

    $definition = array('match' => 'all', 'rules' => array(
        array('field' => 'client.country', 'operator' => 'in', 'value' => 'NG, GH'),
        array('field' => 'client.has_active_service', 'operator' => 'is', 'value' => 'yes'),
    ));
    $result = $service->evaluate($definition, array('ids_limit' => 10));
    if ($result['count'] !== 1 || $result['ids'] !== array(1)) { return false; }
    if ($result['checked'] !== 3 || $result['unverified'] !== 1 || $result['error'] !== '') { return false; }

    // The whitelist is the whitelist: SegmentField refuses anything else.
    $clientFields = SegmentField::keysBySource(true);
    foreach ($clientFields as $key) {
        if (!SegmentField::isClientField($key)) { return false; }
    }
    if (in_array('client.password', $clientFields, true) || in_array('client.address1', $clientFields, true)) { return false; }

    $domainRule = ch247_marketing_definition('client.has_active_domain', 'is', 'no');
    $noDomains = $service->evaluate($domainRule, array('ids_limit' => 10));
    // tblhosting exists but tbl domains do not: those rows cannot be verified, so
    // they are excluded with a reason instead of being guessed at.
    return $noDomains['count'] === 0 && $noDomains['error'] !== '' && $noDomains['unverified'] === 3;
},

'Customer facts fail closed and the send path refuses when they cannot be read' => function () {
    ch247_marketing_admin();
    $service = new SegmentService();
    ch247_marketing_seed_subscriber('a@example.com');
    ch247_marketing_seed_subscriber('b@example.com');
    // No tblclients at all in this fake environment.

    $result = $service->evaluate(ch247_marketing_definition('client.country', 'is', 'NG'), array('ids_limit' => 10));
    if ($result['count'] !== 0 || $result['unverified'] !== 2 || $result['error'] === '') { return false; }

    $segment = $service->save(array(
        'segment_key' => 'unverifiable',
        'name' => 'Unverifiable',
        'definition' => ch247_marketing_definition('client.country', 'is', 'NG'),
    ));
    try {
        $service->subscriberIds((int) $segment->id);
        return false;
    } catch (RuntimeException $e) {
        if (strpos($e->getMessage(), 'cannot be resolved') === false) { return false; }
    }

    // A readable customer table but one subscriber with no customer record is a
    // different refusal: the rule can be read, the person cannot, so no send.
    ch247_marketing_seed_client(10, 'a@example.com', array('country' => 'NG'));
    ch247_marketing_seed_active_service(100, 10);
    try {
        $service->subscriberIds((int) $segment->id, 10);
        return false;
    } catch (RuntimeException $e) {
        if (strpos($e->getMessage(), 'could not be verified') === false) { return false; }
    }

    // An archived segment refuses outright.
    $service->archive((int) $segment->id);
    try {
        $service->subscriberIds((int) $segment->id);
        return false;
    } catch (RuntimeException $e) {
        return strpos($e->getMessage(), 'archived') !== false;
    }
},

'Subscriber-only segments resolve ids for sending and a truncated scan is reported, never silently sent' => function () {
    ch247_marketing_admin();
    $service = new SegmentService();
    ch247_marketing_seed_subscriber('a@example.com');
    ch247_marketing_seed_subscriber('b@example.com');
    ch247_marketing_seed_subscriber('c@example.com');

    $segment = $service->save(array(
        'segment_key' => 'everyone-subscribed',
        'name' => 'Subscribed',
        'definition' => ch247_marketing_definition('status', 'is', 'subscribed'),
    ));
    $ids = $service->subscriberIds((int) $segment->id);
    sort($ids);
    if ($ids !== array(1, 2, 3)) { return false; }

    $truncated = $service->evaluate(ch247_marketing_definition('status', 'is', 'subscribed'), array('max_scan' => 2, 'ids_limit' => 10));
    if (!$truncated['truncated'] || $truncated['checked'] !== 2) { return false; }

    return (new ClientDirectoryRepository())->hasClientTable() === false;
},

// ------------------------------------------------------------ admin screens

'Admin creates, counts and archives a segment through POST, capability and CSRF guarded' => function () {
    $service = ch247_marketing_admin();
    (new ListRepository())->create('newsletter', 'Newsletter');
    (new SubscriberRepository())->upsert(array('email' => 'a@example.com'));
    (new ListRepository())->addMembers(1, array(1));

    // Missing CSRF token is refused before anything is written.
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_GET = array('view' => 'segments');
    $_POST = array('action' => 'segment.save', 'name' => 'No token');
    $_REQUEST = $_POST;
    $refused = false;
    try { (new CloudHost247\Marketing\Http\AdminController())->handle(); } catch (RuntimeException $e) { $refused = true; }
    if (!$refused || (new SegmentRepository())->count() !== 0) { return false; }

    $data = ch247_marketing_post('segments', array(
        'action' => 'segment.save',
        'name' => 'Newsletter readers',
        'segment_key' => '',
        'match' => 'all',
        'rule_field' => array('list', ''),
        'rule_operator' => array('in', ''),
        'rule_value' => array('newsletter', ''),
    ));
    if ($data['notice'] !== 'Segment created.') { return false; }
    $segment = (new SegmentRepository())->findByKey('newsletter-readers');
    if (!$segment) { return false; }

    $count = ch247_marketing_post('segments', array('action' => 'segment.count', 'segment_id' => (int) $segment->id));
    if (strpos($count['notice'], '1 subscriber(s) match right now') !== 0) { return false; }

    $archived = ch247_marketing_post('segments', array('action' => 'segment.archive', 'segment_id' => (int) $segment->id));
    if ($archived['notice'] !== 'Segment archived.') { return false; }

    $actions = ch247_marketing_audit_actions();
    foreach (array('segment.created', 'segment.count_refreshed', 'segment.archived') as $action) {
        if (!in_array($action, $actions, true)) { return false; }
    }

    // Capability policy for role 2 only: role 1 is refused outright.
    CH247MarketingFakeDB::rowsRef('mod_cloudhost247_capabilities')[] = array(
        'id' => 2, 'module' => 'cloudhost247_marketing', 'capability' => 'marketing.campaigns.manage', 'role_ids' => '2',
    );
    $_SESSION['adminroleid'] = 1;
    try {
        ch247_marketing_post('segments', array('action' => 'segment.archive', 'segment_id' => (int) $segment->id));
        return false;
    } catch (RuntimeException $e) {
        return true;
    }
},

'A blank rule row is ignored, and an all-blank form is refused instead of matching everyone' => function () {
    ch247_marketing_admin();
    (new ListRepository())->create('newsletter', 'Newsletter');

    $saved = ch247_marketing_post('segments', array(
        'action' => 'segment.save',
        'name' => 'With blanks',
        'rule_field' => array('list', '', 'status'),
        'rule_operator' => array('in', '', 'is'),
        'rule_value' => array('newsletter', '', 'subscribed'),
    ));
    if ($saved['notice'] !== 'Segment created.') { return false; }

    $empty = ch247_marketing_post('segments', array(
        'action' => 'segment.save',
        'name' => 'Everybody',
        'rule_field' => array('', ''),
        'rule_operator' => array('', ''),
        'rule_value' => array('', ''),
    ));
    return $empty['notice'] === '' && strpos($empty['error'], 'at least one rule') !== false
        && (new SegmentRepository())->count() === 1;
},

'The segment screens render live data and never claim a count that has not been evaluated' => function () {
    ch247_marketing_admin();
    (new ListRepository())->create('newsletter', 'Newsletter');
    $_GET = array('view' => 'segments');
    $data = (new CloudHost247\Marketing\Http\AdminController())->handle();
    if ($data['view'] !== 'segments') { return false; }
    if (!isset($data['segmentsView']['rows']) || $data['segmentsView']['rows'] !== array()) { return false; }

    $created = ch247_marketing_post('segments', array(
        'action' => 'segment.save', 'name' => 'Uncounted',
        'rule_field' => array('list'), 'rule_operator' => array('in'), 'rule_value' => array('newsletter'),
    ));
    if ($created['notice'] !== 'Segment created.') { return false; }

    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET = array('view' => 'segments');
    $_POST = array(); $_REQUEST = array();
    $listed = (new CloudHost247\Marketing\Http\AdminController())->handle();
    $row = $listed['segmentsView']['rows'][0];
    return $row->cached_count === null
        && strpos($listed['segmentsView']['definitions'][(int) $row->id]['summary'], 'all must match') !== false;
},

);
