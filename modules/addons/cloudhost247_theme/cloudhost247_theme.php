<?php
if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }
require_once __DIR__ . '/../cloudhost247_core/bootstrap.php';
require_once __DIR__ . '/migrations/V100.php';
use CloudHost247\Foundation\Database\MigrationRunner;
use CloudHost247\Foundation\Security\AdminGuard;
use WHMCS\Database\Capsule;

function cloudhost247_theme_config()
{
    return array('name' => 'CloudHost247 Theme Manager', 'description' => 'Independent branding, navigation, content and SEO foundation.', 'version' => '1.0.0', 'author' => 'CloudHost247', 'language' => 'english', 'fields' => array());
}
function cloudhost247_theme_activate()
{
    try {
        if (!class_exists('CloudHost247\Foundation\Database\MigrationRunner')) throw new RuntimeException('Install the CloudHost247 Foundation files first.');
        $migration = new \CloudHost247\Theme\Migrations\ThemeInitialMigration();
        $applied = (new MigrationRunner())->run('cloudhost247_theme', array($migration));
        return array('status' => 'success', 'description' => 'Theme settings and content repositories are ready. Applied: ' . (count($applied) ? implode(', ', $applied) : 'already current'));
    } catch (\Throwable $e) { return array('status' => 'error', 'description' => $e->getMessage()); }
}
function cloudhost247_theme_deactivate() { return array('status' => 'success', 'description' => 'Data retained. No WHMCS or legacy vendor tables were changed.'); }
function cloudhost247_theme_output($vars)
{
    AdminGuard::requireAdmin();
    echo '<h2>CloudHost247 Theme Manager</h2><div class="alert alert-info">Independent module version 1.0.0. Vendor licence keys are neither requested nor consumed.</div>';
    echo '<p>Theme settings and content repositories are ready.</p><p>Phase 1 provides the secure, non-destructive foundation; feature workflows are tracked in the parity matrix.</p>';
}
