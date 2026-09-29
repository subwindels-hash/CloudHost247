<?php
/**
 * CloudHost247 Marketing — native email marketing & campaign builder.
 *
 * Delivery credentials are managed exclusively in CloudHost247 API &
 * Integrations (provider key: cpanel_smtp); this module never stores SMTP
 * passwords. Campaign delivery is queue-and-worker based (crons/
 * cloudhost247_marketing.php) and never reuses the WHMCS transactional
 * mailer for marketing messages (see docs/independent-rebuild/
 * EMAIL-MARKETING.md).
 */
if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/migrations/V100.php';

use CloudHost247\Foundation\Database\MigrationRunner;
use CloudHost247\Foundation\Support\Logger;
use CloudHost247\Marketing\Http\AdminController;
use CloudHost247\Marketing\Http\AdminView;
use CloudHost247\Marketing\Migrations\InitialMigration;
use CloudHost247\Marketing\Repositories\SettingsRepository;

function cloudhost247_marketing_config()
{
    return array(
        'name' => 'CloudHost247 Marketing',
        'description' => 'Native email marketing: campaigns, subscribers, lists, segments, templates, visual builder, queue-based cPanel SMTP delivery, tracking, suppression and automation.',
        'version' => '1.0.0',
        'author' => 'CloudHost247',
        'language' => 'english',
        'fields' => array(),
    );
}

function cloudhost247_marketing_activate()
{
    try {
        (new MigrationRunner())->run('cloudhost247_marketing', array(new InitialMigration()));
        (new SettingsRepository())->seedDefaults();
        return array(
            'status' => 'success',
            'description' => 'Marketing platform tables installed non-destructively. Configure cPanel SMTP from Super Admin -> API & Integrations (integration key: cpanel_smtp), then schedule crons/cloudhost247_marketing.php from the system crontab.',
        );
    } catch (\Throwable $e) {
        return array('status' => 'error', 'description' => $e->getMessage());
    }
}

function cloudhost247_marketing_deactivate()
{
    // Non-destructive: campaigns, subscribers, lists, segments, templates,
    // queue, events, suppressions, automations and imports are all retained.
    return array('status' => 'success', 'description' => 'Marketing deactivated. All data was retained; re-activation is non-destructive.');
}

function cloudhost247_marketing_output($vars)
{
    try {
        $data = (new AdminController())->handle();
    } catch (\Throwable $e) {
        echo '<div class="alert alert-danger">The Marketing module could not load: ' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8') . '</div>';
        Logger::write('cloudhost247_marketing', 'error', 'admin.output_failed', array('message' => $e->getMessage()));
        return;
    }
    try {
        (new AdminView())->render($data);
    } catch (\Throwable $e) {
        echo '<div class="alert alert-danger">The Marketing admin view failed to render: ' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8') . '</div>';
    }
}
