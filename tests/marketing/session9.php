<?php
/**
 * CloudHost247 Marketing — SESSION 9 behavior suite.
 *
 * Analytics: every figure counted from the ledger, rates that refuse to invent a
 * denominator, the click map, per-recipient activity, timeline bucketing, and the
 * reporting screen itself (including its read-only nature).
 * Run: php tests/marketing/run.php
 */

use CloudHost247\Marketing\Domain\EventType;
use CloudHost247\Marketing\Repositories\CampaignRepository;
use CloudHost247\Marketing\Repositories\EventRepository;
use CloudHost247\Marketing\Repositories\SettingsRepository;
use CloudHost247\Marketing\Services\AnalyticsService;
use CloudHost247\Marketing\Services\TrackingService;

/** Sends one campaign to $addresses and returns the campaign + transport. */
function ch247_marketing_analytics_delivery(array $addresses, array $overrides = array())
{
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingScriptedTransport();
    $graph = ch247_marketing_worker($transport);
    $fixture['service'] = $graph['service'];
    $campaign = ch247_marketing_ready_campaign($fixture, $addresses, $overrides);
    $graph['worker']->run(array('worker' => 'analytics'));
    return array('campaign' => $campaign, 'transport' => $transport, 'service' => $graph['service']);
}

/** Records an open / click / unsubscribe for the first queue row of a campaign. */
function ch247_marketing_analytics_event($campaignId, $type, array $meta = array())
{
    $rows = ch247_mkt_rows('mod_cloudhost247_marketing_email_queue');
    foreach ($rows as $row) {
        if ((int) $row->campaign_id === (int) $campaignId) {
            return (new EventRepository())->record($type, (int) $campaignId, (int) $row->id, $row->subscriber_id, $meta);
        }
    }
    return null;
}

return array(

'A campaign summary counts the ledger and only the ledger' => function () {
    $delivery = ch247_marketing_analytics_delivery(array('a9@example.com', 'b9@example.com', 'c9@example.com'));
    $campaignId = (int) $delivery['campaign']->id;
    ch247_marketing_analytics_event($campaignId, EventType::OPENED);
    ch247_marketing_analytics_event($campaignId, EventType::CLICKED, array('link_id' => 1));

    $summary = (new AnalyticsService())->campaignSummary($campaignId);
    if ($summary['audience_size'] !== 3) { return false; }
    if ($summary['counts']['accepted'] !== 3) { return false; }
    if ($summary['counts']['opened'] !== 1 || $summary['counts']['clicked'] !== 1) { return false; }
    if ($summary['counts']['failed'] !== 0 || $summary['counts']['queued'] !== 0) { return false; }
    // One open and one click out of three accepted messages.
    if ($summary['rates']['open'] !== 33.3 || $summary['rates']['click'] !== 33.3) { return false; }
    if ($summary['rates']['click_to_open'] !== 100.0) { return false; }
    if ($summary['rates']['unsubscribe'] !== 0.0) { return false; } // 0 of 3 is a real 0%

    // The notes travel with the numbers: no screen can show an open rate without
    // the caveat that it is a pixel event.
    if (strpos(implode(' ', $summary['notes']), 'pixel') === false) { return false; }
    return (new AnalyticsService())->campaignSummary(999999) === null;
},

'Rates refuse to invent a denominator' => function () {
    ch247_marketing_campaign_fixture();
    $analytics = new AnalyticsService();

    // Nothing accepted yet: the rate is unknown, not 0%.
    if ($analytics->rate(0, 0) !== null) { return false; }
    if ($analytics->rate(5, 0) !== null) { return false; }
    if ($analytics->formatRate(null) !== '—') { return false; }
    if ($analytics->rate(1, 4) !== 25.0) { return false; }
    if ($analytics->formatRate(25.0) !== '25.0%') { return false; }

    // A campaign that is still a draft reports unknown rates, not zero rates.
    $graph = ch247_marketing_worker();
    $fixture = ch247_marketing_campaign_fixture();
    $campaign = $graph['service']->create(ch247_marketing_campaign_input($fixture));
    $summary = $analytics->campaignSummary((int) $campaign->id);
    return $summary['counts']['accepted'] === 0
        && $summary['rates']['open'] === null
        && $summary['rates']['click'] === null
        && $summary['audience_size'] === 0;
},

'The click map groups clicks by registered link and reports unattributable ones' => function () {
    $delivery = ch247_marketing_analytics_delivery(array('a9@example.com', 'b9@example.com'));
    $campaignId = (int) $delivery['campaign']->id;
    $tracking = ch247_marketing_tracking();
    $first = $tracking->registerLink($campaignId, 'https://cloudhost247.example/one');
    $second = $tracking->registerLink($campaignId, 'https://cloudhost247.example/two');

    ch247_marketing_analytics_event($campaignId, EventType::CLICKED, array('link_id' => (int) $first->id));
    ch247_marketing_analytics_event($campaignId, EventType::CLICKED, array('link_id' => (int) $first->id));
    ch247_marketing_analytics_event($campaignId, EventType::CLICKED, array('link_id' => (int) $second->id));
    ch247_marketing_analytics_event($campaignId, EventType::CLICKED, array('link_id' => 98765));

    $map = (new AnalyticsService())->clickMap($campaignId);
    if ($map['total_clicks'] !== 3 && $map['total_clicks'] !== 4) { return false; }
    if ($map['unattributed'] !== 1) { return false; }
    if ($map['links'][0]['url'] !== 'https://cloudhost247.example/one' || $map['links'][0]['clicks'] !== 2) { return false; }
    if ($map['links'][1]['clicks'] !== 1) { return false; }
    return $map['total_clicks'] === $map['links'][0]['clicks'] + $map['links'][1]['clicks'];
},

'Recipient activity is per message, bounded, and never invents an event' => function () {
    $delivery = ch247_marketing_analytics_delivery(array('a9@example.com', 'b9@example.com'));
    $campaignId = (int) $delivery['campaign']->id;
    $rows = ch247_mkt_rows('mod_cloudhost247_marketing_email_queue');
    $firstRow = $rows[0];

    (new EventRepository())->record(EventType::OPENED, $campaignId, (int) $firstRow->id, null, array());
    ch247_marketing_analytics_event($campaignId, EventType::CLICKED, array('link_id' => 1));

    $activity = (new AnalyticsService())->recipientActivity($campaignId, 10);
    if (count($activity) !== 2) { return false; }
    $byEmail = array();
    foreach ($activity as $entry) {
        $byEmail[$entry['email']] = $entry;
        if ($entry['status'] !== 'sent' || $entry['accepted_at'] === '') { return false; }
    }
    $totalOpens = (int) $byEmail['a9@example.com']['opens'] + (int) $byEmail['b9@example.com']['opens'];
    if ($totalOpens !== 1) { return false; }
    // Bounding works: asking for one row returns exactly one.
    $bounded = (new AnalyticsService())->recipientActivity($campaignId, 1);
    if (count($bounded) !== 1) { return false; }

    // An event for a campaign nobody sent does not appear anywhere.
    (new EventRepository())->record(EventType::OPENED, 424242, 424242, null, array());
    $empty = (new AnalyticsService())->recipientActivity(424242, 10);
    return $empty === array();
},

'The timeline buckets by day and fills quiet days with zeroes' => function () {
    $delivery = ch247_marketing_analytics_delivery(array('a9@example.com'));
    $campaignId = (int) $delivery['campaign']->id;
    ch247_marketing_analytics_event($campaignId, EventType::OPENED);
    ch247_marketing_analytics_event($campaignId, EventType::CLICKED, array('link_id' => 1));

    $timeline = (new AnalyticsService())->timeline($campaignId, 7);
    if (count($timeline) !== 7) { return false; }
    $today = $timeline[6];
    if ($today['day'] !== date('Y-m-d')) { return false; }
    if ((int) $today['sent'] !== 1 || (int) $today['opened'] !== 1 || (int) $today['clicked'] !== 1) { return false; }
    // Yesterday was quiet and says so, rather than being omitted.
    if ((int) $timeline[5]['sent'] !== 0 || (int) $timeline[5]['opened'] !== 0) { return false; }
    return (int) $today['failed'] === 0;
},

'The deployment overview aggregates a rolling window and names deleted campaigns' => function () {
    $delivery = ch247_marketing_analytics_delivery(array('a9@example.com', 'b9@example.com'));
    ch247_marketing_analytics_event((int) $delivery['campaign']->id, EventType::OPENED);

    $analytics = new AnalyticsService();
    $recent = $analytics->overview(30);
    if ((int) $recent['totals'][EventType::SENT] !== 2) { return false; }
    if ((int) $recent['totals'][EventType::OPENED] !== 1) { return false; }
    if ($recent['rates']['open'] !== 50.0) { return false; }
    if ($recent['campaigns'][0]['name'] !== 'October newsletter') { return false; }
    if ($recent['days'] !== 30 || $recent['window_start'] === '') { return false; }

    // An event outside the window must not be counted: age the accepted rows
    // back beyond the window and the totals drop accordingly.
    $events = ch247_mkt_rows('mod_cloudhost247_marketing_email_events');
    foreach ($events as $event) {
        if ((string) $event->type === EventType::SENT) {
            ch247_mkt_update_row('mod_cloudhost247_marketing_email_events', (int) $event->id, array(
                'occurred_at' => date('Y-m-d H:i:s', time() - 100 * 86400),
            ));
        }
    }
    $aged = $analytics->overview(30);
    if ((int) $aged['totals'][EventType::SENT] !== 0) { return false; }
    if ((int) $aged['totals'][EventType::OPENED] !== 1) { return false; } // the open is still today
    if ($aged['rates']['open'] !== null) { return false; }               // and now has no denominator
    if ($aged['campaigns'][0]['accepted'] !== 0) { return false; }

    // Widen the window and the accepted messages come back; a 365-day window
    // cannot be fooled into counting them twice.
    $wide = $analytics->overview(365);
    return (int) $wide['totals'][EventType::SENT] === 2 && $wide['rates']['open'] === 50.0;
},

'The analytics screen renders every section and is read-only' => function () {
    $delivery = ch247_marketing_analytics_delivery(array('a9@example.com'));
    $campaignId = (int) $delivery['campaign']->id;
    $tracking = ch247_marketing_tracking();
    $link = $tracking->registerLink($campaignId, 'https://cloudhost247.example/one');
    ch247_marketing_analytics_event($campaignId, EventType::CLICKED, array('link_id' => (int) $link->id));

    $before = array(
        'events' => count(ch247_mkt_rows('mod_cloudhost247_marketing_email_events')),
        'links' => count(ch247_mkt_rows('mod_cloudhost247_marketing_links')),
    );

    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET = array('view' => 'analytics', 'campaign_id' => $campaignId, 'days' => 30);
    $_POST = array(); $_REQUEST = array();
    $data = (new CloudHost247\Marketing\Http\AdminController())->handle();
    if ($data['view'] !== 'analytics' || (int) $data['plannedSession'] !== 0) { return false; }
    if (empty($data['analyticsView']['summary'])) { return false; }
    if ($data['analyticsView']['summary']['rates']['click'] !== 100.0) { return false; }

    ob_start();
    try { (new CloudHost247\Marketing\Http\AdminView())->render($data); } catch (\Throwable $error) { ob_end_clean(); throw $error; }
    $html = ob_get_clean();
    foreach (array('Delivery analytics', 'Click map', 'Recipient activity', 'Daily activity', 'Campaign states', 'accepted by the relay') as $needle) {
        if (stripos($html, $needle) === false) { return false; }
    }
    if (strpos($html, 'cloudhost247.example/one') === false) { return false; }
    if (strpos($html, 'Fatal error') !== false) { return false; }

    // Reading a report never writes to the ledger or to the link table.
    return $before['events'] === count(ch247_mkt_rows('mod_cloudhost247_marketing_email_events'))
        && $before['links'] === count(ch247_mkt_rows('mod_cloudhost247_marketing_links'));
},

'Deployment-wide reporting works with no campaigns at all, without dividing by zero' => function () {
    ch247_marketing_campaign_fixture();
    $_SERVER['REQUEST_METHOD'] = 'GET';

    $_GET = array('view' => 'analytics');
    $_POST = array(); $_REQUEST = array();
    $data = (new CloudHost247\Marketing\Http\AdminController())->handle();
    $overview = $data['analyticsView']['overview'];
    if ((int) $overview['totals'][EventType::SENT] !== 0) { return false; }
    if ($overview['rates']['open'] !== null || $overview['rates']['click'] !== null) { return false; }
    if ($data['analyticsView']['summary'] !== null) { return false; }

    ob_start();
    (new CloudHost247\Marketing\Http\AdminView())->render($data);
    $html = ob_get_clean();
    if (strpos($html, 'Delivery analytics') === false) { return false; }
    return strpos($html, '—') !== false; // unknown rates render as a dash, never 0%
},

'The dashboard carries a 30-day panel taken from the same ledger' => function () {
    ch247_marketing_campaign_fixture();
    $delivery = ch247_marketing_analytics_delivery(array('a9@example.com'));
    ch247_marketing_analytics_event((int) $delivery['campaign']->id, EventType::OPENED);

    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET = array('view' => 'dashboard');
    $_POST = array(); $_REQUEST = array();
    $data = (new CloudHost247\Marketing\Http\AdminController())->handle();
    ob_start();
    (new CloudHost247\Marketing\Http\AdminView())->render($data);
    $html = ob_get_clean();
    return strpos($html, 'Last 30 days') !== false && strpos($html, 'Analytics tab') !== false;
},

'Analytics never writes: the service only reads tables it does not own' => function () {
    $source = file_get_contents(dirname(dirname(__DIR__)) . '/modules/addons/cloudhost247_marketing/lib/Services/AnalyticsService.php');
    foreach (array('->insert(', '->insertGetId(', '->update(', '->delete(', '->drop(') as $write) {
        if (strpos($source, $write) !== false) { return false; }
    }
    // It must not reach for WHMCS core tables either.
    return strpos($source, "Capsule::table('tbl") === false && strpos($source, 'tblclients') === false;
},

);
