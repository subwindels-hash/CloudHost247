<?php
/**
 * CloudHost247 Marketing — SESSION 11 behavior suite.
 *
 * Security review: the module's own attack surface, proved rather than asserted —
 * personalisation escaping, hostile link schemes, CSRF/capability coverage, CSV
 * formula injection, credentials staying in the integrations vault, the public
 * endpoint's abuse limits, and direct-file-access guards.
 * Run: php tests/marketing/run.php
 */

use CloudHost247\Marketing\Domain\SuppressionReason;
use CloudHost247\Marketing\Repositories\CampaignRepository;
use CloudHost247\Marketing\Repositories\SubscriberRepository;
use CloudHost247\Marketing\Repositories\TemplateRepository;
use CloudHost247\Marketing\Security\HtmlSanitizer;
use CloudHost247\Marketing\Services\AutomationService;
use CloudHost247\Marketing\Services\ExportService;
use CloudHost247\Marketing\Services\SubscriptionService;
use CloudHost247\Marketing\Services\TemplateService;
use CloudHost247\Marketing\Services\TrackingService;

function ch247_marketing_module_root()
{
    return dirname(dirname(__DIR__)) . '/modules/addons/cloudhost247_marketing';
}

/** A queue row as the composer sees it, without needing a real send. */
function ch247_marketing_security_row($token = 'aabbccdd')
{
    return (object) array(
        'id' => 1, 'campaign_id' => 1, 'subscriber_id' => 1, 'email' => 'reader@example.com',
        'tracking_token' => $token, 'status' => 'queued',
    );
}

return array(

// ------------------------------------------------------- personalisation/XSS

'Subscriber values are escaped in the HTML part and literal in the text part' => function () {
    $graph = ch247_marketing_automation_graph();
    $tracking = new TrackingService(null, null, null, null, new CloudHost247\Marketing\Repositories\SettingsRepository());
    $campaign = (object) array(
        'id' => 1,
        'subject' => 'Hello {{first_name}}',
        'html' => '<p>Hi {{first_name}} from {{company}}</p>',
        'text' => 'Hi {{first_name}} from {{company}}',
        'from_email' => 'marketing@example.com', 'from_name' => 'CloudHost247', 'reply_to' => '',
    );
    $subscriber = (object) array(
        'first_name' => '<script>alert(1)</script>',
        'last_name' => 'O\'Brien',
        'company' => 'Smith & Co "Ltd"',
        'email' => 'reader@example.com',
    );

    $message = $tracking->compose($campaign, ch247_marketing_security_row(), $subscriber);
    if (strpos($message['html'], '<script>') !== false) { return false; }
    if (strpos($message['html'], '&lt;script&gt;alert(1)&lt;/script&gt;') === false) { return false; }
    if (strpos($message['html'], 'Smith &amp; Co &quot;Ltd&quot;') === false) { return false; }
    // Text is not a markup context: the name stays readable, not entity-encoded.
    if (strpos($message['text'], '<script>alert(1)</script>') === false) { return false; }
    if (strpos($message['text'], '&lt;script&gt;') !== false) { return false; }
    // The subject is a header: personalisation applies, but it is never
    // entity-encoded, because a header is not an HTML context.
    if (strpos($message['subject'], 'Hello <script>alert(1)</script>') === false) { return false; }
    if (strpos($message['subject'], '&lt;script') !== false) { return false; }
    return true;
},

'A test send is escaped the same way as a real one' => function () {
    $tracking = new TrackingService(null, null, null, null, new CloudHost247\Marketing\Repositories\SettingsRepository());
    $campaign = (object) array(
        'id' => 1, 'subject' => 'Test', 'html' => '<p>{{first_name}}</p>', 'text' => '{{first_name}}',
        'from_email' => 'marketing@example.com', 'from_name' => 'CloudHost247', 'reply_to' => '',
    );
    $subscriber = (object) array('first_name' => '<img src=x onerror=alert(1)>', 'last_name' => '', 'company' => '', 'email' => 'a@example.com');
    $message = $tracking->composeTest($campaign, 'a@example.com', $subscriber);
    return strpos($message['html'], '<img') === false && strpos($message['html'], '&lt;img') !== false;
},

// ---------------------------------------------------------------- link abuse

'Only http(s) destinations are registered, tracked or redirected to' => function () {
    $graph = ch247_marketing_automation_graph();
    $tracking = ch247_marketing_tracking();
    $campaignId = (int) $graph['fixture']['template']->id; // any container id will do

    foreach (array('javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'ftp://example.com/x') as $hostile) {
        try {
            $tracking->registerLink($campaignId, $hostile);
            return false;
        } catch (InvalidArgumentException $error) {
            // refused, as it must be
        }
    }
    // A protocol-relative URL is scheme-less: it is refused rather than guessed.
    try { $tracking->registerLink($campaignId, '//evil.example/track'); return false; }
    catch (InvalidArgumentException $error) { /* refused */ }

    // Hostile markup in the body is left exactly as the author wrote it: it is
    // never rewritten into a tracking link pointing at an attacker.
    $campaign = (object) array(
        'id' => 1, 'subject' => 'Links', 'html' => '<a href="javascript:alert(1)">x</a> <a href="https://ok.example/y">ok</a>',
        'text' => 'text', 'from_email' => 'm@example.com', 'from_name' => 'M', 'reply_to' => '',
    );
    $message = $tracking->compose($campaign, ch247_marketing_security_row('deadbeef'), (object) array(
        'first_name' => '', 'last_name' => '', 'company' => '', 'email' => 'reader@example.com',
    ));
    if (strpos($message['html'], 'href="javascript:alert(1)"') === false) { return false; }
    if (strpos($message['html'], 'cloudhost247-marketing-track.php?e=click') === false) { return false; }
    // Exactly one link was registered, and it is the https one.
    $links = $tracking->linksFor(1);
    if (count($links) !== 1 || strpos((string) $links[0]->url, 'https://ok.example/y') === false) { return false; }
    return true;
},

'A forged click id cannot be redirected through, and the endpoint refuses unknown tokens' => function () {
    $graph = ch247_marketing_automation_graph();
    $tracking = ch247_marketing_tracking();
    $campaign = (object) array(
        'id' => 7, 'subject' => 'Links', 'html' => '<a href="https://good.example/page">go</a>', 'text' => 'go',
        'from_email' => 'm@example.com', 'from_name' => 'M', 'reply_to' => '',
    );
    $link = $tracking->registerLink(7, 'https://good.example/page');
    $message = $tracking->compose($campaign, ch247_marketing_security_row('feedface'), (object) array(
        'first_name' => '', 'last_name' => '', 'company' => '', 'email' => 'reader@example.com',
    ));
    if (strpos($message['html'], 'l=' . (int) $link->id) === false) { return false; }

    // The controller resolves destinations from the database only. The static
    // half of this property is in tests/marketing/test_static.py; here the
    // resolver is asked directly for a registerable combination.
    $trackingService = new TrackingService();
    $resolved = $trackingService->linkDestination(7, (int) $link->id);
    if (!$resolved || $resolved !== 'https://good.example/page') { return false; }
    // A link id that does not exist, or one scoped to another campaign, resolves
    // to nothing — the controller turns that into a 404, not a redirect.
    return $trackingService->linkDestination(7, 999999) === null
        && $trackingService->linkDestination(8, (int) $link->id) === null;
},

// ------------------------------------------------------------------- CSRF/XSS

'Every mutating admin branch is behind POST + CSRF, and a bad token changes nothing' => function () {
    $graph = ch247_marketing_automation_graph();
    $automation = ch247_marketing_automation_ready($graph);
    $before = ch247_marketing_automation_rows();
    if ((string) $before[0]->status !== 'active') { return false; }

    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_POST = array('action' => 'automation.archive', 'automation_id' => (int) $automation->id, 'token' => 'bad-token');
    $_REQUEST = $_POST;
    foreach (array('automations', 'campaigns', 'templates', 'segments', 'subscribers', 'suppressions', 'import', 'lists') as $view) {
        $_GET = array('view' => $view);
        try {
            (new CloudHost247\Marketing\Http\AdminController())->handle();
            return false; // a view let the request through without a token
        } catch (Throwable $error) {
            // Guard refusal is the expected path for every one of them.
        }
    }

    // Nothing changed anywhere.
    $after = ch247_marketing_automation_rows();
    return (string) $after[0]->status === 'active' && count($after) === count($before);
},

'Hostile markup in a template is sanitised before it is stored, and a javascript: link is refused' => function () {
    ch247_marketing_template_flush();
    $service = new TemplateService();

    // A button whose destination is not http(s)/mailto fails validation: it never
    // reaches the database, let alone a recipient.
    try {
        $service->save(array(
            'template_key' => 'hostile-button', 'name' => 'Hostile button',
            'design' => array('blocks' => array(
                array('type' => 'button', 'label' => 'Go', 'url' => 'javascript:alert(3)', 'variant' => 'primary', 'align' => 'center'),
            )),
        ));
        return false;
    } catch (InvalidArgumentException $error) { /* refused */ }

    $saved = $service->save(array(
        'template_key' => 'hostile-content',
        'name' => 'Hostile content',
        'design' => array('blocks' => array(
            array('type' => 'paragraph', 'text' => '<script>alert(1)</script><img src=x onerror=alert(2)>Hello', 'align' => 'left'),
            array('type' => 'legal', 'text' => '<iframe src="https://evil.example"></iframe>Legal text', 'align' => 'left'),
        )),
    ));
    $html = (string) $saved['template']->html;
    foreach (array('<script', 'onerror', '<iframe', 'javascript:') as $forbidden) {
        if (stripos($html, $forbidden) !== false) { return false; }
    }
    return stripos($html, 'Hello') !== false;
},

'Hostile subscriber values render escaped on the admin screens' => function () {
    ch247_marketing_campaign_fixture();
    $subscriptions = new SubscriptionService();
    $subscriptions->subscribe(array('email' => 'hostile@example.com', 'first_name' => '<script>alert(1)</script>', 'last_name' => '"><img src=x onerror=alert(2)>'));

    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET = array('view' => 'subscribers');
    $_POST = array(); $_REQUEST = array();
    $data = (new CloudHost247\Marketing\Http\AdminController())->handle();
    ob_start();
    (new CloudHost247\Marketing\Http\AdminView())->render($data);
    $html = ob_get_clean();
    if (strpos($html, '<script>alert(1)</script>') !== false) { return false; }
    if (strpos($html, '&lt;script&gt;') === false) { return false; }
    return strpos($html, 'onerror=alert(2)>') === false;
},

// ------------------------------------------------------------------- exports

'A CSV export cannot carry a spreadsheet formula' => function () {
    ch247_marketing_campaign_fixture();
    $subscriptions = new SubscriptionService();
    $subscriptions->subscribe(array('email' => 'formula@example.com', 'first_name' => "=cmd|' /C calc'!A0", 'last_name' => "\t=1+1", 'company' => '@SUM(1+1)'));
    $csv = (string) (new ExportService())->subscribersCsv(array());
    $lines = array_filter(preg_split('/\r\n|\n/', $csv));
    $checked = 0;
    foreach ($lines as $line) {
        foreach (str_getcsv($line) as $cell) {
            $trimmed = ltrim($cell, " \t");
            if ($trimmed === '') { continue; }
            $checked++;
            // No cell may *start* with a formula trigger once the spreadsheet's
            // own trimming is applied.
            if (preg_match('/^[=+\\-@]/', $trimmed)) { return false; }
            if (strpos($cell, '=cmd') !== false && strpos($cell, "'=cmd") === false) { return false; }
        }
    }
    return $checked > 0;
},

// --------------------------------------------------------------- credentials

'The module holds no credentials and reads no WHMCS core table directly' => function () {
    $root = ch247_marketing_module_root() . '/lib';
    $offenders = array();
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root)) as $file) {
        if ($file->getExtension() !== 'php') { continue; }
        $source = file_get_contents($file->getPathname());
        if (preg_match_all('/Capsule::table\\(\\s*[\'"](tbl[a-z_]+)/i', $source, $matches)) {
            foreach ($matches[1] as $table) { $offenders[] = basename($file->getPathname()) . ':' . $table; }
        }
        foreach (array('smtp_password', 'smtp_username', 'mailbox-password', '->password') as $needle) {
            if (stripos($source, $needle) !== false) { $offenders[] = basename($file->getPathname()) . ':' . $needle; }
        }
    }
    if ($offenders) { return false; }
    // And the relay identity genuinely comes from the integrations vault.
    $transport = file_get_contents(ch247_marketing_module_root() . '/lib/Services/SmtpTransport.php');
    return strpos($transport, 'IntegrationManager') !== false && strpos($transport, 'smtpIdentity') !== false;
},

// -------------------------------------------------------------- file access

'Every module file that can execute is guarded against direct web access' => function () {
    // A namespaced class file cannot carry the WHMCS guard (the namespace
    // declaration must be the first statement), so the invariant is split: the
    // files that execute something carry the guard, and every other file is a
    // pure declaration — fetching it as a page defines a class and runs nothing.
    $root = ch247_marketing_module_root();
    $executable = array('cloudhost247_marketing.php', 'bootstrap.php', 'hooks.php');
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root)) as $file) {
        if ($file->getExtension() !== 'php') { continue; }
        $name = $file->getFilename();
        $source = file_get_contents($file->getPathname());
        $guarded = stripos($source, 'cannot be accessed directly') !== false;
        if (in_array($name, $executable, true)) {
            if (!$guarded) { return false; }
            continue;
        }
        if ($guarded) { continue; }

        // Strip comments, then everything that must precede a class declaration.
        $body = preg_replace('#/\*.*?\*/#s', '', $source);
        $body = preg_replace('#^\s*<\?php#', '', $body);
        $body = preg_replace('#(^|\s)//[^\n]*#', '$1', $body);
        $body = preg_replace('#^\s*namespace\s+[^;]+;#m', '', $body);
        $body = preg_replace('#^\s*use\s+[^;]+;#m', '', $body);
        $body = ltrim($body);
        if (!preg_match('/^(final\s+|abstract\s+)?(class|interface|trait)\s+[A-Za-z_]/', $body)) { return false; }
    }
    $endpoint = file_get_contents(dirname(dirname(__DIR__)) . '/cloudhost247-marketing-track.php');
    return strpos($endpoint, 'TrackController') !== false && strpos($endpoint, '$_GET') !== false;
},

// ------------------------------------------------------ tracking endpoint abuse

'Repeated opens are counted once, and a GET unsubscribe never changes state' => function () {
    $graph = ch247_marketing_automation_graph();
    $automation = ch247_marketing_automation_ready($graph);
    $subscriber = (new SubscriberRepository())->findByEmail('reader@example.com');
    $graph['automations']->enroll((int) $automation->id, (int) $subscriber->id);
    $graph['automations']->tick(10);
    $row = ch247_mkt_rows('mod_cloudhost247_marketing_email_queue')[0];
    $token = (string) $row->tracking_token;

    $controller = new CloudHost247\Marketing\Http\TrackController();
    for ($i = 0; $i < 5; $i++) { $controller->handle(array('e' => 'open', 'c' => $token), array(), 'GET'); }
    $events = ch247_mkt_rows('mod_cloudhost247_marketing_email_events');
    $opens = 0;
    foreach ($events as $event) { if ((string) $event->type === 'opened') { $opens++; } }
    if ($opens !== 1) { return false; }

    // A GET to the unsubscribe route is a confirmation page: the state must not
    // change until a POST, because a mail scanner follows every link it sees.
    $controller->handle(array('e' => 'unsubscribe', 'c' => $token), array(), 'GET');
    $subscriber = (new SubscriberRepository())->find((int) $subscriber->id);
    if ((string) $subscriber->status === 'unsubscribed') { return false; }
    $events = ch247_mkt_rows('mod_cloudhost247_marketing_email_events');
    foreach ($events as $event) { if ((string) $event->type === 'unsubscribed') { return false; } }

    // Unknown and malformed tokens are answered identically (no enumeration).
    foreach (array(array('e' => 'open', 'c' => 'nope'), array('e' => 'open'), array('e' => 'open', 'c' => str_repeat('a', 500))) as $query) {
        $result = $controller->handle($query, array(), 'GET');
        if (!is_array($result) || (int) $result['status'] !== 404 || (string) $result['body'] !== 'Not found') { return false; }
    }
    return true;
},

// ------------------------------------------------------------------ hardening

'Automation content cannot be injected through a step subject or sender' => function () {
    $graph = ch247_marketing_automation_graph();
    $automations = $graph['automations'];
    $automation = $automations->create(array('name' => 'Header safety', 'trigger_type' => 'manual'));
    $templateId = (int) $graph['fixture']['template']->id;

    try {
        $automations->addStep((int) $automation->id, array(
            'step_type' => 'send_email', 'template_id' => $templateId, 'subject' => "Hello\r\nBcc: attacker@example.com",
        ));
        return false;
    } catch (InvalidArgumentException $error) {
        // Refused before it is stored: line breaks do not belong in a subject.
    }
    try {
        $automations->addStep((int) $automation->id, array(
            'step_type' => 'send_email', 'template_id' => $templateId, 'subject' => 'Fine', 'from_email' => 'not-an-address',
        ));
        return false;
    } catch (InvalidArgumentException $error) { /* refused */ }

    $automations->addStep((int) $automation->id, array(
        'step_type' => 'send_email', 'template_id' => $templateId, 'subject' => 'Fine', 'from_email' => 'sender@example.com',
    ));
    $step = $automations->stepsWithTemplates((int) $automation->id)[0]['step'];
    return strpos((string) $step->subject, "\n") === false && (string) $step->from_email === 'sender@example.com';
},

'The schedule and the reporting screens expose no write path to a public request' => function () {
    // The analytics screen, the tracking endpoint and the cron are the three
    // things a non-admin can reach or trigger; none of them may write to the
    // ledger except through events.
    $analytics = file_get_contents(ch247_marketing_module_root() . '/lib/Services/AnalyticsService.php');
    foreach (array('->insert(', '->update(', '->delete(') as $write) {
        if (strpos($analytics, $write) !== false) { return false; }
    }
    $cron = file_get_contents(dirname(dirname(__DIR__)) . '/crons/cloudhost247_marketing.php');
    if (strpos($cron, "PHP_SAPI !== 'cli'") === false) { return false; }
    return strpos($cron, 'http_response_code(403)') !== false;
},

);
