<?php
if (!defined('WHMCS')) { die('Direct access denied'); }

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/migrations/V100.php';

use CloudHost247\Foundation\Database\MigrationRunner;
use CloudHost247\Smm\Adapters\AdapterFactory;
use CloudHost247\Smm\Migrations\InitialMigration;
use CloudHost247\Smm\Repositories\LogRepository;
use CloudHost247\Smm\Repositories\OrderRepository;
use CloudHost247\Smm\Repositories\ProviderRepository;
use CloudHost247\Smm\Services\AdminController;
use CloudHost247\Smm\Services\AdminView;
use CloudHost247\Smm\Services\ClientAreaService;

function cloudhost247_smm_config()
{
    return array(
        'name' => 'CloudHost247 SMM Marketplace',
        'description' => 'Multi-provider social-media-marketing marketplace: service catalog sync, product mapping, automated order provisioning, status synchronization and reconciliation.',
        'version' => '1.0.0',
        'author' => 'CloudHost247',
        'language' => 'english',
        'fields' => array(),
    );
}

function cloudhost247_smm_activate()
{
    try {
        $applied = (new MigrationRunner())->run('cloudhost247_smm', array(new InitialMigration()));
        return array('status' => 'success', 'description' => 'SMM marketplace installed. Applied migrations: ' . ($applied ? implode(', ', $applied) : 'already current') . '. The companion provisioning module is modules/servers/cloudhost247_smm.');
    } catch (\Throwable $e) {
        return array('status' => 'error', 'description' => 'Installation failed: ' . $e->getMessage());
    }
}

function cloudhost247_smm_deactivate()
{
    // Non-destructive: history, mappings and settings are kept; nothing at
    // the providers is canceled. Re-activating resumes where you left off.
    return array('status' => 'success', 'description' => 'SMM marketplace deactivated. All data was retained (providers, catalogs, orders, history). Re-activation is non-destructive.');
}

function cloudhost247_smm_output($vars)
{
    try {
        $controller = new AdminController();
        $data = $controller->handle();
    } catch (\Throwable $e) {
        // Never take the WHMCS admin area down.
        echo '<div class="alert alert-danger">The SMM module could not load: ' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8') . '</div>';
        return;
    }
    try {
        (new AdminView())->render($data);
    } catch (\Throwable $e) {
        echo '<div class="alert alert-danger">The SMM admin view failed to render: ' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8') . '</div>';
    }
}

/**
 * Client area: "My SMM Orders". Read-only list of the logged-in client's own
 * orders (ownership enforced in ClientAreaService). Provider API URLs, keys
 * and raw responses are never exposed here.
 */
function cloudhost247_smm_clientarea($vars)
{
    $clientId = 0;
    if (!empty($vars['clientid'])) {
        $clientId = (int) $vars['clientid'];
    } elseif (!empty($vars['client']) && isset($vars['client']->id)) {
        $clientId = (int) $vars['client']->id;
    } elseif (!empty($_SESSION['uid'])) {
        $clientId = (int) $_SESSION['uid'];
    }
    $orders = array();
    if ($clientId > 0) {
        try {
            $service = new ClientAreaService(
                new ProviderRepository(),
                new OrderRepository(),
                new LogRepository(),
                new AdapterFactory()
            );
            $orders = $service->ordersForClient($clientId);
        } catch (\Throwable $e) {
            $orders = array();
            \CloudHost247\Foundation\Support\Logger::write('cloudhost247_smm', 'error', 'clientarea.failed', array('message' => $e->getMessage()));
        }
    }
    return array(
        'pagetitle' => 'My SMM Orders',
        'breadcrumb' => array('index.php?m=cloudhost247_smm' => 'My SMM Orders'),
        'templatefile' => 'templates/orders.tpl',
        'requirelogin' => true,
        'vars' => array('orders' => $orders),
    );
}
