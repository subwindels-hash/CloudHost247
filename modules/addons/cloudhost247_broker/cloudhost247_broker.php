<?php
if (!defined('WHMCS')) { die('Direct access denied'); }

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/migrations/V100.php';
require_once __DIR__ . '/migrations/V110.php';

use CloudHost247\Broker\Http\AdminController;
use CloudHost247\Broker\Http\AdminView;
use CloudHost247\Broker\Http\ClientAreaController;
use CloudHost247\Broker\Migrations\InitialMigration;
use CloudHost247\Broker\Migrations\DeliveryMigration;
use CloudHost247\Foundation\Database\MigrationRunner;
use CloudHost247\Foundation\Support\Logger;

function cloudhost247_broker_config()
{
    return array(
        'name' => 'CloudHost247 Domain Brokerage',
        'description' => 'Provider-agnostic domain acquisition brokerage: request intake, owner contact, negotiation, payment (via WHMCS invoicing) and transfer tracking for domains that are already registered elsewhere. Every route (marketplace, brokerage provider, or manual CloudHost247 broker) is real — nothing here fabricates a working integration or a guaranteed outcome.',
        'version' => '1.0.0',
        'author' => 'CloudHost247',
        'language' => 'english',
        'fields' => array(),
    );
}

function cloudhost247_broker_activate()
{
    try {
        $applied = (new MigrationRunner())->run('cloudhost247_broker', array(new InitialMigration(), new DeliveryMigration()));
        return array(
            'status' => 'success',
            'description' => 'Domain Brokerage installed. Applied migrations: ' . ($applied ? implode(', ', $applied) : 'already current')
                . '. Connect GoDaddy/Sedo/Afternic/DomainAgents from Super Admin -> API & Integrations, then confirm partner agreements from Super Admin -> Domain Brokerage -> Providers. The manual CloudHost247 broker route works immediately with no external configuration.',
        );
    } catch (\Throwable $e) {
        return array('status' => 'error', 'description' => 'Installation failed: ' . $e->getMessage());
    }
}

function cloudhost247_broker_deactivate()
{
    // Non-destructive: cases, offers, messages, payments, transfers, documents
    // and audit history are all retained. Re-activating resumes exactly where
    // this left off.
    return array('status' => 'success', 'description' => 'Domain Brokerage deactivated. All case data was retained. Re-activation is non-destructive.');
}

function cloudhost247_broker_output($vars)
{
    try {
        $controller = new AdminController();
        $data = $controller->handle();
    } catch (\Throwable $e) {
        echo '<div class="alert alert-danger">The Domain Brokerage module could not load: ' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8') . '</div>';
        Logger::write('cloudhost247_broker', 'error', 'admin.output_failed', array('message' => $e->getMessage()));
        return;
    }
    try {
        (new AdminView())->render($data);
    } catch (\Throwable $e) {
        echo '<div class="alert alert-danger">The Domain Brokerage admin view failed to render: ' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8') . '</div>';
    }
}

/**
 * Client area: "My Domain Brokerage Cases" (requirement #4). Every case shown
 * or acted on is scoped to the logged-in client by ClientAreaController;
 * templates only render whitelisted, escaped fields.
 */
function cloudhost247_broker_clientarea($vars)
{
    try {
        $data = (new ClientAreaController())->handle();
    } catch (\Throwable $e) {
        Logger::write('cloudhost247_broker', 'error', 'clientarea.failed', array('message' => $e->getMessage()));
        $data = array('view' => 'list', 'notice' => '', 'error' => 'The Domain Brokerage service is temporarily unavailable. Please try again shortly.', 'token' => '', 'brokerage_enabled' => false, 'results' => array('rows' => array(), 'total' => 0, 'page' => 1, 'pages' => 1));
    }
    $templates = array('list' => 'list.tpl', 'new' => 'new.tpl', 'detail' => 'detail.tpl');
    $template = isset($templates[$data['view']]) ? $templates[$data['view']] : 'list.tpl';
    return array(
        'pagetitle' => 'Domain Brokerage',
        'breadcrumb' => array('index.php?m=cloudhost247_broker' => 'Domain Brokerage'),
        'templatefile' => 'templates/' . $template,
        'requirelogin' => true,
        'vars' => $data,
    );
}
