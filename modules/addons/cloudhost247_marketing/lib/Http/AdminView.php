<?php
namespace CloudHost247\Marketing\Http;

use CloudHost247\Marketing\Domain\CampaignStatus;
use CloudHost247\Marketing\Domain\ConsentStatus;
use CloudHost247\Marketing\Domain\QueueStatus;
use CloudHost247\Marketing\Domain\AutomationRunStatus;
use CloudHost247\Marketing\Domain\AutomationStatus;
use CloudHost247\Marketing\Domain\AutomationStepType;
use CloudHost247\Marketing\Domain\AutomationTrigger;
use CloudHost247\Marketing\Domain\CampaignAudience;
use CloudHost247\Marketing\Domain\EventType;
use CloudHost247\Marketing\Domain\SegmentField;
use CloudHost247\Marketing\Services\AnalyticsService;
use CloudHost247\Marketing\Domain\TemplateBlock;
use CloudHost247\Marketing\Domain\SegmentOperator;
use CloudHost247\Marketing\Domain\SubscriberSource;
use CloudHost247\Marketing\Domain\SubscriberStatus;
use CloudHost247\Marketing\Domain\SuppressionReason;

/** WHMCS-admin-markup renderer (same conventions as the other first-party modules). */
final class AdminView
{
    private function e($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }

    private function token()
    {
        return function_exists('generate_token') ? generate_token('plain') : '';
    }

    /** The module's own version, so the header can never drift from the file. */
    private function version()
    {
        if (function_exists('cloudhost247_marketing_config')) {
            $config = cloudhost247_marketing_config();
            if (isset($config['version'])) { return (string) $config['version']; }
        }
        return '1.2.0';
    }

    private function base($view = '', array $query = array())
    {
        $url = 'addonmodules.php?module=cloudhost247_marketing';
        if ($view !== '') { $url .= '&amp;view=' . urlencode($view); }
        foreach ($query as $key => $value) {
            if ($value === '' || $value === null) { continue; }
            $url .= '&amp;' . urlencode((string) $key) . '=' . urlencode((string) $value);
        }
        return $url;
    }

    public function render(array $data)
    {
        echo '<h2>CloudHost247 Marketing <small style="font-size:12px;">v' . $this->e($this->version()) . ' — queue-based campaigns via cPanel SMTP</small></h2>';
        if ($data['error'] !== '') { echo '<div class="alert alert-danger">' . $this->e($data['error']) . '</div>'; }
        if ($data['notice'] !== '') { echo '<div class="alert alert-success">' . $this->e($data['notice']) . '</div>'; }

        $tabs = array(
            'dashboard' => array('Dashboard', ''),
            'campaigns' => array('Campaigns', 'campaigns'),
            'analytics' => array('Analytics', 'analytics'),
            'automations' => array('Automations', 'automations'),
            'subscribers' => array('Subscribers', 'subscribers'),
            'segments' => array('Segments', 'segments'),
            'templates' => array('Templates', 'templates'),
            'lists' => array('Lists', 'lists'),
            'import' => array('Import', 'import'),
            'suppressions' => array('Suppression List', 'suppressions'),
            'settings' => array('Delivery Settings', 'settings'),
        );
        $aliases = array(
            'campaign' => 'campaigns',
            'subscriber' => 'subscribers',
            'segment' => 'segments',
            'template' => 'templates',
        );
        $active = isset($aliases[$data['view']]) ? $aliases[$data['view']] : $data['view'];
        echo '<ul class="nav nav-tabs" role="tablist">';
        foreach ($tabs as $key => $tab) {
            echo '<li role="presentation" class="' . ($active === $key ? 'active' : '') . '"><a href="' . $this->base($tab[1]) . '">' . $this->e($tab[0]) . '</a></li>';
        }
        echo '</ul><div style="margin-top:14px;">';

        if ($data['view'] === 'settings') { $this->renderSettings($data); }
        elseif ($data['view'] === 'subscribers') { $this->renderSubscribers($data); }
        elseif ($data['view'] === 'subscriber') { $this->renderSubscriberDetail($data); }
        elseif ($data['view'] === 'lists') { $this->renderLists($data); }
        elseif ($data['view'] === 'import') { $this->renderImport($data); }
        elseif ($data['view'] === 'suppressions') { $this->renderSuppressions($data); }
        elseif ($data['view'] === 'segments') { $this->renderSegments($data); }
        elseif ($data['view'] === 'segment') { $this->renderSegmentDetail($data); }
        elseif ($data['view'] === 'analytics') { $this->renderAnalytics($data); }
        elseif ($data['view'] === 'automations') { $this->renderAutomations($data); }
        elseif ($data['view'] === 'campaigns') { $this->renderCampaigns($data); }
        elseif ($data['view'] === 'campaign') { $this->renderCampaignDetail($data); }
        elseif ($data['view'] === 'templates') { $this->renderTemplates($data); }
        elseif ($data['view'] === 'template') { $this->renderTemplateDetail($data); }
        elseif (!empty($data['plannedSession'])) { $this->renderPlanned($data); }
        else { $this->renderDashboard($data); }
        echo '</div>';
    }

    /**
     * Menu sections whose session has not landed yet. The page states plainly
     * that nothing is wired up and which session brings it — no dead links and
     * no pretend screens.
     */
    private function renderPlanned(array $data)
    {
        $notes = array(
            3 => array('Segments', 'segment rule builder over whitelisted read-only WHMCS columns, evaluated dynamically'),
            4 => array('Templates', 'block catalog rendered to email-safe table HTML, sanitizer, previews and the template library'),
            5 => array('Campaigns', 'campaign CRUD, the pre-send validation checklist, test sends and schedule/pause/resume/cancel'),
            9 => array('Analytics', 'open/click/bounce rates read from the event ledger, click map and per-recipient activity'),
            10 => array('Automations', 'trigger, wait and email steps driven by WHMCS hooks with idempotent runs'),
        );
        $session = (int) $data['plannedSession'];
        $info = isset($notes[$session]) ? $notes[$session] : array('This section', 'the module extension it belongs to');
        echo '<div class="alert alert-info"><strong>' . $this->e($info[0]) . ' is not available yet.</strong> '
            . 'This build session (' . $session . ') adds ' . $this->e($info[1]) . '. '
            . 'Nothing on this page reads or writes data.</div>';
        echo '<p class="text-muted">The session order is tracked in <code>docs/independent-rebuild/EMAIL-MARKETING.md</code>; '
            . 'the menu entry exists so the planned sections stay visible while they are built.</p>';
    }

    private function renderDashboard(array $data)
    {
        $stats = $data['stats'];
        $integration = $data['integration'];

        echo '<h4>Email delivery provider</h4>';
        echo '<table class="table table-condensed" style="max-width:780px;"><tr>'
            . '<th style="width:160px;">Provider</th><th style="width:130px;">Configured</th><th style="width:150px;">Connection status</th><th style="width:160px;">Last health check</th><th>Manage</th></tr><tr>'
            . '<td>cPanel SMTP <span class="text-muted">(cpanel_smtp)</span></td>'
            . '<td>' . ($integration['configured'] ? '<span class="label label-success">Configured</span>' : '<span class="label label-default">Not configured</span>') . '</td>'
            . '<td>' . $this->e($integration['result_label']) . '</td>'
            . '<td>' . ($integration['last_checked_at'] !== '' ? $this->e($integration['last_checked_at']) : '<em>Never tested</em>') . '</td>'
            . '<td><a class="btn btn-xs btn-primary" href="' . $this->e($integration['configure_url']) . '">Configure / test</a> '
            . '<a class="btn btn-xs btn-default" href="' . $this->e($integration['events_url']) . '">Connection events</a></td></tr></table>';
        echo '<p class="text-muted">SMTP credentials are stored encrypted in the central CloudHost247 API &amp; Integrations vault — this module never sees or stores passwords. Until the integration is configured <em>and</em> its connection test passes, campaigns stay out of the sending states.</p>';

        echo '<div class="row" style="max-width:980px;">';
        $tiles = array(
            array('Total subscribers', $stats['subscriber_total'], ''),
            array('Active lists', $stats['lists_total'], ''),
            array('Global suppressions', $stats['suppressed_total'], ''),
            array('Tracking events', $stats['events_total'], ''),
        );
        foreach ($tiles as $tile) {
            echo '<div class="col-sm-3"><div class="panel panel-default"><div class="panel-body text-center">'
                . '<div style="font-size:24px;font-weight:600;">' . (int) $tile[1] . '</div>'
                . '<div class="text-muted">' . $this->e($tile[0]) . '</div></div></div></div>';
        }
        echo '</div>';

        echo '<div class="row" style="max-width:980px;"><div class="col-sm-4">';
        echo '<h4>Subscribers</h4><table class="table table-condensed">';
        foreach (SubscriberStatus::all() as $status) {
            echo '<tr><td>' . $this->e(SubscriberStatus::label($status)) . '</td><td class="text-right">' . (int) $stats['subscribers'][$status] . '</td></tr>';
        }
        echo '</table></div><div class="col-sm-4">';
        echo '<h4>Campaigns</h4><table class="table table-condensed">';
        foreach (CampaignStatus::all() as $status) {
            echo '<tr><td>' . $this->e(CampaignStatus::label($status)) . '</td><td class="text-right">' . (int) $stats['campaigns'][$status] . '</td></tr>';
        }
        echo '</table></div><div class="col-sm-4">';
        echo '<h4>Email queue</h4><table class="table table-condensed">';
        foreach (QueueStatus::all() as $status) {
            echo '<tr><td>' . $this->e(QueueStatus::label($status)) . '</td><td class="text-right">' . (int) $stats['queue'][$status] . '</td></tr>';
        }
        echo '</table></div></div>';

        echo '<h4>Last 30 days</h4>';
        $analytics = (new AnalyticsService())->overview(30);
        echo '<table class="table table-condensed" style="max-width:640px;">';
        echo '<tr><th>Accepted by relay</th><td>' . number_format((int) $analytics['totals'][EventType::SENT]) . '</td>'
            . '<th>Opens (pixel)</th><td>' . number_format((int) $analytics['totals'][EventType::OPENED]) . ' (' . $this->rateCell($analytics['rates']['open']) . ')</td></tr>';
        echo '<tr><th>Clicks</th><td>' . number_format((int) $analytics['totals'][EventType::CLICKED]) . ' (' . $this->rateCell($analytics['rates']['click']) . ')</td>'
            . '<th>Unsubscribes</th><td>' . number_format((int) $analytics['totals'][EventType::UNSUBSCRIBED]) . '</td></tr>';
        echo '</table>';
        echo '<p class="text-muted">Full reporting is on the Analytics tab. ' . $this->e(AnalyticsService::DELIVERY_NOTE) . '</p>';

        $missing = array();
        foreach ($data['tables'] as $table => $exists) { if (!$exists) { $missing[] = $table; } }
        echo '<h4>Installation</h4>';
        if (!$missing) {
            echo '<p><span class="label label-success">All ' . count($data['tables']) . ' module tables are installed</span></p>';
        } else {
            echo '<div class="alert alert-warning">Missing tables (re-activate the addon to apply migrations non-destructively):<br><code>' . $this->e(implode(', ', $missing)) . '</code></div>';
        }
        echo '<p class="text-muted">Worker: <code>php crons/cloudhost247_marketing.php queue</code> (also <code>bounces</code>, <code>automations</code>) — schedule from the system crontab.</p>';
        echo '<p class="text-muted">Capabilities: the Foundation capability registry can restrict operations to WHMCS roles '
            . '(<code>marketing.settings.manage</code>, <code>marketing.campaigns.manage</code>, <code>marketing.subscribers.manage</code>, '
            . '<code>marketing.sending.manage</code>, <code>marketing.analytics.view</code>).</p>';
    }

    // ------------------------------------------------------------ subscribers

    private function renderSubscribers(array $data)
    {
        $s = $data['subscribers'];
        $canManage = !empty($data['capabilities']['subscribers.manage']);
        $filters = $s['filters'];

        echo '<h4>Subscribers <span class="text-muted" style="font-size:12px;">' . (int) $s['total'] . ' matching</span></h4>';
        echo '<form method="get" action="addonmodules.php" class="form-inline" style="margin-bottom:10px;">'
            . '<input type="hidden" name="module" value="cloudhost247_marketing" /><input type="hidden" name="view" value="subscribers" />'
            . '<input class="form-control" name="q" value="' . $this->e($filters['search']) . '" placeholder="Search email, name, company" /> '
            . '<select class="form-control" name="status"><option value="">Any status</option>';
        foreach ($s['statuses'] as $status) {
            echo '<option value="' . $this->e($status) . '"' . ($filters['status'] === $status ? ' selected' : '') . '>' . $this->e(SubscriberStatus::label($status)) . '</option>';
        }
        echo '</select> <select class="form-control" name="consent"><option value="">Any consent</option>';
        foreach ($s['consents'] as $consent) {
            echo '<option value="' . $this->e($consent) . '"' . ($filters['consent_status'] === $consent ? ' selected' : '') . '>' . $this->e(ConsentStatus::label($consent)) . '</option>';
        }
        echo '</select> <select class="form-control" name="list"><option value="0">Any list</option>';
        foreach ($s['lists'] as $list) {
            echo '<option value="' . (int) $list->id . '"' . ((int) $filters['list_id'] === (int) $list->id ? ' selected' : '') . '>' . $this->e($list->name) . '</option>';
        }
        echo '</select> <select class="form-control" name="tag"><option value="0">Any tag</option>';
        foreach ($s['tags'] as $tag) {
            echo '<option value="' . (int) $tag->id . '"' . ((int) $filters['tag_id'] === (int) $tag->id ? ' selected' : '') . '>' . $this->e($tag->name) . '</option>';
        }
        echo '</select> <button class="btn btn-default">Filter</button></form>';

        echo '<form method="post" action="' . $this->base('subscribers') . '" style="margin-bottom:14px;">'
            . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" />'
            . '<input type="hidden" name="action" value="subscribers.export" />'
            . '<input type="hidden" name="filters[status]" value="' . $this->e($filters['status']) . '" />'
            . '<input type="hidden" name="filters[consent_status]" value="' . $this->e($filters['consent_status']) . '" />'
            . '<input type="hidden" name="filters[search]" value="' . $this->e($filters['search']) . '" />'
            . '<input type="hidden" name="filters[list_id]" value="' . (int) $filters['list_id'] . '" />'
            . '<input type="hidden" name="filters[tag_id]" value="' . (int) $filters['tag_id'] . '" />'
            . '<button class="btn btn-default btn-sm" type="submit">Export this view (CSV)</button>'
            . '<span class="text-muted" style="margin-left:8px;font-size:12px;">Exports are audited; spreadsheet formulas are neutralised.</span></form>';

        if (!empty($data['download'])) {
            echo '<div class="panel panel-default"><div class="panel-heading">CSV export — headers were already sent, so copy the content below</div>'
                . '<div class="panel-body"><textarea class="form-control" rows="10" readonly>' . $this->e($data['download']['content']) . '</textarea></div></div>';
        }

        echo '<table class="table table-striped"><tr><th>Email</th><th>Name</th><th>Status</th><th>Consent</th><th>Source</th><th>Last activity</th><th></th></tr>';
        foreach ($s['rows'] as $row) {
            $name = trim((string) $row->first_name . ' ' . (string) $row->last_name);
            echo '<tr><td><a href="' . $this->base('subscriber', array('id' => (int) $row->id)) . '">' . $this->e($row->email) . '</a></td>'
                . '<td>' . $this->e($name !== '' ? $name : '—') . '</td>'
                . '<td>' . $this->e(SubscriberStatus::label((string) $row->status)) . '</td>'
                . '<td>' . $this->e(ConsentStatus::label((string) $row->consent_status)) . '</td>'
                . '<td>' . $this->e(SubscriberSource::label((string) $row->source)) . '</td>'
                . '<td>' . $this->e(isset($row->last_activity_at) && $row->last_activity_at ? $row->last_activity_at : '—') . '</td>'
                . '<td><a class="btn btn-xs btn-default" href="' . $this->base('subscriber', array('id' => (int) $row->id)) . '">Open</a></td></tr>';
        }
        if (!$s['rows']) { echo '<tr><td colspan="7" class="text-muted">No subscribers match this filter yet.</td></tr>'; }
        echo '</table>';
        $this->pagination('subscribers', $s['page'], $s['pages'], array('q' => $filters['search'], 'status' => $filters['status'], 'consent' => $filters['consent_status'], 'list' => $filters['list_id'], 'tag' => $filters['tag_id']));

        echo '<h4>Add a subscriber</h4>';
        if (!$canManage) { echo '<div class="alert alert-warning">Your WHMCS role lacks marketing.subscribers.manage; this form is read-only for you.</div>'; }
        echo '<form method="post" action="' . $this->base('subscribers') . '" class="form-inline">'
            . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="subscriber.save" />'
            . '<input class="form-control" name="email" placeholder="email@example.com" required /> '
            . '<input class="form-control" name="first_name" placeholder="First name" /> '
            . '<input class="form-control" name="last_name" placeholder="Last name" /> '
            . '<select class="form-control" name="consent_status">';
        foreach ($s['consents'] as $consent) {
            echo '<option value="' . $this->e($consent) . '">' . $this->e(ConsentStatus::label($consent)) . '</option>';
        }
        echo '</select> <input class="form-control" name="consent_source" placeholder="consent source (e.g. signup form)" /> '
            . '<button class="btn btn-primary"' . ($canManage ? '' : ' disabled') . '>Add / update</button></form>';
        echo '<p class="text-muted">A suppressed address cannot be added here — that is the point of the suppression list. Release the suppression first if it is genuinely intended.</p>';
    }

    private function renderSubscriberDetail(array $data)
    {
        $detail = $data['subscriberDetail'];
        if (!$detail) { echo '<div class="alert alert-warning">That subscriber does not exist.</div>'; return; }
        $row = $detail['subscriber'];
        $canManage = !empty($data['capabilities']['subscribers.manage']);

        echo '<h4>' . $this->e($row->email) . '</h4>';
        echo '<p><a href="' . $this->base('subscribers') . '">&larr; All subscribers</a></p>';
        echo '<table class="table table-condensed" style="max-width:760px;">'
            . '<tr><th style="width:220px;">Status</th><td>' . $this->e(SubscriberStatus::label((string) $row->status)) . '</td></tr>'
            . '<tr><th>Consent</th><td>' . $this->e(ConsentStatus::label((string) $row->consent_status))
            . ($row->consent_source ? ' <span class="text-muted">(' . $this->e($row->consent_source) . ')</span>' : '') . '</td></tr>'
            . '<tr><th>Sendable right now</th><td>' . ($detail['sendable']['sendable']
                ? '<span class="label label-success">Yes</span>'
                : '<span class="label label-danger">No</span> <span class="text-muted">' . $this->e($detail['sendable']['reason']) . '</span>') . '</td></tr>'
            . '<tr><th>Bounces</th><td>' . (int) $row->bounce_count . ($row->bounce_type ? ' (' . $this->e($row->bounce_type) . ')' : '') . '</td></tr>'
            . '<tr><th>Lists</th><td>';
        foreach ($detail['lists'] as $list) { echo '<span class="label label-info">' . $this->e($list->name) . '</span> '; }
        if (!$detail['lists']) { echo '<span class="text-muted">None</span>'; }
        echo '</td></tr><tr><th>Tags</th><td>';
        foreach ($detail['tags'] as $tag) { echo '<span class="label label-default">' . $this->e($tag->name) . '</span> '; }
        if (!$detail['tags']) { echo '<span class="text-muted">None</span>'; }
        echo '</td></tr>';
        if ($detail['suppression']) {
            echo '<tr><th>Suppression</th><td><span class="label label-danger">' . $this->e(SuppressionReason::label((string) $detail['suppression']->reason)) . '</span>'
                . ' <span class="text-muted">' . $this->e($detail['suppression']->detail) . '</span> '
                . ' <a href="' . $this->base('suppressions', array('q' => (string) $row->email)) . '">manage</a></td></tr>';
        }
        echo '</table>';

        echo '<div class="row"><div class="col-sm-6">';
        echo '<h4>Memberships</h4><form method="post" action="' . $this->base('subscriber', array('id' => (int) $row->id)) . '">'
            . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="subscriber.lists" />'
            . '<input type="hidden" name="subscriber_id" value="' . (int) $row->id . '" />';
        $memberIds = array();
        foreach ($detail['lists'] as $list) { $memberIds[] = (int) $list->id; }
        foreach ($detail['all_lists'] as $list) {
            echo '<label class="checkbox-inline"><input type="checkbox" name="list_ids[]" value="' . (int) $list->id . '"'
                . (in_array((int) $list->id, $memberIds, true) ? ' checked' : '') . ' /> ' . $this->e($list->name) . '</label><br />';
        }
        if (!$detail['all_lists']) { echo '<p class="text-muted">No active lists yet — create one first.</p>'; }
        echo '<button class="btn btn-sm btn-primary"' . ($canManage ? '' : ' disabled') . ' style="margin-top:8px;">Save memberships</button></form>';

        echo '<h4>Tags</h4><form method="post" action="' . $this->base('subscriber', array('id' => (int) $row->id)) . '" class="form-inline">'
            . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="subscriber.tag.add" />'
            . '<input type="hidden" name="subscriber_id" value="' . (int) $row->id . '" />'
            . '<input class="form-control" name="tag" placeholder="new-or-existing-tag" /> <button class="btn btn-sm btn-primary"' . ($canManage ? '' : ' disabled') . '>Add tag</button></form>';
        foreach ($detail['tags'] as $tag) {
            echo '<form method="post" action="' . $this->base('subscriber', array('id' => (int) $row->id)) . '" class="form-inline" style="margin-bottom:4px;">'
                . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="subscriber.tag.remove" />'
                . '<input type="hidden" name="subscriber_id" value="' . (int) $row->id . '" />'
                . '<input type="hidden" name="tag" value="' . $this->e($tag->tag_key) . '" />'
                . '<span class="label label-default">' . $this->e($tag->name) . '</span> <button class="btn btn-xs btn-default"' . ($canManage ? '' : ' disabled') . '>remove</button></form>';
        }
        echo '</div><div class="col-sm-6">';

        echo '<h4>Lifecycle</h4>';
        echo '<form method="post" action="' . $this->base('subscriber', array('id' => (int) $row->id)) . '" style="margin-bottom:8px;">'
            . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="subscriber.unsubscribe" />'
            . '<input type="hidden" name="email" value="' . $this->e($row->email) . '" />'
            . '<button class="btn btn-sm btn-warning"' . ($canManage ? '' : ' disabled') . '>Unsubscribe and suppress</button>'
            . '<span class="text-muted" style="margin-left:8px;font-size:12px;">Records revocation and blocks every future send.</span></form>';
        echo '<form method="post" action="' . $this->base('subscriber', array('id' => (int) $row->id)) . '">'
            . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="subscriber.resubscribe" />'
            . '<input type="hidden" name="email" value="' . $this->e($row->email) . '" />'
            . '<input class="form-control" name="consent_source" placeholder="consent source (required by your policy)" style="max-width:280px;display:inline-block;" /> '
            . '<button class="btn btn-sm btn-default"' . ($canManage ? '' : ' disabled') . '>Restore to subscribed</button></form>';
        echo '<p class="text-muted">Restoring refuses while a suppression row exists — release it from the Suppression List first, so both decisions stay visible in the audit trail.</p>';
        echo '</div></div>';
    }

    // ------------------------------------------------------------- analytics

    private function rateCell($rate)
    {
        if ($rate === null) { return '<span class="text-muted" title="No accepted messages to divide by">—</span>'; }
        return number_format((float) $rate, 1) . '%';
    }

    private function renderAnalytics(array $data)
    {
        $view = $data['analyticsView'];
        $overview = $view['overview'];
        echo '<h4>Delivery analytics</h4>';
        echo '<p class="text-muted">Every figure below counts recorded events. "Accepted" means the relay took the message; '
            . 'opens come from the tracking pixel and can include client prefetching, so they are reported as a pixel rate, never as proof somebody read the email.</p>';

        echo '<form method="get" action="addonmodules.php" style="margin-bottom:12px;">'
            . '<input type="hidden" name="module" value="cloudhost247_marketing" /><input type="hidden" name="view" value="analytics" />'
            . '<select name="days" class="form-control" style="width:150px;display:inline-block;">';
        foreach (array(7 => 'Last 7 days', 30 => 'Last 30 days', 90 => 'Last 90 days', 365 => 'Last year') as $value => $label) {
            echo '<option value="' . (int) $value . '"' . ((int) $view['days'] === (int) $value ? ' selected' : '') . '>' . $this->e($label) . '</option>';
        }
        echo '</select> '
            . '<select name="campaign_id" class="form-control" style="width:300px;display:inline-block;"><option value="0">Deployment-wide</option>';
        foreach ($overview['campaigns'] as $entry) {
            echo '<option value="' . (int) $entry['campaign_id'] . '"' . ((int) $view['campaign_id'] === (int) $entry['campaign_id'] ? ' selected' : '') . '>'
                . $this->e($entry['name']) . ' (' . (int) $entry['accepted'] . ' accepted)</option>';
        }
        echo '</select> <button class="btn btn-default">Apply</button></form>';

        echo '<div class="row" style="max-width:1100px;">';
        $tiles = array(
            array('Campaigns sent', number_format((int) $overview['totals'][EventType::SENT]), 'messages accepted by the relay'),
            array('Opens (pixel)', number_format((int) $overview['totals'][EventType::OPENED]), 'open rate ' . $this->rateCell($overview['rates']['open'])),
            array('Clicks', number_format((int) $overview['totals'][EventType::CLICKED]), 'click rate ' . $this->rateCell($overview['rates']['click'])),
            array('Unsubscribes', number_format((int) $overview['totals'][EventType::UNSUBSCRIBED]), 'rate ' . $this->rateCell($overview['rates']['unsubscribe'])),
            array('Bounces', number_format((int) $overview['totals'][EventType::BOUNCED]), 'rate ' . $this->rateCell($overview['rates']['bounce'])),
        );
        foreach ($tiles as $tile) {
            echo '<div class="col-sm-2" style="min-width:180px;"><div class="panel panel-default"><div class="panel-body text-center">'
                . '<div style="font-size:22px;font-weight:600;">' . $tile[1] . '</div>'
                . '<div class="text-muted">' . $this->e($tile[0]) . '</div>'
                . '<div class="text-muted" style="font-size:11px;">' . $tile[2] . '</div></div></div></div>';
        }
        echo '</div>';

        if (!empty($view['missing'])) {
            echo '<div class="alert alert-warning">That campaign no longer exists; showing deployment-wide figures instead.</div>';
        }

        if (!empty($view['summary'])) {
            $summary = $view['summary'];
            echo '<h4>' . $this->e($summary['campaign']->name) . ' ' . $this->statusBadge($summary['status']) . '</h4>';
            echo '<table class="table table-striped" style="max-width:760px;">'
                . '<tr><th>Audience frozen</th><td>' . number_format((int) $summary['audience_size']) . '</td></tr>'
                . '<tr><th>Accepted by relay</th><td>' . number_format((int) $summary['counts']['accepted']) . '</td></tr>'
                . '<tr><th>Failed / skipped</th><td>' . number_format((int) $summary['counts']['failed']) . ' / ' . number_format((int) $summary['counts']['skipped']) . '</td></tr>'
                . '<tr><th>Still queued</th><td>' . number_format((int) $summary['counts']['queued'] + (int) $summary['counts']['sending']) . '</td></tr>'
                . '<tr><th>Opens (pixel)</th><td>' . number_format((int) $summary['counts']['opened']) . ' — open rate ' . $this->rateCell($summary['rates']['open']) . '</td></tr>'
                . '<tr><th>Clicks</th><td>' . number_format((int) $summary['counts']['clicked']) . ' — click rate ' . $this->rateCell($summary['rates']['click']) . ', click-to-open ' . $this->rateCell($summary['rates']['click_to_open']) . '</td></tr>'
                . '<tr><th>Bounces</th><td>' . number_format((int) $summary['counts']['bounced']) . ' — ' . $this->rateCell($summary['rates']['bounce']) . ' of the audience</td></tr>'
                . '<tr><th>Unsubscribes</th><td>' . number_format((int) $summary['counts']['unsubscribed']) . ' — ' . $this->rateCell($summary['rates']['unsubscribe']) . '</td></tr>'
                . '</table>';

            $map = $view['clickMap'];
            echo '<h5>Click map</h5>';
            if ($map['links']) {
                echo '<table class="table table-condensed" style="max-width:860px;"><tr><th>Clicks</th><th>Destination</th></tr>';
                foreach ($map['links'] as $link) {
                    echo '<tr><td>' . number_format((int) $link['clicks']) . '</td><td><code style="word-break:break-all;">' . $this->e($link['url']) . '</code></td></tr>';
                }
                echo '</table>';
            } else {
                echo '<p class="text-muted">No links were registered for this campaign.</p>';
            }
            if ((int) $map['unattributed'] > 0) {
                echo '<p class="text-muted">' . number_format((int) $map['unattributed']) . ' click event(s) reference a link that no longer exists.</p>';
            }

            echo '<h5>Recipient activity</h5>';
            echo '<table class="table table-condensed" style="max-width:900px;"><tr><th>Recipient</th><th>Status</th><th>Attempts</th><th>Opens</th><th>Clicks</th><th>Accepted</th></tr>';
            foreach (array_slice($view['activity'], 0, 50) as $entry) {
                echo '<tr><td>' . $this->e($entry['email']) . ($entry['unsubscribed'] ? ' <span class="label label-default">unsubscribed</span>' : '') . '</td>'
                    . '<td>' . $this->e(QueueStatus::label($entry['status'])) . '</td>'
                    . '<td>' . (int) $entry['attempts'] . '</td>'
                    . '<td>' . (int) $entry['opens'] . '</td>'
                    . '<td>' . (int) $entry['clicks'] . '</td>'
                    . '<td>' . ($entry['accepted_at'] !== '' ? $this->e($entry['accepted_at']) : '<span class="text-muted">—</span>') . '</td></tr>';
            }
            if (!$view['activity']) { echo '<tr><td colspan="6" class="text-muted">Nothing has been queued for this campaign yet.</td></tr>'; }
            echo '</table>';
        }

        echo '<h5>Daily activity</h5>';
        echo '<table class="table table-condensed" style="max-width:760px;"><tr><th>Day</th><th>Accepted</th><th>Opens</th><th>Clicks</th><th>Failed</th><th>Unsubscribes</th><th>Bounces</th></tr>';
        foreach ($view['timeline'] as $day) {
            echo '<tr><td>' . $this->e($day['day']) . '</td><td>' . (int) $day['sent'] . '</td><td>' . (int) $day['opened'] . '</td>'
                . '<td>' . (int) $day['clicked'] . '</td><td>' . (int) $day['failed'] . '</td>'
                . '<td>' . (int) $day['unsubscribed'] . '</td><td>' . (int) $day['bounced'] . '</td></tr>';
        }
        echo '</table>';

        echo '<h5>Campaign states</h5><table class="table table-condensed" style="max-width:420px;">';
        foreach ($overview['campaign_statuses'] as $status => $count) {
            echo '<tr><td>' . $this->e(CampaignStatus::label($status)) . '</td><td style="text-align:right;">' . (int) $count . '</td></tr>';
        }
        echo '</table>';
        foreach ($overview['notes'] as $note) { echo '<p class="text-muted" style="font-size:12px;">' . $this->e($note) . '</p>'; }
    }

    // ----------------------------------------------------------- automations

    private function renderAutomations(array $data)
    {
        $view = $data['automationsView'];
        echo '<h4>Automations</h4>';
        echo '<p class="text-muted">A journey is a list of steps — wait, send email — that one subscriber walks through. '
            . 'Each send step puts one message on the same queue campaigns use: the same suppression checks, throttling, retries, '
            . 'tracking and ledger apply. A run advances at most one step per cron pass, so nothing is fired in a loop.</p>';

        $counts = $view['list']['status_counts'];
        echo '<p>';
        foreach ($view['statuses'] as $status) {
            echo '<span class="label label-default" style="margin-right:6px;">' . $this->e(AutomationStatus::label($status)) . ': ' . (int) $counts[$status] . '</span>';
        }
        echo '</p>';

        // ------------------------------------------------------------- create
        if (!empty($view['canManage'])) {
            echo '<div class="panel panel-default" style="max-width:900px;"><div class="panel-heading">New automation</div><div class="panel-body">';
            echo '<form method="post" action="' . $this->base('automations') . '">'
                . '<input type="hidden" name="token" value="' . $this->e($data['csrf']) . '" />'
                . '<input type="hidden" name="action" value="automation.create" />';
            echo '<div class="row"><div class="col-sm-4"><input class="form-control" name="name" placeholder="Name, e.g. Welcome journey" /></div>'
                . '<div class="col-sm-3"><select class="form-control" name="trigger_type">';
            foreach ($view['triggers'] as $trigger) {
                echo '<option value="' . $this->e($trigger) . '">' . $this->e(AutomationTrigger::label($trigger)) . '</option>';
            }
            echo '</select></div><div class="col-sm-3"><select class="form-control" name="list_id"><option value="0">— list (for list trigger) —</option>';
            foreach ($view['lists'] as $list) {
                echo '<option value="' . (int) $list->id . '">' . $this->e($list->name) . '</option>';
            }
            echo '</select></div><div class="col-sm-2"><button class="btn btn-primary">Create</button></div></div>';
            echo '<p class="text-muted" style="margin-top:8px;font-size:12px;">Nothing is sent until the automation is active and a step says so.</p>';
            echo '</form></div></div>';
        }

        // --------------------------------------------------------------- list
        echo '<table class="table table-striped" style="max-width:1100px;"><tr><th>Automation</th><th>Trigger</th><th>Steps</th>'
            . '<th>Runs</th><th>Messages</th><th>Status</th><th></th></tr>';
        foreach ($view['list']['rows'] as $entry) {
            $automation = $entry['automation'];
            $runs = $entry['runs'];
            echo '<tr><td>' . $this->e($automation->name) . '<div class="text-muted" style="font-size:11px;">' . $this->e($automation->description) . '</div></td>'
                . '<td>' . $this->e(AutomationTrigger::label((string) $automation->trigger_type)) . ((int) $automation->trigger_delay_minutes > 0 ? '<div class="text-muted" style="font-size:11px;">after ' . (int) $automation->trigger_delay_minutes . ' min</div>' : '') . '</td>'
                . '<td>' . (int) $entry['steps'] . '</td>'
                . '<td>' . (int) $runs['running'] . ' running, ' . (int) $runs['waiting'] . ' waiting, ' . (int) $runs['completed'] . ' done'
                . ((int) $runs['cancelled'] > 0 ? ', ' . (int) $runs['cancelled'] . ' cancelled' : '')
                . ((int) $runs['failed'] > 0 ? ', <span class="text-danger">' . (int) $runs['failed'] . ' failed</span>' : '') . '</td>'
                . '<td>' . (int) $runs['messages'] . '</td>'
                . '<td>' . $this->automationBadge((string) $automation->status) . '</td>'
                . '<td><a class="btn btn-xs btn-default" href="' . $this->base('automations', array('automation_id' => (int) $automation->id)) . '">Open</a></td></tr>';
        }
        if (!$view['list']['rows']) {
            echo '<tr><td colspan="7" class="text-muted">No automations yet. A welcome journey is a good first one: trigger on “subscriber added”, wait 5 minutes, send your welcome template.</td></tr>';
        }
        echo '</table>';

        if (empty($view['detail'])) { return; }

        // ------------------------------------------------------------- detail
        $detail = $view['detail'];
        $automation = $detail['automation'];
        echo '<hr /><h4>' . $this->e($automation->name) . ' ' . $this->automationBadge((string) $automation->status) . '</h4>';
        echo '<p class="text-muted">Trigger: ' . $this->e(AutomationTrigger::label((string) $automation->trigger_type))
            . ((int) $automation->trigger_delay_minutes > 0 ? ', after a ' . (int) $automation->trigger_delay_minutes . '-minute delay' : '')
            . '. ' . (!empty($automation->reenrollable) ? 'A subscriber may be enrolled again after finishing.' : 'One journey per subscriber; re-running is refused.')
            . '</p>';
        if (!empty($detail['container'])) {
            echo '<p class="text-muted">Delivery container: campaign #' . (int) $detail['container']->id . ' (' . $this->e($detail['container']->name) . '). '
                . 'It exists for links and reporting and is never sent as a campaign.</p>';
        }
        if ($detail['issues']) {
            echo '<div class="alert alert-warning"><strong>Not activatable yet:</strong><ul style="margin:6px 0 0 18px;">';
            foreach ($detail['issues'] as $issue) { echo '<li>' . $this->e($issue) . '</li>'; }
            echo '</ul></div>';
        }

        echo '<h5>Steps</h5>';
        echo '<table class="table table-condensed" style="max-width:900px;"><tr><th>#</th><th>Step</th><th>Detail</th><th></th></tr>';
        foreach ($detail['steps_detail'] as $entry) {
            $step = $entry['step'];
            $isSend = AutomationStepType::isSending((string) $step->step_type);
            echo '<tr><td>' . (int) $step->position . '</td><td>' . $this->e(AutomationStepType::label((string) $step->step_type)) . '</td><td>'
                . ($isSend
                    ? $this->e($step->subject) . ' <span class="text-muted">via ' . $this->e($entry['template_name']) . '</span>'
                    : 'wait ' . (int) $step->wait_minutes . ' minute(s)')
                . '</td><td>';
            if (!empty($view['canManage'])) {
                echo '<form method="post" action="' . $this->base('automations', array('automation_id' => (int) $automation->id)) . '" style="display:inline">'
                    . '<input type="hidden" name="token" value="' . $this->e($data['csrf']) . '" />'
                    . '<input type="hidden" name="action" value="automation.step_remove" />'
                    . '<input type="hidden" name="automation_id" value="' . (int) $automation->id . '" />'
                    . '<input type="hidden" name="step_id" value="' . (int) $step->id . '" />'
                    . '<button class="btn btn-xs btn-default">Remove</button></form>';
            }
            echo '</td></tr>';
        }
        if (!$detail['steps_detail']) { echo '<tr><td colspan="4" class="text-muted">No steps yet.</td></tr>'; }
        echo '</table>';

        if (!empty($view['canManage'])) {
            echo '<div class="panel panel-default" style="max-width:900px;"><div class="panel-heading">Add a step</div><div class="panel-body">';
            // Wait step
            echo '<form method="post" action="' . $this->base('automations', array('automation_id' => (int) $automation->id)) . '" class="form-inline" style="margin-bottom:10px;">'
                . '<input type="hidden" name="token" value="' . $this->e($data['csrf']) . '" />'
                . '<input type="hidden" name="action" value="automation.step_add" />'
                . '<input type="hidden" name="automation_id" value="' . (int) $automation->id . '" />'
                . '<input type="hidden" name="step_type" value="' . AutomationStepType::WAIT . '" />'
                . '<label>Wait</label> <input class="form-control" style="width:110px;" name="wait_minutes" value="60" /> <label>minutes</label> '
                . '<button class="btn btn-default">Add wait</button></form>';
            // Send step
            echo '<form method="post" action="' . $this->base('automations', array('automation_id' => (int) $automation->id)) . '" class="form-inline">'
                . '<input type="hidden" name="token" value="' . $this->e($data['csrf']) . '" />'
                . '<input type="hidden" name="action" value="automation.step_add" />'
                . '<input type="hidden" name="automation_id" value="' . (int) $automation->id . '" />'
                . '<input type="hidden" name="step_type" value="' . AutomationStepType::SEND_EMAIL . '" />'
                . '<input class="form-control" style="width:220px;" name="subject" placeholder="Subject line" /> '
                . '<select class="form-control" name="template_id"><option value="0">— template —</option>';
            foreach ($view['templates'] as $template) {
                echo '<option value="' . (int) $template->id . '">' . $this->e($template->name) . '</option>';
            }
            echo '</select> <button class="btn btn-primary">Add send step</button></form>';
            echo '<p class="text-muted" style="margin-top:8px;font-size:12px;">Steps run top to bottom. A send step uses the template as it exists when the message is queued.</p>';
            echo '</div></div>';
        }

        echo '<h5>Run this automation</h5>';
        if (!empty($view['canManage'])) {
            echo '<form method="post" action="' . $this->base('automations', array('automation_id' => (int) $automation->id)) . '" class="form-inline" style="margin-bottom:10px;">'
                . '<input type="hidden" name="token" value="' . $this->e($data['csrf']) . '" />'
                . '<input type="hidden" name="action" value="automation.activate" />'
                . '<input type="hidden" name="automation_id" value="' . (int) $automation->id . '" />'
                . '<button class="btn btn-success"' . ($detail['issues'] ? ' disabled' : '') . '>Activate</button></form>';
            echo '<form method="post" action="' . $this->base('automations', array('automation_id' => (int) $automation->id)) . '" class="form-inline" style="margin-bottom:10px;">'
                . '<input type="hidden" name="token" value="' . $this->e($data['csrf']) . '" />'
                . '<input type="hidden" name="action" value="automation.pause" />'
                . '<input type="hidden" name="automation_id" value="' . (int) $automation->id . '" />'
                . '<button class="btn btn-default">Pause (holds live journeys)</button></form>';
            echo '<form method="post" action="' . $this->base('automations', array('automation_id' => (int) $automation->id)) . '" class="form-inline" style="margin-bottom:10px;">'
                . '<input type="hidden" name="token" value="' . $this->e($data['csrf']) . '" />'
                . '<input type="hidden" name="action" value="automation.archive" />'
                . '<input type="hidden" name="automation_id" value="' . (int) $automation->id . '" />'
                . '<button class="btn btn-danger">Archive (cancels live journeys)</button></form>';
            echo '<form method="post" action="' . $this->base('automations', array('automation_id' => (int) $automation->id)) . '" class="form-inline" style="margin-bottom:10px;">'
                . '<input type="hidden" name="token" value="' . $this->e($data['csrf']) . '" />'
                . '<input type="hidden" name="action" value="automation.enroll" />'
                . '<input type="hidden" name="automation_id" value="' . (int) $automation->id . '" />'
                . '<input class="form-control" name="email" placeholder="subscriber@example.com" /> '
                . '<button class="btn btn-default">Enrol one subscriber</button></form>';
        }

        echo '<h5>Runs</h5>';
        echo '<table class="table table-condensed" style="max-width:900px;"><tr><th>Subscriber</th><th>Status</th><th>At step</th><th>Messages</th><th>Next attempt</th><th>Note</th></tr>';
        foreach ($detail['recent_runs'] as $run) {
            echo '<tr><td>' . $this->e($run->subscriber_email) . '</td><td>' . $this->e(AutomationRunStatus::label((string) $run->status)) . '</td>'
                . '<td>' . (int) $run->position . '</td><td>' . (int) $run->sent_count . '</td>'
                . '<td>' . ($run->next_run_at === null ? '—' : $this->e($run->next_run_at)) . '</td>'
                . '<td class="text-muted">' . $this->e($run->last_error) . '</td></tr>';
        }
        if (!$detail['recent_runs']) { echo '<tr><td colspan="6" class="text-muted">Nobody has been enrolled yet.</td></tr>'; }
        echo '</table>';
    }

    private function automationBadge($status)
    {
        $class = 'label-default';
        if ($status === AutomationStatus::ACTIVE) { $class = 'label-success'; }
        elseif ($status === AutomationStatus::PAUSED) { $class = 'label-warning'; }
        elseif ($status === AutomationStatus::ARCHIVED) { $class = 'label-default'; }
        return '<span class="label ' . $class . '">' . $this->e(AutomationStatus::label($status)) . '</span>';
    }

    // ------------------------------------------------------------- campaigns

    private function statusBadge($status)
    {
        $labels = array(
            CampaignStatus::DRAFT => 'label-default',
            CampaignStatus::READY => 'label-info',
            CampaignStatus::SCHEDULED => 'label-primary',
            CampaignStatus::QUEUED => 'label-primary',
            CampaignStatus::SENDING => 'label-warning',
            CampaignStatus::PAUSED => 'label-warning',
            CampaignStatus::COMPLETED => 'label-success',
            CampaignStatus::CANCELLED => 'label-default',
            CampaignStatus::FAILED => 'label-danger',
            CampaignStatus::ARCHIVED => 'label-default',
        );
        $class = isset($labels[$status]) ? $labels[$status] : 'label-default';
        return '<span class="label ' . $class . '">' . $this->e(CampaignStatus::label($status)) . '</span>';
    }

    private function transportNotice(array $transport)
    {
        if (!empty($transport['available'])) {
            echo '<p class="text-muted">Delivery provider: <code>' . $this->e($transport['key']) . '</code>.</p>';
            return;
        }
        echo '<div class="alert alert-warning"><strong>No delivery provider is wired in yet.</strong> ' . $this->e($transport['reason']) . '</div>';
    }

    private function audienceSelect($audiences, $lists, $segments, $selectedType, $selectedId)
    {
        echo '<select name="audience_type" class="form-control" style="width:260px;display:inline-block;">';
        foreach ($audiences as $type) {
            echo '<option value="' . $this->e($type) . '"' . ($selectedType === $type ? ' selected' : '') . '>' . $this->e(CampaignAudience::label($type)) . '</option>';
        }
        echo '</select> ';
        echo '<select name="audience_id" class="form-control" style="width:320px;display:inline-block;">';
        echo '<option value="0">— choose a list or segment —</option>';
        if ($lists) {
            echo '<optgroup label="Lists">';
            foreach ($lists as $list) {
                echo '<option value="' . (int) $list->id . '"' . ($selectedType === CampaignAudience::LIST && (int) $selectedId === (int) $list->id ? ' selected' : '') . '>' . $this->e($list->name) . ' (' . $this->e($list->list_key) . ')</option>';
            }
            echo '</optgroup>';
        }
        if ($segments) {
            echo '<optgroup label="Segments">';
            foreach ($segments as $segment) {
                echo '<option value="' . (int) $segment->id . '"' . ($selectedType === CampaignAudience::SEGMENT && (int) $selectedId === (int) $segment->id ? ' selected' : '') . '>' . $this->e($segment->name) . ' (' . $this->e($segment->segment_key) . ')</option>';
            }
            echo '</optgroup>';
        }
        echo '</select> <span class="text-muted">"All subscribed addresses" is resolved at send time and still honours suppression and consent.</span>';
    }

    private function campaignForm(array $detail, $action)
    {
        $row = isset($detail['row']) ? $detail['row'] : null;
        $canManage = !empty($detail['canManage']);
        $audiences = isset($detail['audiences']) ? $detail['audiences'] : CampaignAudience::all();
        $lists = isset($detail['lists']) ? $detail['lists'] : array();
        $segments = isset($detail['segments']) ? $detail['segments'] : array();
        $templates = isset($detail['templates']) ? $detail['templates'] : array();
        $selectedType = $row ? (string) $row->audience_type : CampaignAudience::LIST;
        $selectedId = $row ? (int) $row->audience_id : 0;

        echo '<form method="post" action="' . $action . '" style="max-width:980px;">'
            . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" />'
            . '<input type="hidden" name="action" value="campaign.save" />';
        if ($row) { echo '<input type="hidden" name="campaign_id" value="' . (int) $row->id . '" />'; }
        echo '<table class="table">'
            . '<tr><th style="width:170px;">Name</th><td><input name="name" class="form-control" value="' . $this->e($row ? $row->name : '') . '" /></td></tr>'
            . '<tr><th>Subject</th><td><input name="subject" class="form-control" value="' . $this->e($row ? $row->subject : '') . '" /></td></tr>'
            . '<tr><th>Preview text</th><td><input name="preview_text" class="form-control" value="' . $this->e($row ? $row->preview_text : '') . '" /> <span class="text-muted">shown next to the subject in most inboxes</span></td></tr>'
            . '<tr><th>Sender name</th><td><input name="from_name" class="form-control" style="max-width:320px;" value="' . $this->e($row ? $row->from_name : '') . '" /></td></tr>'
            . '<tr><th>Sender address</th><td><input name="from_email" class="form-control" style="max-width:320px;" value="' . $this->e($row ? $row->from_email : '') . '" /></td></tr>'
            . '<tr><th>Reply-to</th><td><input name="reply_to" class="form-control" style="max-width:320px;" value="' . $this->e($row ? $row->reply_to : '') . '" /> <span class="text-muted">optional</span></td></tr>'
            . '<tr><th>Audience</th><td>';
        $this->audienceSelect($audiences, $lists, $segments, $selectedType, $selectedId);
        echo '</td></tr><tr><th>Template</th><td><select name="template_id" class="form-control" style="width:320px;display:inline-block;">'
            . '<option value="0">— keep the current content —</option>';
        foreach ($templates as $template) {
            $selected = $row && (int) $row->template_id === (int) $template->id ? ' selected' : '';
            echo '<option value="' . (int) $template->id . '"' . $selected . '>' . $this->e($template->name) . ' (' . $this->e($template->template_key) . ')</option>';
        }
        echo '</select> <span class="text-muted">choosing a template copies its rendered content into this campaign now</span></td></tr></table>';
        echo '<button class="btn btn-primary"' . ($canManage ? '' : ' disabled') . '>' . ($row ? 'Save campaign' : 'Create draft campaign') . '</button>';
        echo '</form>';
    }

    private function renderCampaigns(array $data)
    {
        $view = $data['campaignsView'];
        $canManage = !empty($view['canManage']);
        echo '<h4>Campaigns</h4>';
        echo '<p class="text-muted">A campaign is a draft until it passes the pre-send checklist, then a scheduled time, then a queue. Nothing here sends mail directly: the delivery worker owns that (SESSION 7).</p>';
        $this->transportNotice($view['transport']);

        echo '<form method="get" action="addonmodules.php" style="margin-bottom:10px;">'
            . '<input type="hidden" name="module" value="cloudhost247_marketing" /><input type="hidden" name="view" value="campaigns" />'
            . '<select name="status" class="form-control" style="width:200px;display:inline-block;"><option value="">All statuses</option>';
        foreach ($view['statuses'] as $status) {
            $count = isset($view['counts'][$status]) ? (int) $view['counts'][$status] : 0;
            echo '<option value="' . $this->e($status) . '"' . ($view['filters']['status'] === $status ? ' selected' : '') . '>' . $this->e(CampaignStatus::label($status)) . ' (' . $count . ')</option>';
        }
        echo '</select> <input name="q" class="form-control" style="width:240px;display:inline-block;" value="' . $this->e($view['filters']['search']) . '" /> '
            . '<button class="btn btn-default">Filter</button></form>';

        echo '<table class="table table-striped"><tr><th>Name</th><th>Audience</th><th>Status</th><th>Schedule</th><th>Content</th><th></th></tr>';
        foreach ($view['rows'] as $row) {
            echo '<tr><td><strong>' . $this->e($row->name) . '</strong><br /><span class="text-muted">' . $this->e($row->subject !== '' ? $row->subject : 'no subject yet') . '</span></td>';
            echo '<td>' . $this->e(CampaignAudience::label($row->audience_type));
            if ((int) $row->audience_id > 0) { echo ' #' . (int) $row->audience_id; }
            echo '</td><td>' . $this->statusBadge((string) $row->status) . '</td>';
            echo '<td>' . ($row->scheduled_at ? $this->e($row->scheduled_at) . ' UTC<br /><span class="text-muted">' . $this->e($row->scheduled_timezone) . '</span>' : '<span class="text-muted">not scheduled</span>') . '</td>';
            echo '<td>' . ((string) $row->html !== '' ? 'HTML + text' : '<span class="text-muted">no content</span>') . '</td>';
            echo '<td><a class="btn btn-xs btn-default" href="' . $this->base('campaign', array('id' => (int) $row->id)) . '">Open</a></td></tr>';
        }
        if (!$view['rows']) { echo '<tr><td colspan="6" class="text-muted">No campaigns yet.</td></tr>'; }
        echo '</table>';
        $this->pagination('campaigns', $view['page'], $view['pages'], array('status' => $view['filters']['status'], 'q' => $view['filters']['search']));

        echo '<h4>New campaign</h4>';
        $this->campaignForm($view, $this->base('campaigns'));
    }

    private function renderCampaignDetail(array $data)
    {
        $detail = $data['campaignDetail'];
        $row = $detail['row'];
        $canManage = !empty($detail['canManage']);
        $status = (string) $row->status;
        echo '<a href="' . $this->base('campaigns') . '">&larr; All campaigns</a>';
        echo '<h4>' . $this->e($row->name) . ' ' . $this->statusBadge($status) . '</h4>';

        if ((string) $row->failure_reason !== '') {
            echo '<div class="alert alert-danger">Last failure: ' . $this->e($row->failure_reason) . '</div>';
        }
        if ($row->scheduled_at) {
            echo '<p>Scheduled for <strong>' . $this->e($row->scheduled_at) . ' UTC</strong> <span class="text-muted">(' . $this->e($row->scheduled_timezone) . ' local time entered)</span>.</p>';
        }
        $this->transportNotice($detail['transport']);

        echo '<div class="row"><div class="col-sm-7">';
        echo '<h4>Pre-send checklist</h4><table class="table table-condensed" style="max-width:640px;">';
        foreach ($detail['checklist'] as $check) {
            echo '<tr><td style="width:26px;">' . ($check['ok'] ? '<span class="label label-success">ok</span>' : '<span class="label label-danger">stop</span>') . '</td>'
                . '<td><strong>' . $this->e($check['label']) . '</strong>' . ($check['blocking'] ? '' : ' <span class="text-muted">(advisory)</span>') . '<br />'
                . '<span class="text-muted">' . $this->e($check['detail']) . '</span></td></tr>';
        }
        echo '</table>';

        echo '<h4>Audience preview</h4>';
        echo '<p>' . $this->e($detail['audience']['detail']) . '</p>';
        foreach ($detail['audience']['issues'] as $issue) {
            echo '<div class="alert alert-warning">' . $this->e($issue) . '</div>';
        }
        echo '</div><div class="col-sm-5">';

        echo '<h4>Do next</h4>';
        $button = function ($action, $label, $style = 'btn-default', $extra = '') use ($row, $canManage) {
            return '<form method="post" action="' . $this->base('campaign', array('id' => (int) $row->id)) . '" style="display:inline-block;margin:0 4px 6px 0;">'
                . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="' . $action . '" />'
                . '<input type="hidden" name="campaign_id" value="' . (int) $row->id . '" />' . $extra
                . '<button class="btn btn-sm ' . $style . '"' . ($canManage ? '' : ' disabled') . '>' . $label . '</button></form>';
        };
        if ($status === CampaignStatus::DRAFT) { echo $button('campaign.ready', 'Mark ready', 'btn-primary'); }
        if ($status === CampaignStatus::READY) {
            echo $button('campaign.send_now', 'Send now', 'btn-success');
        }
        if ($status === CampaignStatus::READY) {
            echo '<form method="post" action="' . $this->base('campaign', array('id' => (int) $row->id)) . '" style="margin-bottom:8px;">'
                . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="campaign.schedule" />'
                . '<input type="hidden" name="campaign_id" value="' . (int) $row->id . '" />'
                . '<input name="scheduled_at" class="form-control" style="width:200px;display:inline-block;" value="" /> '
                . '<input name="scheduled_timezone" class="form-control" style="width:220px;display:inline-block;" value="' . $this->e($data['settings']['default_timezone']) . '" /> '
                . '<button class="btn btn-sm btn-primary"' . ($canManage ? '' : ' disabled') . '>Schedule</button>'
                . '<div class="text-muted" style="font-size:12px;">local time YYYY-MM-DD HH:MM in the chosen timezone; stored as UTC</div></form>';
            echo $button('campaign.pause', 'Pause / back to draft');
        }
        if ($status === CampaignStatus::SCHEDULED || $status === CampaignStatus::QUEUED) {
            echo $button('campaign.pause', 'Pause');
        }
        if ($status === CampaignStatus::PAUSED) {
            echo '<form method="post" action="' . $this->base('campaign', array('id' => (int) $row->id)) . '" style="margin-bottom:8px;">'
                . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="campaign.resume" />'
                . '<input type="hidden" name="campaign_id" value="' . (int) $row->id . '" />'
                . '<input name="scheduled_at" class="form-control" style="width:200px;display:inline-block;" value="" /> '
                . '<input name="scheduled_timezone" class="form-control" style="width:220px;display:inline-block;" value="' . $this->e($row->scheduled_timezone) . '" /> '
                . '<button class="btn btn-sm btn-primary"' . ($canManage ? '' : ' disabled') . '>Resume</button></form>';
        }
        if (!CampaignStatus::isTerminal($status)) { echo $button('campaign.cancel', 'Cancel campaign', 'btn-warning'); }
        if (in_array($status, array(CampaignStatus::COMPLETED, CampaignStatus::CANCELLED, CampaignStatus::FAILED), true)) {
            echo $button('campaign.archive', 'Archive');
        }

        echo '<h4>Delivery queue</h4>';
        echo '<p class="text-muted">The worker (<code>crons/cloudhost247_marketing.php</code>) freezes the audience, queues one message per recipient and delivers within '
            . (int) $detail['queue']['settings']['batch_size'] . ' messages per pass, ' . (int) $detail['queue']['settings']['messages_per_minute'] . '/minute, '
            . (int) $detail['queue']['settings']['hourly_limit'] . '/hour. Nothing is dropped when a pass is cut short — the next pass continues.</p>';
        echo '<table class="table table-condensed" style="max-width:420px;">';
        foreach (QueueStatus::all() as $queueStatus) {
            $count = isset($detail['queue'][$queueStatus]) ? (int) $detail['queue'][$queueStatus] : 0;
            if ($count === 0 && !in_array($queueStatus, array(QueueStatus::QUEUED, QueueStatus::SENT), true)) { continue; }
            echo '<tr><td>' . $this->e(QueueStatus::label($queueStatus)) . '</td><td style="text-align:right;">' . number_format($count) . '</td></tr>';
        }
        echo '</table>';
        if ($detail['queue']['total'] === 0) {
            echo '<p class="text-muted">Nothing is queued yet. A queued campaign is frozen and filled by the worker, then reported back here.</p>';
        }
        if (in_array($status, array(CampaignStatus::QUEUED, CampaignStatus::SENDING), true) && $detail['canManage']) {
            echo '<form method="post" action="' . $this->base('campaign', array('id' => (int) $row->id)) . '" style="margin-bottom:8px;">'
                . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" />'
                . '<input type="hidden" name="action" value="campaign.work" />'
                . '<input type="hidden" name="campaign_id" value="' . (int) $row->id . '" />'
                . '<button class="btn btn-sm btn-primary">Run a worker pass now</button> '
                . '<span class="text-muted" style="font-size:12px;">bounded by the same settings the cron uses</span></form>';
        }

        echo '<h4>Test message</h4>';
        if ($detail['transport']['available']) {
            echo '<form method="post" action="' . $this->base('campaign', array('id' => (int) $row->id)) . '">'
                . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="campaign.test" />'
                . '<input type="hidden" name="campaign_id" value="' . (int) $row->id . '" />'
                . '<input name="test_email" class="form-control" style="max-width:280px;" value="" /> '
                . '<button class="btn btn-sm btn-default"' . ($canManage ? '' : ' disabled') . ' style="margin-top:6px;">Send test</button></form>';
        } else {
            echo '<p class="text-muted">Unavailable until a delivery provider is configured and wired in — see the notice above. A refused test is recorded in the audit trail with its reason.</p>';
        }
        if (!empty($data['campaignTest'])) {
            echo '<div class="alert alert-success">Test accepted by <code>' . $this->e($data['campaignTest']['transport']) . '</code> as "' . $this->e($data['campaignTest']['subject']) . '".</div>';
        }
        echo '</div></div>';

        if ($detail['editable']) {
            echo '<h4>Edit content</h4>';
            $this->campaignForm($detail, $this->base('campaign', array('id' => (int) $row->id)));
        } else {
            echo '<h4>Edit content</h4><div class="alert alert-info">A campaign in "' . $this->e(CampaignStatus::label($status)) . '" is frozen so the content that was approved is the content that sends. Pause or cancel it first, or create a new draft.</div>';
        }

        echo '<h4>Tracking &amp; unsubscribe</h4>';
        echo '<p class="text-muted">Opens, clicks and unsubscribes are recorded against this campaign through '
            . '<code>cloudhost247-marketing-track.php</code> using a per-message token. A GET never changes anything: the '
            . 'unsubscribe link shows a confirmation page, and the one-click List-Unsubscribe header (RFC 8058) posts instead. '
            . 'Link destinations come from the table below, so the endpoint cannot be used as an open redirect.</p>';
        $links = $detail['links'];
        if ($links) {
            echo '<table class="table table-condensed" style="max-width:860px;"><tr><th style="width:60px;">Link</th><th>Destination</th></tr>';
            foreach ($links as $link) {
                echo '<tr><td>#' . (int) $link->id . '</td><td><code style="word-break:break-all;">' . $this->e($link->url) . '</code></td></tr>';
            }
            echo '</table>';
        } else {
            echo '<p class="text-muted">No links are registered yet: they are recorded the first time a message is composed for delivery.</p>';
        }

        echo '<h4>Bounce evidence</h4>';
        echo '<p class="text-muted">Paste a delivery status notification (DSN) from the mailbox. Only the recipient and the '
            . 'permanent/temporary classification are read; the message itself is never stored. Permanent failures suppress the '
            . 'address immediately, temporary ones count towards the soft-bounce threshold.</p>';
        echo '<form method="post" action="' . $this->base('campaign', array('id' => (int) $row->id)) . '">'
            . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" />'
            . '<input type="hidden" name="action" value="bounce.ingest" />'
            . '<textarea name="evidence" class="form-control" rows="4" placeholder="Final-Recipient: rfc822; someone@example.com&#10;Action: failed&#10;Status: 5.1.1"></textarea>'
            . '<button class="btn btn-sm btn-default" style="margin-top:6px;"' . ($canManage ? '' : ' disabled') . '>Process bounce evidence</button></form>';

        echo '<h4>Content preview</h4>';
        echo '<h5>Plain text</h5><pre style="white-space:pre-wrap;background:#f7f9fb;border:1px solid #e3e8ee;padding:10px;max-width:760px;">' . $this->e((string) $row->text) . '</pre>';
        echo '<h5>HTML source</h5><textarea readonly class="form-control" rows="10" style="font-family:monospace;font-size:12px;">' . $this->e((string) $row->html) . '</textarea>';
    }

    // -------------------------------------------------------------- templates

    /** One editable block row: only the fields that block type declares. */
    private function blockRow($index, array $block)
    {
        $type = (string) $block['type'];
        $definition = TemplateBlock::definition($type);
        echo '<fieldset style="border:1px solid #e3e8ee;padding:10px;margin-bottom:10px;">';
        echo '<legend style="font-size:13px;font-weight:bold;margin-bottom:0;">Block ' . ($index + 1) . ': ' . $this->e($definition['label']) . '</legend>';
        echo '<input type="hidden" name="block[' . $index . '][type]" value="' . $this->e($type) . '" />';
        foreach ($definition['fields'] as $name => $field) {
            $value = isset($block[$name]) && $block[$name] !== null ? $block[$name] : (isset($field['default']) ? $field['default'] : '');
            echo '<div style="margin-bottom:6px;"><label style="min-width:150px;display:inline-block;font-weight:normal;">' . $this->e($field['label']) . '</label>';
            if ($field['type'] === TemplateBlock::TYPE_ENUM) {
                echo '<select name="block[' . $index . '][' . $this->e($name) . ']" class="form-control" style="width:180px;display:inline-block;">';
                foreach ($field['values'] as $option) {
                    echo '<option value="' . $this->e($option) . '"' . ((string) $value === (string) $option ? ' selected' : '') . '>' . $this->e($option) . '</option>';
                }
                echo '</select>';
            } elseif ($field['type'] === TemplateBlock::TYPE_TEXTAREA) {
                echo '<textarea name="block[' . $index . '][' . $this->e($name) . ']" class="form-control" rows="4" style="max-width:560px;">' . $this->e($value) . '</textarea>';
            } else {
                echo '<input name="block[' . $index . '][' . $this->e($name) . ']" class="form-control" style="width:420px;display:inline-block;" value="' . $this->e($value) . '" />';
            }
            echo '<span class="text-muted" style="margin-left:6px;font-size:12px;">' . $this->e(isset($field['required']) && $field['required'] ? 'required' : 'optional') . '</span></div>';
        }
        echo '<label style="font-weight:normal;"><input type="checkbox" name="block[' . $index . '][remove]" value="1" /> remove this block</label>';
        echo '</fieldset>';
    }

    private function blockHelp(array $catalog)
    {
        echo '<details><summary class="text-muted">Blocks this build can render</summary><table class="table table-condensed" style="max-width:900px;">'
            . '<tr><th>Block</th><th>Fields</th><th>Notes</th></tr>';
        foreach ($catalog as $type => $block) {
            $fields = array();
            foreach ($block['fields'] as $name => $field) {
                $fields[] = $name . ' (' . $field['type'] . (empty($field['required']) ? '' : ', required') . ')';
            }
            echo '<tr><td><code>' . $this->e($type) . '</code><br /><span class="text-muted">' . $this->e($block['label']) . '</span></td>'
                . '<td>' . $this->e($fields ? implode(', ', $fields) : 'none') . '</td>'
                . '<td class="text-muted">' . $this->e($block['summary']) . '</td></tr>';
        }
        echo '</table></details>';
    }

    private function renderTemplates(array $data)
    {
        $view = $data['templatesView'];
        $canManage = !empty($view['canManage']);
        echo '<h4>Templates</h4>';
        echo '<p class="text-muted">A template is a list of catalog blocks. It renders once, when it is saved, into table-based HTML with inline styles plus a plain-text alternative — the preview, the stored copy and what a campaign sends are the same bytes.</p>';
        echo '<table class="table table-striped"><tr><th>Name</th><th>Key</th><th>Category</th><th>Design</th><th>Source</th><th>Status</th><th></th></tr>';
        foreach ($view['rows'] as $row) {
            echo '<tr><td><strong>' . $this->e($row->name) . '</strong></td><td><code>' . $this->e($row->template_key) . '</code></td>'
                . '<td>' . $this->e($row->category) . '</td><td>' . $this->e(isset($view['descriptions'][(int) $row->id]) ? $view['descriptions'][(int) $row->id] : '') . '</td>'
                . '<td>' . $this->e($row->source) . '</td><td>' . $this->e($row->status) . '</td><td>';
            echo '<a class="btn btn-xs btn-default" href="' . $this->base('template', array('id' => (int) $row->id)) . '">Edit</a> ';
            $toggle = $row->status === 'active' ? 'template.archive' : 'template.activate';
            echo '<form method="post" action="' . $this->base('templates') . '" style="display:inline;">'
                . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="' . $toggle . '" />'
                . '<input type="hidden" name="template_id" value="' . (int) $row->id . '" />'
                . '<button class="btn btn-xs btn-default"' . ($canManage ? '' : ' disabled') . '>' . ($row->status === 'active' ? 'Archive' : 'Reactivate') . '</button></form>';
            if ((string) $row->source !== 'builtin') {
                echo ' <form method="post" action="' . $this->base('templates') . '" style="display:inline;">'
                    . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="template.delete" />'
                    . '<input type="hidden" name="template_id" value="' . (int) $row->id . '" />'
                    . '<button class="btn btn-xs btn-link"' . ($canManage ? '' : ' disabled') . '>Delete</button></form>';
            }
            echo '</td></tr>';
        }
        if (!$view['rows']) { echo '<tr><td colspan="7" class="text-muted">No templates yet.</td></tr>'; }
        echo '</table>';

        echo '<h4>New template</h4>';
        echo '<form method="post" action="' . $this->base('templates') . '" style="max-width:980px;">'
            . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="template.save" />';
        echo '<table class="table"><tr><th style="width:160px;">Name</th><td><input name="name" class="form-control" /></td></tr>'
            . '<tr><th>Key</th><td><input name="template_key" class="form-control" style="max-width:320px;" /> <span class="text-muted">left blank it is derived from the name</span></td></tr>'
            . '<tr><th>Category</th><td><input name="category" class="form-control" style="max-width:220px;" value="general" /></td></tr>'
            . '<tr><th>Starts with</th><td><select name="add_block" class="form-control" style="width:220px;">';
        foreach ($view['catalog'] as $type => $block) { echo '<option value="' . $this->e($type) . '">' . $this->e($block['label']) . '</option>'; }
        echo '</select> <span class="text-muted">one catalog block; the rest are added in the editor</span></td></tr></table>';
        echo '<button class="btn btn-primary"' . ($canManage ? '' : ' disabled') . '>Create template</button></form>';
        $this->blockHelp($view['catalog']);
    }

    private function templatePreviewPanel(array $preview)
    {
        echo '<div class="panel panel-default"><div class="panel-heading"><strong>Preview</strong> <span class="text-muted">— exactly what will be stored and sent</span></div><div class="panel-body">';
        foreach ($preview['warnings'] as $warning) { echo '<div class="alert alert-warning">' . $this->e($warning) . '</div>'; }
        echo '<h5>Plain text</h5><pre style="white-space:pre-wrap;background:#f7f9fb;border:1px solid #e3e8ee;padding:10px;">' . $this->e($preview['text']) . '</pre>';
        echo '<h5>HTML source</h5><textarea readonly class="form-control" rows="12" style="font-family:monospace;font-size:12px;">' . $this->e($preview['html']) . '</textarea>';
        echo '<p class="text-muted" style="margin-top:8px;">The rendered HTML is shown as source on purpose: it is generated markup, and rendering it back into the admin page would be a needless second execution path.</p>';
        echo '</div></div>';
    }

    private function renderTemplateDetail(array $data)
    {
        $detail = $data['templateDetail'];
        $row = $detail['row'];
        $canManage = !empty($data['capabilities']['campaigns.manage']);
        echo '<a href="' . $this->base('templates') . '">&larr; All templates</a>';
        echo '<h4>Edit template: ' . $this->e($row->name) . ' <small>' . $this->e($row->source) . ' · ' . $this->e($row->status) . '</small></h4>';
        if ($detail['warnings']) {
            echo '<div class="alert alert-warning">This stored design has warnings — fix them before a campaign uses it.<ul style="margin:6px 0 0 18px;">';
            foreach ($detail['warnings'] as $warning) { echo '<li>' . $this->e($warning) . '</li>'; }
            echo '</ul></div>';
        }

        echo '<form method="post" action="' . $this->base('template', array('id' => (int) $row->id)) . '" style="max-width:980px;">'
            . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" />'
            . '<input type="hidden" name="template_id" value="' . (int) $row->id . '" />';
        echo '<table class="table"><tr><th style="width:160px;">Name</th><td><input name="name" class="form-control" value="' . $this->e($row->name) . '" /></td></tr>'
            . '<tr><th>Key</th><td><code>' . $this->e($row->template_key) . '</code> <span class="text-muted">campaigns reference the key, so it is permanent</span></td></tr>'
            . '<tr><th>Category</th><td><input name="category" class="form-control" style="max-width:220px;" value="' . $this->e($row->category) . '" /></td></tr></table>';

        foreach ($detail['design']['blocks'] as $index => $block) { $this->blockRow($index, $block); }
        if (!$detail['design']['blocks']) { echo '<p class="text-muted">This design has no blocks yet — add one below.</p>'; }

        echo '<div style="margin-bottom:12px;"><label style="font-weight:normal;">Add block: </label><select name="add_block" class="form-control" style="width:220px;display:inline-block;"><option value="">— choose —</option>';
        foreach ($detail['catalog'] as $type => $block) { echo '<option value="' . $this->e($type) . '">' . $this->e($block['label']) . '</option>'; }
        echo '</select> <span class="text-muted">added with catalog defaults when you save</span></div>';

        echo '<button class="btn btn-primary" name="action" value="template.save"' . ($canManage ? '' : ' disabled') . '>Save template</button> ';
        echo '<button class="btn btn-default" name="action" value="template.preview"' . ($canManage ? '' : ' disabled') . '>Preview</button>';
        echo '</form>';

        if (!empty($data['templatePreview'])) { $this->templatePreviewPanel($data['templatePreview']); }
        $this->blockHelp($detail['catalog']);
    }

    // --------------------------------------------------------------- segments

    private function fieldSelect($name, $selected)
    {
        $groups = array('Subscriber' => array(), 'Membership' => array(), 'Customer (read-only)' => array());
        foreach (SegmentField::all() as $key => $field) {
            if ($key === 'list' || $key === 'tag') { $groups['Membership'][$key] = $field['label']; }
            elseif (!empty($field['client'])) { $groups['Customer (read-only)'][$key] = $field['label']; }
            else { $groups['Subscriber'][$key] = $field['label']; }
        }
        echo '<select name="' . $this->e($name) . '" class="form-control" style="width:220px;display:inline-block;">';
        echo '<option value="">— field —</option>';
        foreach ($groups as $label => $fields) {
            echo '<optgroup label="' . $this->e($label) . '">';
            foreach ($fields as $key => $text) {
                echo '<option value="' . $this->e($key) . '"' . ($selected === $key ? ' selected' : '') . '>' . $this->e($text) . '</option>';
            }
            echo '</optgroup>';
        }
        echo '</select>';
    }

    private function operatorSelect($name, $selected)
    {
        echo '<select name="' . $this->e($name) . '" class="form-control" style="width:180px;display:inline-block;">';
        echo '<option value="">— operator —</option>';
        foreach (SegmentOperator::all() as $operator) {
            echo '<option value="' . $this->e($operator) . '"' . ($selected === $operator ? ' selected' : '') . '>' . $this->e(SegmentOperator::label($operator)) . '</option>';
        }
        echo '</select>';
    }

    /** One editable rule row; $rule may be null for the blank rows. */
    private function ruleRow($index, $rule)
    {
        $field = $rule && isset($rule['field']) ? (string) $rule['field'] : '';
        $operator = $rule && isset($rule['operator']) ? (string) $rule['operator'] : '';
        $value = '';
        if ($rule && isset($rule['value']) && $rule['value'] !== null) {
            $value = is_array($rule['value'])
                ? implode(', ', array_map(function ($item) { return is_bool($item) ? ($item ? 'yes' : 'no') : (string) $item; }, $rule['value']))
                : (is_bool($rule['value']) ? ($rule['value'] ? 'yes' : 'no') : (string) $rule['value']);
        }
        echo '<div style="margin-bottom:6px;">';
        $this->fieldSelect('rule_field[]', $field);
        echo ' ';
        $this->operatorSelect('rule_operator[]', $operator);
        echo ' <input name="rule_value[]" class="form-control" style="width:280px;display:inline-block;" value="' . $this->e($value) . '" />';
        echo '</div>';
    }

    private function ruleBuilder(array $definition)
    {
        $rules = isset($definition['rules']) ? $definition['rules'] : array();
        $match = isset($definition['match']) ? (string) $definition['match'] : 'all';
        echo '<label>Match</label> <select name="match" class="form-control" style="width:220px;display:inline-block;">'
            . '<option value="all"' . ($match === 'all' ? ' selected' : '') . '>every rule must match</option>'
            . '<option value="any"' . ($match === 'any' ? ' selected' : '') . '>at least one rule must match</option></select>';
        echo '<div style="margin:8px 0;">';
        $index = 0;
        foreach ($rules as $rule) { $this->ruleRow($index++, $rule); }
        for ($blank = 0; $blank < 3; $blank++) { $this->ruleRow($index++, null); }
        echo '</div>';
        echo '<details><summary class="text-muted">Fields and operators this build accepts</summary>';
        echo '<table class="table table-condensed" style="max-width:900px;"><tr><th>Field</th><th>Type</th><th>Operators</th><th>Value</th><th>Notes</th></tr>';
        foreach (SegmentField::all() as $key => $field) {
            $operators = array();
            foreach (SegmentOperator::forType($field['type']) as $operator) { $operators[] = SegmentOperator::label($operator); }
            $values = '';
            if ($field['type'] === SegmentField::TYPE_ENUM) { $values = implode(', ', SegmentField::values($key)); }
            elseif ($field['type'] === SegmentField::TYPE_BOOL) { $values = 'yes / no'; }
            elseif ($field['type'] === SegmentField::TYPE_DATE) { $values = 'YYYY-MM-DD, or whole days for the relative operators'; }
            elseif ($field['type'] === SegmentField::TYPE_REFERENCE) { $values = 'comma-separated keys'; }
            else { $values = 'text, comma-separated for is one of / is none of'; }
            echo '<tr><td><code>' . $this->e($key) . '</code><br /><span class="text-muted">' . $this->e($field['label']) . '</span></td>'
                . '<td>' . $this->e($field['type']) . '</td><td>' . $this->e(implode(', ', $operators)) . '</td>'
                . '<td>' . $this->e($values) . '</td><td class="text-muted">' . $this->e($field['hint']) . '</td></tr>';
        }
        echo '</table></details>';
    }

    private function renderSegments(array $data)
    {
        $view = $data['segmentsView'];
        $canManage = !empty($view['canManage']);
        echo '<h4>Segments</h4>';
        echo '<p class="text-muted">A segment is a saved question, not a list of people. Membership is evaluated live from the subscriber tables, list and tag memberships and read-only customer facts — nothing is copied, so nobody is mailed because of a stale sync.</p>';
        echo '<table class="table table-striped"><tr><th>Name</th><th>Key</th><th>Rules</th><th>Matching subscribers</th><th>Status</th><th></th></tr>';
        foreach ($view['rows'] as $row) {
            $meta = isset($view['definitions'][(int) $row->id]) ? $view['definitions'][(int) $row->id] : array('summary' => '', 'sentences' => array());
            echo '<tr><td><strong>' . $this->e($row->name) . '</strong>';
            if ((string) $row->description !== '') { echo '<br /><span class="text-muted">' . $this->e($row->description) . '</span>'; }
            echo '</td><td><code>' . $this->e($row->segment_key) . '</code></td>';
            echo '<td>' . $this->e($meta['summary']);
            if ($meta['sentences']) {
                echo '<br /><span class="text-muted" style="font-size:12px;">' . $this->e(implode('; ', $meta['sentences'])) . '</span>';
            }
            echo '</td>';
            echo '<td>';
            if ($row->cached_count === null) { echo '<span class="text-muted">not evaluated yet</span>'; }
            else { echo number_format((int) $row->cached_count) . ' <span class="text-muted" style="font-size:12px;">as at ' . $this->e($row->cached_at) . '</span>'; }
            echo '</td>';
            echo '<td>' . $this->e($row->status) . '</td><td>';
            echo '<a class="btn btn-xs btn-default" href="' . $this->base('segment', array('id' => (int) $row->id)) . '">Edit</a> ';
            echo '<form method="post" action="' . $this->base('segments') . '" style="display:inline;">'
                . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="segment.count" />'
                . '<input type="hidden" name="segment_id" value="' . (int) $row->id . '" />'
                . '<button class="btn btn-xs btn-default"' . ($canManage ? '' : ' disabled') . '>Refresh count</button></form> ';
            $toggle = $row->status === 'active' ? 'segment.archive' : 'segment.activate';
            echo '<form method="post" action="' . $this->base('segments') . '" style="display:inline;">'
                . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="' . $toggle . '" />'
                . '<input type="hidden" name="segment_id" value="' . (int) $row->id . '" />'
                . '<button class="btn btn-xs btn-default"' . ($canManage ? '' : ' disabled') . '>' . ($row->status === 'active' ? 'Archive' : 'Reactivate') . '</button></form>';
            echo '</td></tr>';
        }
        if (!$view['rows']) { echo '<tr><td colspan="6" class="text-muted">No segments yet.</td></tr>'; }
        echo '</table>';

        echo '<h4>New segment</h4>';
        echo '<form method="post" action="' . $this->base('segments') . '" style="max-width:980px;">'
            . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="segment.save" />';
        echo '<table class="table"><tr><th style="width:160px;">Name</th><td><input name="name" class="form-control" /></td></tr>'
            . '<tr><th>Key</th><td><input name="segment_key" class="form-control" style="max-width:320px;" /> <span class="text-muted">short identifier used by campaigns; left blank it is derived from the name</span></td></tr>'
            . '<tr><th>Description</th><td><input name="description" class="form-control" /></td></tr>'
            . '<tr><th>Rules</th><td>';
        $this->ruleBuilder(array('match' => 'all', 'rules' => array()));
        echo '</td></tr></table>';
        echo '<button class="btn btn-primary"' . ($canManage ? '' : ' disabled') . '>Create segment</button>';
        echo '</form>';
    }

    private function renderSegmentDetail(array $data)
    {
        $detail = $data['segmentDetail'];
        $row = $detail['row'];
        $canManage = !empty($data['capabilities']['campaigns.manage']);
        echo '<a href="' . $this->base('segments') . '">&larr; All segments</a>';
        echo '<h4>Edit segment: ' . $this->e($row->name) . ' <small>' . $this->e($row->status) . '</small></h4>';
        echo '<p class="text-muted">' . $this->e($detail['summary']) . '</p>';
        if ($detail['sentences']) {
            echo '<ul class="text-muted">';
            foreach ($detail['sentences'] as $sentence) { echo '<li>' . $this->e($sentence) . '</li>'; }
            echo '</ul>';
        }
        if ($row->cached_count === null) {
            echo '<div class="alert alert-warning">This segment has never been evaluated. The count shown in the list stays blank until a refresh runs; sending resolves the audience live.</div>';
        } else {
            echo '<p>Last evaluation: <strong>' . number_format((int) $row->cached_count) . '</strong> matching subscriber(s) as at ' . $this->e($row->cached_at) . '.</p>';
        }

        echo '<form method="post" action="' . $this->base('segment', array('id' => (int) $row->id)) . '" style="max-width:980px;">'
            . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="segment.save" />'
            . '<input type="hidden" name="segment_id" value="' . (int) $row->id . '" />';
        echo '<table class="table"><tr><th style="width:160px;">Name</th><td><input name="name" class="form-control" value="' . $this->e($row->name) . '" /></td></tr>'
            . '<tr><th>Key</th><td><code>' . $this->e($row->segment_key) . '</code> <span class="text-muted">keys are permanent once campaigns reference them</span></td></tr>'
            . '<tr><th>Description</th><td><input name="description" class="form-control" value="' . $this->e($row->description) . '" /></td></tr>'
            . '<tr><th>Rules</th><td>';
        $this->ruleBuilder($detail['definition']);
        echo '</td></tr></table>';
        echo '<button class="btn btn-primary"' . ($canManage ? '' : ' disabled') . '>Save changes</button>';
        echo '</form>';
    }

    // ------------------------------------------------------------------ lists

    private function renderLists(array $data)
    {
        $view = $data['listsView'];
        $canManage = !empty($data['capabilities']['subscribers.manage']);
        echo '<h4>Lists</h4>';
        echo '<table class="table table-striped"><tr><th>Name</th><th>Key</th><th>Status</th><th>Members</th><th>Description</th><th></th></tr>';
        foreach ($view['rows'] as $entry) {
            $list = $entry['list'];
            echo '<tr><td><strong>' . $this->e($list->name) . '</strong></td><td><code>' . $this->e($list->list_key) . '</code></td>'
                . '<td>' . $this->e($list->status) . '</td><td>' . (int) $entry['members'] . '</td>'
                . '<td>' . $this->e($list->description) . '</td><td>';
            if ($list->status === 'active') {
                echo '<form method="post" action="' . $this->base('lists') . '" style="display:inline;">'
                    . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="list.archive" />'
                    . '<input type="hidden" name="list_id" value="' . (int) $list->id . '" />'
                    . '<button class="btn btn-xs btn-default"' . ($canManage ? '' : ' disabled') . '>Archive</button></form>';
            }
            echo '</td></tr>';
        }
        if (!$view['rows']) { echo '<tr><td colspan="6" class="text-muted">No lists yet.</td></tr>'; }
        echo '</table>';

        echo '<h4>Create a list</h4><form method="post" action="' . $this->base('lists') . '" class="form-inline">'
            . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="list.save" />'
            . '<input class="form-control" name="name" placeholder="Newsletter" required /> '
            . '<input class="form-control" name="list_key" placeholder="newsletter (optional)" /> '
            . '<input class="form-control" name="description" placeholder="What this list is for" /> '
            . '<button class="btn btn-primary"' . ($canManage ? '' : ' disabled') . '>Create</button></form>';

        echo '<h4>Add addresses to a list</h4><form method="post" action="' . $this->base('lists') . '">'
            . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="list.members.add" />'
            . '<select class="form-control" name="list_id" style="max-width:280px;">';
        foreach ($view['rows'] as $entry) {
            if ($entry['list']->status !== 'active') { continue; }
            echo '<option value="' . (int) $entry['list']->id . '">' . $this->e($entry['list']->name) . '</option>';
        }
        echo '</select><textarea class="form-control" name="emails" rows="3" placeholder="one address per line, or comma separated" style="margin-top:6px;"></textarea>'
            . '<button class="btn btn-primary"' . ($canManage ? '' : ' disabled') . ' style="margin-top:6px;">Add addresses</button></form>'
            . '<p class="text-muted">Addresses that are suppressed are reported back as skipped — adding a list membership never overrides a suppression.</p>';
    }

    // ---------------------------------------------------------------- imports

    private function renderImport(array $data)
    {
        $view = $data['importView'];
        $canManage = !empty($data['capabilities']['subscribers.manage']);
        $preview = isset($data['importPreview']) ? $data['importPreview'] : null;

        echo '<h4>Import subscribers</h4>';
        echo '<p class="text-muted">CSV, TSV or one address per line. Preview first: the preview writes nothing, and the import refuses to run if the content or mapping changed afterwards. Limit: '
            . (int) $view['max_rows'] . ' rows per import.</p>';
        echo '<form method="post" action="' . $this->base('import') . '" enctype="multipart/form-data">'
            . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" />';
        echo '<table class="table" style="max-width:900px;"><tr><th style="width:220px;">Source file</th><td><input type="file" name="import_file" accept=".csv,.txt,.tsv,text/csv,text/plain" /></td></tr>'
            . '<tr><th>…or paste content</th><td><textarea class="form-control" name="content" rows="6" placeholder="email,first_name,last_name&#10;alice@example.com,Alice,Example">' . $this->e(isset($_POST['content']) ? (string) $_POST['content'] : '') . '</textarea></td></tr>'
            . '<tr><th>Source label</th><td><input class="form-control" name="source_label" value="' . $this->e(isset($_POST['source_label']) ? (string) $_POST['source_label'] : 'Pasted content') . '" /></td></tr>'
            . '<tr><th>Add to lists</th><td>';
        foreach ($view['lists'] as $list) {
            echo '<label class="checkbox-inline"><input type="checkbox" name="list_ids[]" value="' . (int) $list->id . '" /> ' . $this->e($list->name) . '</label> ';
        }
        echo '</td></tr><tr><th>Apply tags</th><td><input class="form-control" name="default_tags" placeholder="imported;2026-q4" /></td></tr>'
            . '<tr><th>Consent statement</th><td><select class="form-control" name="consent_status" style="max-width:320px;">';
        foreach ($view['consents'] as $consent) {
            echo '<option value="' . $this->e($consent) . '"' . ($consent === ConsentStatus::UNKNOWN ? ' selected' : '') . '>' . $this->e(ConsentStatus::label($consent)) . '</option>';
        }
        echo '</select><br /><input class="form-control" name="consent_source" placeholder="where this list came from (e.g. 2026 trade-show signup sheet)" style="margin-top:6px;" />'
            . '<br /><small class="text-muted">Importing addresses does not create consent. Record the real basis, or leave it as “no consent evidence”.</small></td></tr>';

        if ($preview) {
            echo '<tr><th>Column mapping</th><td>';
            foreach ($preview['mapping'] as $index => $field) {
                $label = $preview['has_header'] && isset($preview['header'][$index]) ? $preview['header'][$index] : 'Column ' . ((int) $index + 1);
                echo '<label class="form-inline" style="margin-right:10px;">' . $this->e($label) . ' <select class="form-control" name="mapping[' . (int) $index . ']">';
                foreach ($view['fields'] as $option) {
                    echo '<option value="' . $this->e($option) . '"' . ($field === $option ? ' selected' : '') . '>' . $this->e($option) . '</option>';
                }
                echo '</select></label>';
            }
            echo '</td></tr>';
        }
        echo '</table>';
        echo '<button class="btn btn-default" name="action" value="import.preview"' . ($canManage ? '' : ' disabled') . '>Preview import</button> ';
        if ($preview) {
            echo '<button class="btn btn-primary" name="action" value="import.apply"' . ($canManage ? '' : ' disabled') . '>Import now</button>'
                . '<input type="hidden" name="preview_hash" value="' . $this->e($preview['hash']) . '" />';
        }
        echo '</form>';

        if ($preview) {
            $c = $preview['counts'];
            echo '<h4>Preview — nothing has been written yet</h4>';
            echo '<table class="table table-condensed" style="max-width:620px;">'
                . '<tr><th>Rows read</th><td>' . (int) $c['total'] . '</td></tr>'
                . '<tr><th>Would be created</th><td>' . (int) $c['created'] . '</td></tr>'
                . '<tr><th>Would be updated</th><td>' . (int) $c['updated'] . '</td></tr>'
                . '<tr><th>Skipped — suppressed</th><td>' . (int) $c['skipped_suppressed'] . '</td></tr>'
                . '<tr><th>Skipped — invalid address</th><td>' . (int) $c['skipped_invalid'] . '</td></tr>'
                . '<tr><th>Skipped — duplicate in file</th><td>' . (int) $c['skipped_duplicate'] . '</td></tr>'
                . '<tr><th>Skipped — no address in the mapped column</th><td>' . (int) $c['skipped_empty'] . '</td></tr></table>';
            echo '<p class="text-muted">Press “Import now” to apply exactly this preview. If you change the content or the mapping, the hash changes and the import will ask you to preview again.</p>';
        }

        echo '<h4>Import history</h4><table class="table table-striped"><tr><th>#</th><th>Source</th><th>Status</th><th>Totals</th><th>Finished</th></tr>';
        foreach ($view['history'] as $row) {
            echo '<tr><td>' . (int) $row->id . '</td><td>' . $this->e($row->source_label) . '</td><td>' . $this->e($row->status) . '</td>'
                . '<td><code style="font-size:11px;">' . $this->e(isset($row->totals_json) ? (string) $row->totals_json : '') . '</code></td>'
                . '<td>' . $this->e(isset($row->finished_at) && $row->finished_at ? $row->finished_at : '—') . '</td></tr>';
        }
        if (!$view['history']) { echo '<tr><td colspan="5" class="text-muted">No imports yet.</td></tr>'; }
        echo '</table>';
    }

    // ----------------------------------------------------------- suppressions

    private function renderSuppressions(array $data)
    {
        $view = $data['suppressionsView'];
        $canManage = !empty($data['capabilities']['subscribers.manage']);
        echo '<h4>Suppression list <span class="text-muted" style="font-size:12px;">' . (int) $view['total'] . ' address(es) — nothing here can ever be mailed</span></h4>';
        echo '<div class="row" style="max-width:980px;">';
        foreach (SuppressionReason::all() as $reason) {
            echo '<div class="col-sm-2"><div class="panel panel-default"><div class="panel-body text-center">'
                . '<div style="font-size:20px;font-weight:600;">' . (int) $view['counts'][$reason] . '</div>'
                . '<div class="text-muted" style="font-size:11px;">' . $this->e(SuppressionReason::label($reason)) . '</div></div></div></div>';
        }
        echo '</div>';

        echo '<form method="get" action="addonmodules.php" class="form-inline" style="margin-bottom:10px;">'
            . '<input type="hidden" name="module" value="cloudhost247_marketing" /><input type="hidden" name="view" value="suppressions" />'
            . '<input class="form-control" name="q" value="' . $this->e($view['filters']['search']) . '" placeholder="Search address" /> '
            . '<select class="form-control" name="reason"><option value="">Any reason</option>';
        foreach ($view['reasons'] as $reason) {
            echo '<option value="' . $this->e($reason) . '"' . ($view['filters']['reason'] === $reason ? ' selected' : '') . '>' . $this->e(SuppressionReason::label($reason)) . '</option>';
        }
        echo '</select> <button class="btn btn-default">Filter</button></form>';

        echo '<table class="table table-striped"><tr><th>Email</th><th>Reason</th><th>Source</th><th>Detail</th><th>Added</th><th></th></tr>';
        foreach ($view['rows'] as $row) {
            echo '<tr><td>' . $this->e($row->email) . '</td><td>' . $this->e(SuppressionReason::label((string) $row->reason)) . '</td>'
                . '<td>' . $this->e($row->source) . '</td><td>' . $this->e($row->detail) . '</td><td>' . $this->e($row->created_at) . '</td><td>'
                . '<form method="post" action="' . $this->base('suppressions') . '" class="form-inline">'
                . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="suppression.release" />'
                . '<input type="hidden" name="email" value="' . $this->e($row->email) . '" />';
            $protected = in_array((string) $row->reason, array(SuppressionReason::SPAM_COMPLAINT, SuppressionReason::HARD_BOUNCE), true);
            if ($protected) {
                echo '<label class="checkbox-inline" style="font-size:11px;"><input type="checkbox" name="force" value="1" /> confirm</label> ';
            }
            echo '<button class="btn btn-xs btn-default"' . ($canManage ? '' : ' disabled') . '>Release</button></form></td></tr>';
        }
        if (!$view['rows']) { echo '<tr><td colspan="6" class="text-muted">Nothing suppressed.</td></tr>'; }
        echo '</table>';
        $this->pagination('suppressions', $view['page'], $view['pages'], array('q' => $view['filters']['search'], 'reason' => $view['filters']['reason']));

        echo '<h4>Suppress an address</h4><form method="post" action="' . $this->base('suppressions') . '" class="form-inline">'
            . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" /><input type="hidden" name="action" value="suppression.add" />'
            . '<input class="form-control" name="email" placeholder="email@example.com" required /> '
            . '<select class="form-control" name="reason">';
        foreach ($view['reasons'] as $reason) {
            echo '<option value="' . $this->e($reason) . '">' . $this->e(SuppressionReason::label($reason)) . '</option>';
        }
        echo '</select> <input class="form-control" name="detail" placeholder="detail (optional)" /> '
            . '<button class="btn btn-primary"' . ($canManage ? '' : ' disabled') . '>Suppress</button></form>';
    }

    private function pagination($view, $page, $pages, array $query = array())
    {
        if ($pages <= 1) { return; }
        echo '<ul class="pagination">';
        for ($i = 1; $i <= min($pages, 25); $i++) {
            echo '<li class="' . ($i === (int) $page ? 'active' : '') . '"><a href="' . $this->base($view, array_merge($query, array('page' => $i))) . '">' . $i . '</a></li>';
        }
        echo '</ul>';
    }

    private function renderSettings(array $data)
    {
        $s = $data['settings'];
        $canEdit = !empty($data['capabilities']['settings.manage']);
        $field = function ($key, $label, $help = '') use ($s) {
            echo '<tr><td style="width:240px;"><strong>' . $this->e($label) . '</strong>'
                . ($help !== '' ? '<br><small class="text-muted">' . $this->e($help) . '</small>' : '')
                . '</td><td><input class="form-control" name="setting[' . $this->e($key) . ']" value="' . $this->e(isset($s[$key]) ? $s[$key] : '') . '" /></td></tr>';
        };
        echo '<h4>Operational settings</h4>';
        if (!$canEdit) { echo '<div class="alert alert-warning">Your WHMCS role lacks the marketing.settings.manage capability; settings are read-only for you.</div>'; }
        echo '<form method="post" action="addonmodules.php?module=cloudhost247_marketing&amp;view=settings">'
            . '<input type="hidden" name="token" value="' . $this->e($this->token()) . '" />'
            . '<table class="table table-striped" style="max-width:860px;">';
        echo '<tr><th colspan="2">Sender identity (non-secret; credentials live in API &amp; Integrations)</th></tr>';
        $field('default_from_name', 'Default from name');
        $field('default_from_email', 'Default from email', 'Must belong to the domain of the configured cpanel_smtp account.');
        $field('default_reply_to', 'Default reply-to');
        echo '<tr><th colspan="2">Throttling (cPanel hosts differ — tune to the real host limits)</th></tr>';
        $field('batch_size', 'Worker batch size', 'Messages taken per worker run.');
        $field('messages_per_minute', 'Messages per minute');
        $field('hourly_limit', 'Hourly limit', 'Rolling per-provider sending ceiling.');
        $field('concurrent_workers', 'Concurrent workers', 'Workers coordinate through DB locks; keep at 1 unless the host allows more.');
        echo '<tr><th colspan="2">Retries &amp; bounces</th></tr>';
        $field('retry_attempts', 'Retry attempts', '0 disables retries.');
        $field('retry_backoff_minutes', 'Retry backoff (minutes)', 'Comma-separated, e.g. 5,30,120.');
        $field('bounce_soft_threshold', 'Soft-bounce threshold', 'Soft bounces before suppression.');
        echo '<tr><th colspan="2">Tracking &amp; compliance</th></tr>';
        $field('tracking_base_url', 'Public tracking base URL', 'Where the tracking endpoint is reachable by recipients, e.g. https://cloudhost247.com. Required before a campaign can be scheduled: unsubscribe links live there.');
        $select = function ($key, $label, $help = '') use ($s) {
            $value = isset($s[$key]) ? $s[$key] : '0';
            echo '<tr><td><strong>' . $this->e($label) . '</strong>' . ($help !== '' ? '<br><small class="text-muted">' . $this->e($help) . '</small>' : '')
                . '</td><td><select class="form-control" name="setting[' . $this->e($key) . ']">'
                . '<option value="1"' . ($value === '1' ? ' selected' : '') . '>Enabled</option>'
                . '<option value="0"' . ($value === '1' ? '' : ' selected') . '>Disabled</option></select></td></tr>';
        };
        $select('enabled', 'Marketing sending enabled', 'Master switch — disabling stops the worker from claiming new messages.');
        $select('open_tracking_enabled', 'Open (pixel) tracking', 'Recorded as tracking events; mail clients may prefetch images.');
        $select('click_tracking_enabled', 'Click tracking', 'Campaign links are rewritten to validated tracking URLs.');
        $field('company_name', 'Company name', 'Shown in the mandatory email footer.');
        $field('physical_address', 'Physical business address', 'Required on every marketing email (spec #34).');
        $field('support_url', 'Support URL');
        $field('account_url', 'Client account URL');
        $field('footer_html', 'Custom footer HTML fragment', 'Optional; the unsubscribe + address block is always appended automatically.');
        $field('compliance_note', 'Compliance note');
        echo '<tr><th colspan="2">System</th></tr>';
        $field('default_timezone', 'Admin timezone', 'IANA timezone name used to display schedules.');
        $field('queue_lock_seconds', 'Queue claim lock (seconds)');
        $field('events_retention_days', 'Event retention (days)');
        $field('default_provider', 'Delivery provider', 'Fixed to cpanel_smtp until another provider is added through API & Integrations.');
        echo '</table>';
        if ($canEdit) { echo '<button class="btn btn-primary" type="submit">Save settings</button>'; }
        echo '</form>';
    }
}
