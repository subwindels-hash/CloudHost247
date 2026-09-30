<?php
/**
 * CloudHost247 Cart Recovery — WHMCS addon entry point.
 *
 * Abandoned-cart capture, secure recovery links, reminder scheduling through
 * the existing WHMCS email system, and conversion analytics. WHMCS remains
 * the source of truth for the shopping cart, orders and invoices.
 */

if (!defined('WHMCS')) {
    die('Direct access denied');
}

require_once __DIR__ . '/bootstrap.php';

use CloudHost247\CartRecovery\AdminController;
use CloudHost247\CartRecovery\EmailService;
use CloudHost247\CartRecovery\Log;
use CloudHost247\CartRecovery\MigrationRunner;
use CloudHost247\CartRecovery\SettingsRepository;

function cloudhost247_cart_recovery_config()
{
    return array(
        'name' => 'CloudHost247 Cart Recovery',
        'description' => 'Abandoned cart capture, secure recovery links, reminder emails through the WHMCS mail system, and recovery/conversion analytics.',
        'version' => '1.0.0',
        'author' => 'CloudHost247',
        'language' => 'english',
        // Runtime configuration lives on the addon dashboard so it can be
        // validated and documented; no duplicated settings here.
        'fields' => array(),
    );
}

function cloudhost247_cart_recovery_activate()
{
    try {
        MigrationRunner::migrate();
        SettingsRepository::seed();
        $created = EmailService::ensureTemplates();
        Log::info('addon.activated', array('templates_created' => $created));
        return array(
            'status' => 'success',
            'description' => 'Cart Recovery installed. Schedule the cron job documented in the addon README and review the three '
                . '"CloudHost247 Abandoned Cart Reminder" templates under Setup → Email Templates.',
        );
    } catch (\Throwable $e) {
        Log::error('addon.activation_failed', array('error' => Log::safeError($e)));
        return array(
            'status' => 'error',
            'description' => 'Installation failed: ' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8'),
        );
    }
}

/**
 * Deactivation stops tracking, reminders and recovery links (every entry
 * point checks that the addon is active) but deliberately keeps historical
 * data. Deleting recovery history requires an explicit, destructive action.
 */
function cloudhost247_cart_recovery_deactivate()
{
    Log::info('addon.deactivated', array());
    return array(
        'status' => 'success',
        'description' => 'Cart Recovery disabled. Tracking, reminders and recovery links are now inactive; '
            . 'historical recovery, reminder and suppression data has been retained.',
    );
}

function cloudhost247_cart_recovery_upgrade($vars)
{
    try {
        MigrationRunner::migrate();
        SettingsRepository::seed();
        EmailService::ensureTemplates();
    } catch (\Throwable $e) {
        Log::error('addon.upgrade_failed', array('error' => Log::safeError($e)));
    }
}

function cloudhost247_cart_recovery_output($vars)
{
    try {
        $view = AdminController::handle(is_array($vars) ? $vars : array());
        require __DIR__ . '/templates/admin/index.tpl';
    } catch (\Throwable $e) {
        Log::error('admin.render_failed', array('error' => Log::safeError($e)));
        echo '<div class="alert alert-danger">The Cart Recovery dashboard could not be displayed. '
            . 'Check the module log for details.</div>';
    }
}

/**
 * Client-area sidebar entry is intentionally not registered: cart recovery is
 * an administrative feature plus two public endpoints (recover / unsubscribe).
 */
function cloudhost247_cart_recovery_sidebar($vars)
{
    return '';
}
