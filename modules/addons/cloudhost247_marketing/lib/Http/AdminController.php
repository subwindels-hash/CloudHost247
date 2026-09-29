<?php
namespace CloudHost247\Marketing\Http;

use CloudHost247\Foundation\Security\AdminGuard;
use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Integrations\Services\IntegrationManager;
use CloudHost247\Integrations\Support\ResultCode;
use CloudHost247\Marketing\Domain\CampaignStatus;
use CloudHost247\Marketing\Domain\QueueStatus;
use CloudHost247\Marketing\Domain\SubscriberStatus;
use CloudHost247\Marketing\Repositories\SettingsRepository;
use CloudHost247\Marketing\Security\InputValidator;
use WHMCS\Database\Capsule;

/**
 * Admin dispatcher. Only views and operations that actually exist are
 * routable — later sessions register theirs here. Everything is capability-
 * and CSRF-guarded; every state change is audit-logged.
 */
final class AdminController
{
    const PROVIDER_KEY = 'cpanel_smtp';

    private $settings;

    public function __construct(SettingsRepository $settings = null)
    {
        $this->settings = $settings ?: new SettingsRepository();
    }

    public function handle()
    {
        AdminGuard::requireAdmin();
        $view = isset($_GET['view']) ? (string) $_GET['view'] : 'dashboard';
        if (!in_array($view, array('dashboard', 'settings'), true)) { $view = 'dashboard'; }

        $notice = '';
        $error = '';
        if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '') === 'POST') {
            if ($view === 'settings') {
                $notice = $this->saveSettings();
                if (substr($notice, 0, 6) === 'Error:') { $error = $notice; $notice = ''; }
            }
        }

        return array(
            'view' => $view,
            'notice' => $notice,
            'error' => $error,
            'stats' => $this->dashboardStats(),
            'settings' => $this->settings->all(),
            'integration' => $this->integrationStatus(),
            'tables' => $this->tableHealth(),
            'capabilities' => array(
                'settings.manage' => $this->capAllowed('marketing.settings.manage'),
                'campaigns.manage' => $this->capAllowed('marketing.campaigns.manage'),
                'subscribers.manage' => $this->capAllowed('marketing.subscribers.manage'),
                'sending.manage' => $this->capAllowed('marketing.sending.manage'),
                'analytics.view' => $this->capAllowed('marketing.analytics.view'),
            ),
        );
    }

    /** Mirrors requireCapability() semantics exactly: no policy row means normal addon authorization. */
    private function capAllowed($capability)
    {
        try {
            AdminGuard::requireCapability('cloudhost247_marketing', $capability);
            return true;
        } catch (\Throwable $error) {
            return false;
        }
    }

    /** Real counters from the module tables only — zero means zero, never fabricated. */
    private function dashboardStats()
    {
        $count = function ($table, $column = null, $value = null) {
            $query = Capsule::table($table);
            if ($column !== null) { $query->where($column, (string) $value); }
            $row = $query->selectRaw('COUNT(*) AS aggregate')->first();
            return $row ? (int) $row->aggregate : 0;
        };
        $subscribers = array();
        foreach (SubscriberStatus::all() as $status) {
            $subscribers[$status] = $count('mod_cloudhost247_marketing_subscribers', 'status', $status);
        }
        $campaigns = array();
        foreach (CampaignStatus::all() as $status) {
            $campaigns[$status] = $count('mod_cloudhost247_marketing_campaigns', 'status', $status);
        }
        $queue = array();
        foreach (QueueStatus::all() as $status) {
            $queue[$status] = $count('mod_cloudhost247_marketing_email_queue', 'status', $status);
        }
        return array(
            'subscribers' => $subscribers,
            'subscriber_total' => $count('mod_cloudhost247_marketing_subscribers'),
            'suppressed_total' => $count('mod_cloudhost247_marketing_suppressions'),
            'lists_total' => $count('mod_cloudhost247_marketing_lists', 'status', 'active'),
            'campaigns' => $campaigns,
            'queue' => $queue,
            'events_total' => $count('mod_cloudhost247_marketing_email_events'),
        );
    }

    /** Non-secret integration status only (spec #16: credentials stay in the vault). */
    private function integrationStatus()
    {
        $status = array(
            'key' => self::PROVIDER_KEY,
            'configured' => false,
            'tested' => false,
            'result_code' => '',
            'result_label' => 'Not configured',
            'last_checked_at' => '',
            'configure_url' => 'addonmodules.php?module=cloudhost247_integrations&view=configure&integration=' . self::PROVIDER_KEY,
            'events_url' => 'addonmodules.php?module=cloudhost247_integrations&view=events&provider_key=' . self::PROVIDER_KEY,
        );
        try {
            if (!IntegrationManager::installed()) { return $status; }
            $row = IntegrationManager::repository()->findFor(
                self::PROVIDER_KEY,
                \CloudHost247\Integrations\Support\Environment::active()
            );
            if (!$row) { return $status; }
            $status['configured'] = (int) $row->enabled === 1;
            $status['result_code'] = isset($row->status) ? (string) $row->status : '';
            if ($status['result_code'] !== '') {
                $status['result_label'] = ResultCode::label($status['result_code']);
            } elseif ($status['configured']) {
                $status['result_label'] = 'Configured — connection test pending';
            } else {
                $status['result_label'] = 'Configured but disabled';
            }
            $status['last_checked_at'] = isset($row->last_checked_at) && $row->last_checked_at ? (string) $row->last_checked_at : '';
            $status['tested'] = $status['last_checked_at'] !== '';
        } catch (\Throwable $error) {
            // Status readout must never break the dashboard.
        }
        return $status;
    }

    private function tableHealth()
    {
        $tables = array(
            'mod_cloudhost247_marketing_campaigns', 'mod_cloudhost247_marketing_subscribers',
            'mod_cloudhost247_marketing_lists', 'mod_cloudhost247_marketing_list_members',
            'mod_cloudhost247_marketing_segments', 'mod_cloudhost247_marketing_templates',
            'mod_cloudhost247_marketing_campaign_recipients', 'mod_cloudhost247_marketing_email_queue',
            'mod_cloudhost247_marketing_email_events', 'mod_cloudhost247_marketing_suppressions',
            'mod_cloudhost247_marketing_automations', 'mod_cloudhost247_marketing_automation_steps',
            'mod_cloudhost247_marketing_automation_runs', 'mod_cloudhost247_marketing_imports',
            'mod_cloudhost247_marketing_links', 'mod_cloudhost247_marketing_settings',
        );
        $health = array();
        foreach ($tables as $table) {
            $exists = false;
            try { $exists = Capsule::schema()->hasTable($table); } catch (\Throwable $error) {}
            $health[$table] = $exists;
        }
        return $health;
    }

    private function saveSettings()
    {
        AdminGuard::requirePostToken();
        AdminGuard::requireCapability('cloudhost247_marketing', 'marketing.settings.manage');
        $before = $this->settings->all();
        $input = isset($_POST['setting']) && is_array($_POST['setting']) ? $_POST['setting'] : array();
        try {
            $sanitized = array();
            foreach ($this->settings->defaults() as $key => $default) {
                if (!array_key_exists($key, $input)) { continue; }
                $value = (string) $input[$key];
                switch ($key) {
                    case 'batch_size': $value = (string) InputValidator::positiveInt($value, 1, 500, 'Batch size'); break;
                    case 'messages_per_minute': $value = (string) InputValidator::positiveInt($value, 1, 600, 'Messages per minute'); break;
                    case 'hourly_limit': $value = (string) InputValidator::positiveInt($value, 1, 100000, 'Hourly limit'); break;
                    case 'concurrent_workers': $value = (string) InputValidator::positiveInt($value, 1, 8, 'Concurrent workers'); break;
                    case 'retry_attempts': $value = (string) InputValidator::positiveInt($value, 0, 10, 'Retry attempts'); break;
                    case 'bounce_soft_threshold': $value = (string) InputValidator::positiveInt($value, 1, 20, 'Bounce threshold'); break;
                    case 'queue_lock_seconds': $value = (string) InputValidator::positiveInt($value, 30, 3600, 'Queue lock seconds'); break;
                    case 'events_retention_days': $value = (string) InputValidator::positiveInt($value, 7, 730, 'Events retention'); break;
                    case 'enabled':
                    case 'open_tracking_enabled':
                    case 'click_tracking_enabled': $value = $value === '1' ? '1' : '0'; break;
                    case 'default_from_email':
                    case 'default_reply_to': $value = $value === '' ? '' : InputValidator::email($value, $key); break;
                    case 'default_timezone':
                        $value = trim($value);
                        if (!in_array($value, \DateTimeZone::listIdentifiers(), true)) {
                            throw new \InvalidArgumentException('Unknown timezone: ' . $value);
                        }
                        break;
                    case 'retry_backoff_minutes':
                        $parts = preg_split('/[,\s]+/', $value, -1, PREG_SPLIT_NO_EMPTY);
                        $clean = array();
                        foreach ($parts as $part) { $clean[] = (string) InputValidator::positiveInt($part, 1, 10080, 'Backoff step'); }
                        if (!$clean) { throw new \InvalidArgumentException('At least one retry backoff step is required.'); }
                        $value = implode(',', $clean);
                        break;
                    case 'support_url':
                    case 'account_url': $value = $value === '' ? '' : InputValidator::url($value, $key); break;
                    case 'default_from_name':
                    case 'company_name': $value = InputValidator::shortText($value, 128, $key); break;
                    case 'physical_address': $value = InputValidator::shortText($value, 500, $key); break;
                    case 'compliance_note': $value = InputValidator::shortText($value, 500, $key); break;
                    case 'footer_html':
                        // Sanitized when rendered by the footer builder (Service layer);
                        // store only a bounded fragment here.
                        $value = InputValidator::shortText($value, 4000, $key);
                        break;
                    case 'default_provider':
                        $value = InputValidator::key($value, 'Default provider');
                        if ($value !== self::PROVIDER_KEY) {
                            throw new \InvalidArgumentException('Only the cpanel_smtp delivery provider exists; additional providers can be added through CloudHost247 API & Integrations without changing this module.');
                        }
                        break;
                    default:
                        $value = InputValidator::shortText($value, 255, $key);
                }
                $sanitized[$key] = $value;
            }
            foreach ($sanitized as $key => $value) { $this->settings->set($key, $value); }
            AuditLogger::record('cloudhost247_marketing', 'settings.updated', 'marketing_settings', 'default', array('keys' => array_keys($sanitized)), array('keys' => array_keys($sanitized)), 'success');
            return 'Settings saved.';
        } catch (\InvalidArgumentException $e) {
            AuditLogger::record('cloudhost247_marketing', 'settings.updated', 'marketing_settings', 'default', array('keys' => array_keys($before)), array(), 'failed', $e->getMessage());
            return 'Error: ' . $e->getMessage();
        }
    }
}
