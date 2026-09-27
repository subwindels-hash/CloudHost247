<?php
if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }
require_once __DIR__ . '/bootstrap.php';

use CloudHost247\Foundation\Database\MigrationRunner;
use CloudHost247\Foundation\Security\AdminGuard;
use CloudHost247\Foundation\Support\HealthCheck;
use WHMCS\Database\Capsule;

function cloudhost247_core_config()
{
    return array('name' => 'CloudHost247 Foundation', 'description' => 'Independent shared security, migration and audit infrastructure.', 'version' => '1.0.0', 'author' => 'CloudHost247', 'language' => 'english', 'fields' => array());
}
function cloudhost247_core_activate()
{
    try {
        (new MigrationRunner())->ensureRepository();
        if (!Capsule::schema()->hasTable('mod_cloudhost247_logs')) Capsule::schema()->create('mod_cloudhost247_logs', function ($t) {
            $t->bigIncrements('id'); $t->string('module', 64); $t->string('level', 16); $t->string('event', 128); $t->string('correlation_id', 64)->index(); $t->text('context_json')->nullable(); $t->dateTime('created_at')->index();
        });
        if (!Capsule::schema()->hasTable('mod_cloudhost247_capabilities')) Capsule::schema()->create('mod_cloudhost247_capabilities', function ($t) {
            $t->bigIncrements('id'); $t->string('module', 64); $t->string('capability', 64); $t->string('role_ids', 255)->default(''); $t->unique(array('module', 'capability'), 'ch247_capability_unique');
        });
        return array('status' => 'success', 'description' => 'Foundation tables installed non-destructively.');
    } catch (\Throwable $e) { return array('status' => 'error', 'description' => $e->getMessage()); }
}
function cloudhost247_core_deactivate() { return array('status' => 'success', 'description' => 'Data retained for safe rollback.'); }
function cloudhost247_core_output($vars)
{
    AdminGuard::requireAdmin(); $checks = HealthCheck::run();
    echo '<h2>CloudHost247 Foundation</h2><p>Version 1.0.0. Deactivation preserves all data.</p><table class="table table-striped"><thead><tr><th>Capability</th><th>Status</th></tr></thead><tbody>';
    foreach ($checks as $name => $ok) echo '<tr><td>' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8') . '</td><td>' . ($ok ? '<span class="label label-success">Ready</span>' : '<span class="label label-danger">Unavailable</span>') . '</td></tr>';
    echo '</tbody></table>';
}
