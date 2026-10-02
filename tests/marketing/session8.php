<?php
/**
 * CloudHost247 Marketing — SESSION 8 behavior suite.
 *
 * Tracking: composition (personalisation, link rewriting, pixel, unsubscribe
 * footer), the public endpoints (pixel, click redirect, confirmation-page
 * unsubscribe, one-click POST), abuse resistance (unknown tokens, forged link
 * ids, no open redirect, no state change on GET) and bounce evidence ingestion.
 * Run: php tests/marketing/run.php
 */

use CloudHost247\Marketing\Domain\EventType;
use CloudHost247\Marketing\Domain\SuppressionReason;
use CloudHost247\Marketing\Http\TrackController;
use CloudHost247\Marketing\Repositories\EventRepository;
use CloudHost247\Marketing\Repositories\QueueRepository;
use CloudHost247\Marketing\Repositories\SettingsRepository;
use CloudHost247\Marketing\Repositories\SuppressionRepository;
use CloudHost247\Marketing\Services\BounceParser;
use CloudHost247\Marketing\Services\QueueService;
use CloudHost247\Marketing\Services\SubscriptionService;
use CloudHost247\Marketing\Services\TrackingService;

/** Sends one campaign and returns the queue row the worker created. */
function ch247_marketing_deliver_one()
{
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingScriptedTransport();
    $graph = ch247_marketing_worker($transport);
    $fixture['service'] = $graph['service'];
    $campaign = ch247_marketing_ready_campaign($fixture, array('reader8@example.com'));
    $graph['worker']->run(array('worker' => 'test-worker'));

    $queue = new QueueRepository();
    $rows = ch247_mkt_rows('mod_cloudhost247_marketing_email_queue');
    return array('campaign' => $campaign, 'transport' => $transport, 'sent' => $transport->sent[0], 'queue' => $rows[0], 'service' => $graph['service']);
}

/** Tracking service bound to an explicit public base URL. */
function ch247_marketing_tracking($base = 'https://cloudhost247.example')
{
    $settings = new SettingsRepository();
    $settings->set('tracking_base_url', $base);
    $settings->set('company_name', 'CloudHost247');
    $settings->set('physical_address', '1 Example Way, Abuja');
    return new TrackingService(null, null, null, null, $settings);
}

return array(

// -------------------------------------------------------------- composition

'Composition personalises, rewrites links, injects the pixel and adds the unsubscribe footer' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $tracking = ch247_marketing_tracking();
    $template = (new CloudHost247\Marketing\Services\TemplateService())->save(array(
        'template_key' => 'session8-content',
        'name' => 'Session 8 content',
        'design' => array('blocks' => array(
            array('type' => 'heading', 'text' => 'Hello {{email}}', 'level' => '2', 'align' => 'left'),
            array('type' => 'button', 'label' => 'Open the portal', 'url' => 'https://cloudhost247.example/portal', 'variant' => 'primary', 'align' => 'left'),
        )),
    ))['template'];

    $graph = ch247_marketing_worker();
    $fixture['service'] = $graph['service'];
    $campaign = ch247_marketing_ready_campaign($fixture, array('reader8@example.com'), array('template_id' => (int) $template->id));
    $graph['worker']->run(array('worker' => 'test-worker', 'dry_run' => true));
    $row = ch247_mkt_rows('mod_cloudhost247_marketing_email_queue')[0];
    $campaign = (new CloudHost247\Marketing\Repositories\CampaignRepository())->find((int) $campaign->id);

    $subscriber = (new CloudHost247\Marketing\Repositories\SubscriberRepository())->findByEmail('reader8@example.com');
    $message = $tracking->compose($campaign, $row, $subscriber);
    $token = (string) $row->tracking_token;

    if (strpos($message['html'], 'Hello reader8@example.com') === false) { return false; }
    if (strpos($message['html'], str_replace('&', '&amp;', $tracking->openUrl($token))) === false) { return false; }
    if (strpos($message['html'], str_replace('&', '&amp;', $tracking->unsubscribeUrl($token))) === false) { return false; }
    if (strpos($message['text'], 'Unsubscribe: ' . $tracking->unsubscribeUrl($token)) === false) { return false; }
    if (strpos($message['html'], '1 Example Way, Abuja') === false) { return false; }
    if ($message['to'] !== 'reader8@example.com' || $message['subject'] !== 'October news') { return false; }
    if ($message['headers']['X-CloudHost247-Campaign'] !== (int) $campaign->id) { return false; }
    if ($message['headers']['List-Unsubscribe'] !== '<' . $tracking->unsubscribeUrl($token) . '>') { return false; }
    if ($message['headers']['List-Unsubscribe-Post'] !== 'List-Unsubscribe=One-Click') { return false; }

    // The button became a tracked link, and tracking URLs never name the address.
    $links = $tracking->linksFor((int) $campaign->id);
    if (count($links) !== 1 || $links[0]->url !== 'https://cloudhost247.example/portal') { return false; }
    if (strpos($message['html'], str_replace('&', '&amp;', $tracking->clickUrl($token, (int) $links[0]->id))) === false) { return false; }
    return strpos($tracking->clickUrl($token, (int) $links[0]->id), 'reader8') === false;
},

'Only http(s) links are tracked and personalisation blanks unknown tokens' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $tracking = ch247_marketing_tracking();
    $graph = ch247_marketing_worker();
    $fixture['service'] = $graph['service'];
    $campaign = ch247_marketing_ready_campaign($fixture, array('reader8@example.com'));

    // Hand-built content: one real link, one javascript: link, one mailto: link.
    $campaign = (new CloudHost247\Marketing\Repositories\CampaignRepository())->update((int) $campaign->id, array(
        'html' => '<html><body><p>Hi {{first_name}}{{unknown_token}} {{email}}</p>'
            . '<a href="https://cloudhost247.example/offers">Offers</a>'
            . '<a href="javascript:alert(1)">Bad</a>'
            . '<a href="mailto:sales@example.com">Mail</a></body></html>',
        'text' => 'Hi {{first_name}}, see https://cloudhost247.example/offers',
    ));
    $graph['worker']->run(array('worker' => 'test-worker', 'dry_run' => true));
    $row = ch247_mkt_rows('mod_cloudhost247_marketing_email_queue')[0];
    $message = $tracking->compose($campaign, $row, null);

    $unsubscribe = $tracking->unsubscribeUrl((string) $row->tracking_token);
    $escapedUnsubscribe = str_replace('&', '&amp;', $unsubscribe);
    if (strpos($message['html'], $escapedUnsubscribe) === false) { return false; }
    if (strpos($message['html'], str_replace('&', '&amp;', $tracking->clickUrl((string) $row->tracking_token, 1))) === false) { return false; } // first registered link
    if (strpos($message['html'], 'javascript:') === false) { return false; }  // left untouched, never tracked
    if (strpos($message['html'], 'href="mailto:sales@example.com"') === false) { return false; }
    if (strpos($message['html'], str_replace('&', '&amp;', $tracking->openUrl((string) $row->tracking_token))) === false) { return false; }
    if (strpos($message['html'], '1 Example Way, Abuja') === false) { return false; }
    if (strpos($message['html'], '{{unknown_token}}') !== false || strpos($message['html'], '{{email}}') !== false) { return false; }

    // Email addresses appear in the body only where the template asked for them.
    if (strpos($message['html'], 'reader8@example.com') === false) { return false; }
    if (strpos($message['text'], 'Unsubscribe: ' . $unsubscribe) === false) { return false; }
    if ($message['headers']['List-Unsubscribe'] !== '<' . $unsubscribe . '>') { return false; }
    if ($message['headers']['List-Unsubscribe-Post'] !== 'List-Unsubscribe=One-Click') { return false; }
    return count($tracking->linksFor((int) $campaign->id)) === 1;
},

'Tracking URLs never contain an address, a campaign name or a subscriber id' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $tracking = ch247_marketing_tracking();
    $graph = ch247_marketing_worker();
    $fixture['service'] = $graph['service'];
    $campaign = ch247_marketing_ready_campaign($fixture, array('reader8@example.com'));
    $graph['worker']->run(array('worker' => 'test-worker', 'dry_run' => true));
    $row = ch247_mkt_rows('mod_cloudhost247_marketing_email_queue')[0];

    $urls = array(
        $tracking->openUrl((string) $row->tracking_token),
        $tracking->unsubscribeUrl((string) $row->tracking_token),
        $tracking->clickUrl((string) $row->tracking_token, 7),
    );
    foreach ($urls as $url) {
        if (strpos($url, 'reader8') !== false || strpos($url, 'example.com') !== false) { return false; }
        if (strpos($url, 'campaign') !== false || strpos($url, 'id=') !== false) { return false; }
        if (strpos($url, 'https://cloudhost247.example/cloudhost247-marketing-track.php') !== 0) { return false; }
    }
    return (bool) preg_match('/^[a-f0-9]{32}$/', (string) $row->tracking_token);
},

'A test send carries no tracking token and says so' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $graph = ch247_marketing_worker(new CH247MarketingScriptedTransport());
    $fixture['service'] = $graph['service'];
    $campaign = $graph['service']->create(ch247_marketing_campaign_input($fixture, array('html' => '', 'text' => '')));
    $message = $graph['service']->message($campaign, 'operator@example.com', 'Test');
    if (strpos($message['subject'], '[Test] ') !== 0) { return false; }
    if (strpos($message['html'], 'marketing-track.php') !== false) { return false; }
    if (strpos($message['html'], 'Tracking is disabled for tests') === false) { return false; }
    // Nothing about a test may reach the ledger.
    return (new EventRepository())->countsFor((int) $campaign->id, EventType::OPENED) === 0;
},

// ------------------------------------------------------------------ endpoints

'The open pixel returns a gif and records exactly one open per message' => function () {
    $delivery = ch247_marketing_deliver_one();
    $controller = new TrackController(ch247_marketing_tracking());
    $token = (string) $delivery['queue']->tracking_token;

    $first = $controller->handle(array('e' => 'open', 'c' => $token), array(), 'GET');
    if ($first['status'] !== 200 || strpos($first['headers']['Content-Type'], 'image/gif') !== 0) { return false; }
    if (substr($first['body'], 0, 3) !== 'GIF') { return false; }
    if (strpos($first['headers']['Cache-Control'], 'no-store') === false) { return false; }

    $second = $controller->handle(array('e' => 'open', 'c' => $token), array(), 'GET');
    if ($second['status'] !== 200) { return false; }
    $events = new EventRepository();
    return $events->countsFor((int) $delivery['campaign']->id, EventType::OPENED) === 1;
},

'The click endpoint records the click and redirects only to a registered destination' => function () {
    $delivery = ch247_marketing_deliver_one();
    $tracking = ch247_marketing_tracking();
    $controller = new TrackController($tracking);
    $token = (string) $delivery['queue']->tracking_token;

    // Register a link the way composition does, then click it.
    $link = $tracking->registerLink((int) $delivery['campaign']->id, 'https://cloudhost247.example/offers');
    $result = $controller->handle(array('e' => 'click', 'c' => $token, 'l' => (int) $link->id), array(), 'GET');
    if ($result['status'] !== 302 || $result['redirect'] !== 'https://cloudhost247.example/offers') { return false; }
    if ($result['headers']['Location'] !== 'https://cloudhost247.example/offers') { return false; }

    // A repeat click is not a second event, but still reaches the destination.
    $again = $controller->handle(array('e' => 'click', 'c' => $token, 'l' => (int) $link->id), array(), 'GET');
    $events = new EventRepository();
    if ($again['status'] !== 302) { return false; }
    if ($events->countsFor((int) $delivery['campaign']->id, EventType::CLICKED) !== 1) { return false; }

    // A link id belonging to another campaign, or a made-up id, is a 404 — never
    // a redirect, so the endpoint cannot be turned into an open redirect.
    $foreign = $tracking->registerLink(9999, 'https://evil.example/phish');
    if ($controller->handle(array('e' => 'click', 'c' => $token, 'l' => (int) $foreign->id), array(), 'GET')['status'] !== 404) { return false; }
    if ($controller->handle(array('e' => 'click', 'c' => $token, 'l' => 987654), array(), 'GET')['status'] !== 404) { return false; }
    if ($controller->handle(array('e' => 'click', 'c' => $token, 'l' => 'https://evil.example'), array(), 'GET')['status'] !== 404) { return false; }
    return $events->countsFor((int) $delivery['campaign']->id, EventType::CLICKED) === 1;
},

'Unknown or malformed tokens get the same generic 404 and reveal nothing' => function () {
    ch247_marketing_campaign_fixture();
    $controller = new TrackController(ch247_marketing_tracking());
    $responses = array(
        $controller->handle(array('e' => 'open', 'c' => 'deadbeef'), array(), 'GET'),
        $controller->handle(array('e' => 'open', 'c' => str_repeat('a', 64)), array(), 'GET'),
        $controller->handle(array('e' => 'click', 'c' => str_repeat('a', 32), 'l' => 1), array(), 'GET'),
        $controller->handle(array('e' => 'unsubscribe', 'c' => str_repeat('a', 32)), array(), 'GET'),
        $controller->handle(array('e' => 'whatever', 'c' => 'x'), array(), 'GET'),
        $controller->handle(array(), array(), 'GET'),
    );
    foreach ($responses as $response) {
        if ($response['status'] !== 404) { return false; }
        if (stripos($response['body'], 'reader8') !== false) { return false; }
        if (stripos($response['body'], 'campaign') !== false) { return false; }
    }
    return (new EventRepository())->countsFor(0, EventType::OPENED) === 0;
},

'GET on the unsubscribe route changes nothing; POST performs the unsubscribe once' => function () {
    $delivery = ch247_marketing_deliver_one();
    $tracking = ch247_marketing_tracking();
    $controller = new TrackController($tracking);
    $token = (string) $delivery['queue']->tracking_token;
    $suppressions = new SuppressionRepository();

    // A mail scanner fetching the link must not unsubscribe anybody.
    $page = $controller->handle(array('e' => 'unsubscribe', 'c' => $token), array(), 'GET');
    if ($page['status'] !== 200 || strpos($page['body'], 'has not changed anything yet') === false) { return false; }
    if (strpos($page['body'], 'reader8@example.com') !== false) { return false; }
    if (strpos($page['body'], 'method="post"') === false) { return false; }
    if (strpos($page['body'], 'name="c"') === false) { return false; }
    if ($suppressions->isSuppressed('reader8@example.com')) { return false; }

    // The confirmation POST does it, and the address leaves every audience.
    $done = $controller->handle(array('e' => 'unsubscribe', 'c' => $token), array('c' => $token, 'e' => 'unsubscribe', 'confirm' => '1'), 'POST');
    if ($done['status'] !== 200 || strpos($done['body'], 'has been removed') === false) { return false; }
    if (!$suppressions->isSuppressed('reader8@example.com')) { return false; }

    $events = new EventRepository();
    if ($events->countsFor((int) $delivery['campaign']->id, EventType::UNSUBSCRIBED) !== 1) { return false; }

    // A second POST is idempotent: the address is already suppressed, so nothing
    // changes and the ledger is not inflated by a repeat request (SESSION 12).
    $controller->handle(array('e' => 'unsubscribe', 'c' => $token), array('confirm' => '1'), 'POST');
    return $events->countsFor((int) $delivery['campaign']->id, EventType::UNSUBSCRIBED) === 1
        && in_array('subscriber.unsubscribed', ch247_marketing_audit_actions(), true);
},

'One-click unsubscribe (RFC 8058) works from a POST without a browser session' => function () {
    $delivery = ch247_marketing_deliver_one();
    $controller = new TrackController(ch247_marketing_tracking());
    $token = (string) $delivery['queue']->tracking_token;

    $result = $controller->handle(
        array('e' => 'unsubscribe', 'c' => $token),
        array('List-Unsubscribe' => 'One-Click'),
        'POST'
    );
    if ($result['status'] !== 200 || strpos($result['body'], 'has been removed') === false) { return false; }
    return (new SuppressionRepository())->isSuppressed('reader8@example.com');
},

'A campaign that is paused or cancelled still reports opens for messages already sent' => function () {
    $delivery = ch247_marketing_deliver_one();
    (new CloudHost247\Marketing\Repositories\CampaignRepository())->setStatus((int) $delivery['campaign']->id, 'cancelled');
    $controller = new TrackController(ch247_marketing_tracking());
    $result = $controller->handle(array('e' => 'open', 'c' => (string) $delivery['queue']->tracking_token), array(), 'GET');
    return $result['status'] === 200
        && (new EventRepository())->countsFor((int) $delivery['campaign']->id, EventType::OPENED) === 1;
},

'Composition is skipped entirely when the operator turns tracking off' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $settings = new SettingsRepository();
    $settings->set('open_tracking_enabled', '0');
    $settings->set('click_tracking_enabled', '0');
    $settings->set('tracking_base_url', 'https://cloudhost247.example');
    $tracking = new TrackingService(null, null, null, null, $settings);
    $graph = ch247_marketing_worker();
    $fixture['service'] = $graph['service'];
    $campaign = ch247_marketing_ready_campaign($fixture, array('reader8@example.com'));
    $graph['worker']->run(array('worker' => 'test-worker', 'dry_run' => true));
    $row = ch247_mkt_rows('mod_cloudhost247_marketing_email_queue')[0];

    $message = $tracking->compose((new CloudHost247\Marketing\Repositories\CampaignRepository())->find((int) $campaign->id), $row, null);
    if (strpos($message['html'], 'e=open') !== false || strpos($message['html'], 'e=click') !== false) { return false; }
    if ($tracking->linksFor((int) $campaign->id) !== array()) { return false; }
    // The unsubscribe route is never optional.
    return strpos($message['text'], 'Unsubscribe: https://cloudhost247.example/cloudhost247-marketing-track.php?e=unsubscribe') !== false;
},

'Without a configured public URL the checklist refuses to send and says where to set it' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $graph = ch247_marketing_worker();
    $service = $graph['service'];
    $campaign = $service->create(ch247_marketing_campaign_input($fixture));
    $service->markReady((int) $campaign->id);

    // The operator has not filled in the public tracking URL yet.
    (new SettingsRepository())->set('tracking_base_url', '');
    $issues = $service->blockingIssues($campaign);
    if (count($issues) !== 1 || strpos($issues[0], 'Unsubscribe link') !== 0) { return false; }
    if (strpos($issues[0], 'Public tracking base URL') === false) { return false; }
    try {
        $service->schedule((int) $campaign->id, date('Y-m-d H:i:s', time() + 86400), 'UTC');
        return false;
    } catch (RuntimeException $e) {
        if (strpos($e->getMessage(), 'Unsubscribe link') === false) { return false; }
    }

    // A relative tracking URL is what the cron would otherwise produce: proof
    // that the refusal above is the only honest option.
    $tracking = new TrackingService(null, null, null, null, new SettingsRepository());
    if (strpos($tracking->unsubscribeUrl('TOKEN'), 'http') === 0) { return false; }

    // Configured again, the same campaign passes.
    (new SettingsRepository())->set('tracking_base_url', 'https://cloudhost247.example');
    return $service->blockingIssues($campaign) === array();
},

// ------------------------------------------------------------ bounce evidence

'Bounce evidence is parsed conservatively and applied through the real suppression rules' => function () {
    ch247_marketing_campaign_fixture();
    $parser = new BounceParser();

    $dsn = "Reporting-MTA: dns; mail.example.com\n\n"
        . "Final-Recipient: rfc822; hard8@example.com\nAction: failed\nStatus: 5.1.1\n"
        . "Diagnostic-Code: smtp; 550 5.1.1 User unknown\n\n"
        . "Final-Recipient: rfc822; soft8@example.com\nAction: delayed\nStatus: 4.4.1\n";
    $parsed = $parser->parse($dsn);
    if ($parsed['hard'] !== array('hard8@example.com') || $parsed['soft'] !== array('soft8@example.com')) { return false; }

    // A block with no readable recipient is reported, never guessed.
    $unreadable = $parser->parse("Something went wrong with the mail system.");
    if ($unreadable['hard'] !== array() || $unreadable['soft'] !== array()) { return false; }

    // Real-life single-block DSN with a 5xx code in the text.
    $single = $parser->parse("To: someone@example.com\nSubject: failure notice\n\n552 5.2.2 Mailbox full");
    if ($single['hard'] !== array('someone@example.com')) { return false; }

    $subscriptions = new SubscriptionService();
    $subscriptions->subscribe(array('email' => 'hard8@example.com'));
    $subscriptions->subscribe(array('email' => 'soft8@example.com'));
    $tracking = ch247_marketing_tracking();
    $hard = $tracking->recordBounce('hard8@example.com', 'hard', 'dsn');
    $soft = $tracking->recordBounce('soft8@example.com', 'soft', 'dsn');
    if (empty($hard['ok']) || empty($soft['ok'])) { return false; }

    $suppressions = new SuppressionRepository();
    if (!$suppressions->isSuppressed('hard8@example.com')) { return false; }
    if ($suppressions->isSuppressed('soft8@example.com')) { return false; } // one soft bounce is not a suppression
    $ledger = array_map(function ($row) { return (string) $row->type; }, ch247_mkt_rows('mod_cloudhost247_marketing_email_events'));
    return in_array(EventType::BOUNCED, $ledger, true)
        && count(array_keys($ledger, EventType::BOUNCED, true)) === 2;
},

'Bounce evidence ingested from the campaign screen reports what it did' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $graph = ch247_marketing_worker();
    $fixture['service'] = $graph['service'];
    $campaign = $graph['service']->create(ch247_marketing_campaign_input($fixture));
    (new SubscriptionService())->subscribe(array('email' => 'hard8@example.com'));

    $result = ch247_marketing_post('campaign', array(
        'action' => 'bounce.ingest',
        'campaign_id' => (int) $campaign->id,
        'evidence' => "Final-Recipient: rfc822; hard8@example.com\nStatus: 5.1.1\n",
    ), array('id' => (int) $campaign->id));
    if (strpos($result['notice'], '1 permanent') === false) { return false; }
    if (!(new SuppressionRepository())->isSuppressed('hard8@example.com')) { return false; }

    // Unreadable evidence changes nothing and says so.
    $empty = ch247_marketing_post('campaign', array(
        'action' => 'bounce.ingest',
        'campaign_id' => (int) $campaign->id,
        'evidence' => 'nothing to see here',
    ), array('id' => (int) $campaign->id));
    if (strpos($empty['error'], 'No recipient could be read') === false) { return false; }
    return in_array('bounce.evidence_ingested', ch247_marketing_audit_actions(), true);
},

'The worker prunes the ledger to the configured retention window' => function () {
    $delivery = ch247_marketing_deliver_one();
    $events = new EventRepository();
    $events->record(EventType::OPENED, (int) $delivery['campaign']->id, (int) $delivery['queue']->id, null, array());

    // An event older than the window is removed; the fresh one is kept.
    ch247_mkt_update_row('mod_cloudhost247_marketing_email_events', 1, array('occurred_at' => date('Y-m-d H:i:s', time() - 400 * 86400)));
    $settings = new SettingsRepository();
    $worker = new QueueService(null, null, null, null, null, null, null, $settings);
    $before = count(ch247_mkt_rows('mod_cloudhost247_marketing_email_events'));
    $removed = $worker->pruneEvents();
    $after = count(ch247_mkt_rows('mod_cloudhost247_marketing_email_events'));
    return $removed === 1 && $after === $before - 1;
},

);
