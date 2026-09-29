<?php
namespace CloudHost247\Marketing\Http;

use CloudHost247\Marketing\Domain\CampaignStatus;
use CloudHost247\Marketing\Domain\QueueStatus;
use CloudHost247\Marketing\Domain\SubscriberStatus;

/** WHMCS-admin-markup renderer (same conventions as the other first-party modules). */
final class AdminView
{
    private function e($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }

    private function token()
    {
        return function_exists('generate_token') ? generate_token('plain') : '';
    }

    public function render(array $data)
    {
        echo '<h2>CloudHost247 Marketing <small style="font-size:12px;">v1.0.0 — queue-based campaigns via cPanel SMTP</small></h2>';
        if ($data['error'] !== '') { echo '<div class="alert alert-danger">' . $this->e($data['error']) . '</div>'; }
        if ($data['notice'] !== '') { echo '<div class="alert alert-success">' . $this->e($data['notice']) . '</div>'; }
        echo '<ul class="nav nav-tabs" role="tablist">'
            . '<li role="presentation" class="' . ($data['view'] === 'dashboard' ? 'active' : '') . '"><a href="addonmodules.php?module=cloudhost247_marketing">Dashboard</a></li>'
            . '<li role="presentation" class="' . ($data['view'] === 'settings' ? 'active' : '') . '"><a href="addonmodules.php?module=cloudhost247_marketing&amp;view=settings">Delivery Settings</a></li>'
            . '</ul><div style="margin-top:14px;">';
        if ($data['view'] === 'settings') { $this->renderSettings($data); }
        else { $this->renderDashboard($data); }
        echo '</div>';
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
