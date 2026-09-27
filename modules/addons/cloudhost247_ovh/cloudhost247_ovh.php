<?php
if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }
require_once __DIR__ . '/../cloudhost247_core/bootstrap.php';
require_once __DIR__ . '/migrations/V100.php';
use CloudHost247\Foundation\Database\MigrationRunner;
use CloudHost247\Foundation\Security\AdminGuard;
use WHMCS\Database\Capsule;

function cloudhost247_ovh_config()
{
    return array('name' => 'CloudHost247 OVH', 'description' => 'Independent OVH catalog, service mapping and job foundation.', 'version' => '1.0.0', 'author' => 'CloudHost247', 'language' => 'english', 'fields' => array());
}
function cloudhost247_ovh_activate()
{
    try {
        if (!class_exists('CloudHost247\Foundation\Database\MigrationRunner')) throw new RuntimeException('Install the CloudHost247 Foundation files first.');
        $migration = new \CloudHost247\Ovh\Migrations\OvhInitialMigration();
        $applied = (new MigrationRunner())->run('cloudhost247_ovh', array($migration));
        return array('status' => 'success', 'description' => 'Endpoint metadata, mappings and idempotent job repositories are ready. OVH credentials remain in encrypted WHMCS server configuration. Applied: ' . (count($applied) ? implode(', ', $applied) : 'already current'));
    } catch (\Throwable $e) { return array('status' => 'error', 'description' => $e->getMessage()); }
}
function cloudhost247_ovh_deactivate() { return array('status' => 'success', 'description' => 'Data retained. No WHMCS or legacy vendor tables were changed.'); }
function cloudhost247_ovh_output($vars)
{
    AdminGuard::requireAdmin();
    echo '<h2>CloudHost247 OVH</h2><div class="alert alert-info">Independent module version 1.0.0. Vendor licence keys are neither requested nor consumed.</div>';
    echo '<p>Endpoint metadata, mappings and idempotent job repositories are ready. OVH credentials remain in encrypted WHMCS server configuration.</p><p>Phase 1 provides the secure, non-destructive foundation; feature workflows are tracked in the parity matrix.</p>';
}
