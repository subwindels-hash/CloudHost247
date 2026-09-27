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
        (new MigrationRunner())->run('cloudhost247_core', array(new \CloudHost247\Foundation\Database\CoreAuditMigration()));
        return array('status' => 'success', 'description' => 'Foundation tables installed non-destructively.');
    } catch (\Throwable $e) { return array('status' => 'error', 'description' => $e->getMessage()); }
}
function cloudhost247_core_deactivate() { return array('status' => 'success', 'description' => 'Data retained for safe rollback.'); }
function cloudhost247_core_output($vars)
{
    AdminGuard::requireAdmin(); $notice = '';
    if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '') === 'POST') {
        AdminGuard::requirePostToken();
        $module = isset($_POST['capability_module']) ? (string) $_POST['capability_module'] : '';
        $capability = isset($_POST['capability_name']) ? (string) $_POST['capability_name'] : '';
        $roles = isset($_POST['role_ids']) ? preg_replace('/[^0-9,]/','',(string)$_POST['role_ids']) : '';
        if (!in_array($module,array('cloudhost247_theme','cloudhost247_currency','cloudhost247_ovh'),true) || !preg_match('/^[a-z0-9_.-]{1,64}$/',$capability)) throw new \RuntimeException('Invalid capability policy.');
        Capsule::table('mod_cloudhost247_capabilities')->updateOrInsert(array('module'=>$module,'capability'=>$capability),array('role_ids'=>$roles));
        $notice = 'Capability policy saved. An empty role list denies the capability.';
    }
    $checks = HealthCheck::run();
    echo '<h2>CloudHost247 Foundation</h2><p>Version 1.0.0. Deactivation preserves all data.</p><table class="table table-striped"><thead><tr><th>Capability</th><th>Status</th></tr></thead><tbody>';
    foreach ($checks as $name => $ok) echo '<tr><td>' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8') . '</td><td>' . ($ok ? '<span class="label label-success">Ready</span>' : '<span class="label label-danger">Unavailable</span>') . '</td></tr>';
    echo '</tbody></table>';
    if ($notice) echo '<div class="alert alert-success">'.htmlspecialchars($notice,ENT_QUOTES,'UTF-8').'</div>';
    $token = function_exists('generate_token') ? generate_token('plain') : '';
    echo '<h3>Administrator role capabilities</h3><p>WHMCS addon-role access remains mandatory. Optional policies below further restrict an operation to comma-separated WHMCS role IDs. No policy means normal WHMCS addon authorization.</p><form method="post" class="form-inline"><input type="hidden" name="token" value="'.htmlspecialchars($token,ENT_QUOTES,'UTF-8').'"><select name="capability_module" class="form-control"><option>cloudhost247_theme</option><option>cloudhost247_currency</option><option>cloudhost247_ovh</option></select><input required name="capability_name" class="form-control" placeholder="e.g. settings.manage"><input name="role_ids" class="form-control" pattern="[0-9,]*" placeholder="Role IDs, e.g. 1,2"><button class="btn btn-primary">Save restriction</button></form><table class="table"><tr><th>Module</th><th>Capability</th><th>Allowed role IDs</th></tr>';
    foreach (Capsule::table('mod_cloudhost247_capabilities')->orderBy('module')->orderBy('capability')->get() as $policy) echo '<tr><td>'.htmlspecialchars($policy->module,ENT_QUOTES,'UTF-8').'</td><td>'.htmlspecialchars($policy->capability,ENT_QUOTES,'UTF-8').'</td><td>'.htmlspecialchars($policy->role_ids,ENT_QUOTES,'UTF-8').'</td></tr>';
    echo '</table>';
}
