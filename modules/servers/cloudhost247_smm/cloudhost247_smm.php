<?php
if (!defined('WHMCS')) { die('Direct access denied'); }

/**
 * CloudHost247 SMM provisioning module (WHMCS server module).
 *
 * The addon modules/addons/cloudhost247_smm owns the schema and the business
 * logic; this module is the thin WHMCS provisioning integration. Orders are
 * submitted ONLY from CreateAccount — i.e. after payment and provisioning
 * approval — and every submission is idempotent.
 */

require_once __DIR__ . '/../../addons/cloudhost247_smm/bootstrap.php';

use CloudHost247\Smm\Adapters\AdapterFactory;
use CloudHost247\Smm\Repositories\LogRepository;
use CloudHost247\Smm\Repositories\OrderRepository;
use CloudHost247\Smm\Repositories\ProviderRepository;
use CloudHost247\Smm\Services\ClientAreaService;
use CloudHost247\Smm\Services\OrderService;

function cloudhost247_smm_MetaData()
{
    return array(
        'DisplayName' => 'CloudHost247 SMM Marketplace',
        'APIVersion' => '1.1',
        'RequiresServer' => false,
        'DefaultNonSSLPort' => '',
        'DefaultSSLPort' => '',
    );
}

function cloudhost247_smm_ConfigOptions()
{
    return array(
        'Target Link' => array(
            'Type' => 'text',
            'Size' => '60',
            'Description' => 'Public link the provider will boost (https://... shown to the customer at order time).',
        ),
        'Quantity' => array(
            'Type' => 'text',
            'Size' => '10',
            'Description' => 'Amount to deliver (validated against the provider min/max before submission).',
        ),
    );
}

/** @return OrderService */
function cloudhost247_smm_service()
{
    return new OrderService(new ProviderRepository(), new OrderRepository(), new LogRepository(), new AdapterFactory());
}

/**
 * Submit the order to the provider — runs once per WHMCS service. Repeated
 * calls (retry button, module re-save, cron) return the recorded outcome
 * instead of creating duplicates.
 */
function cloudhost247_smm_CreateAccount(array $params)
{
    try {
        $configOptions = isset($params['configoptions']) && is_array($params['configoptions']) ? $params['configoptions'] : array();
        $targetUrl = '';
        $quantity = 0;
        if (array_key_exists('Target Link', $configOptions)) {
            $targetUrl = (string) $configOptions['Target Link'];
            $quantity = isset($configOptions['Quantity']) ? $configOptions['Quantity'] : 0;
        } else {
            // Fallback: values supplied as configurable options by index.
            $targetUrl = (string) (isset($params['configoption1']) ? $params['configoption1'] : '');
            $quantity = isset($params['configoption2']) ? $params['configoption2'] : 0;
        }
        $result = cloudhost247_smm_service()->submitForService(array(
            'whmcs_service_id' => (int) $params['serviceid'],
            'whmcs_order_id' => (int) (isset($params['orderid']) ? $params['orderid'] : 0),
            'whmcs_client_id' => (int) $params['userid'],
            'whmcs_product_id' => (int) $params['pid'],
            'target_url' => $targetUrl,
            'quantity' => $quantity,
        ));
    } catch (\Throwable $e) {
        // Fatal-but-unknown: fail the provisioning run without leaking internals.
        \CloudHost247\Foundation\Support\Logger::write('cloudhost247_smm', 'error', 'provisioning.failed', array(
            'service' => isset($params['serviceid']) ? (int) $params['serviceid'] : 0,
            'message' => $e->getMessage(),
        ));
        return 'Order provisioning could not be completed. Our team has been notified and will process it manually.';
    }
    if (!empty($result['ok'])) {
        return 'success';
    }
    // Rejections/validation messages are safe to show (provider-authored or
    // module-authored). Unknown outcomes carry a correlation id and never
    // resubmit automatically.
    return $result['message'];
}

function cloudhost247_smm_SuspendAccount(array $params)
{
    // Local-only: pause status syncing while the WHMCS service is suspended.
    try {
        cloudhost247_smm_service()->setSuspended((int) $params['serviceid'], true, 'system', 0);
    } catch (\Throwable $e) {
        \CloudHost247\Foundation\Support\Logger::write('cloudhost247_smm', 'error', 'provisioning.suspend_failed', array(
            'service' => (int) $params['serviceid'], 'message' => $e->getMessage(),
        ));
    }
    return 'success';
}

function cloudhost247_smm_UnsuspendAccount(array $params)
{
    try {
        cloudhost247_smm_service()->setSuspended((int) $params['serviceid'], false, 'system', 0);
    } catch (\Throwable $e) {
        \CloudHost247\Foundation\Support\Logger::write('cloudhost247_smm', 'error', 'provisioning.unsuspend_failed', array(
            'service' => (int) $params['serviceid'], 'message' => $e->getMessage(),
        ));
    }
    return 'success';
}

function cloudhost247_smm_TerminateAccount(array $params)
{
    // Local-only end of lifecycle: the order row is marked terminated and its
    // history preserved. Cancelling at the provider is a separate, explicit
    // administrator/client action — never a silent side effect.
    try {
        cloudhost247_smm_service()->markTerminated((int) $params['serviceid'], 'WHMCS service terminated.', 'system', 0);
    } catch (\Throwable $e) {
        \CloudHost247\Foundation\Support\Logger::write('cloudhost247_smm', 'error', 'provisioning.terminate_failed', array(
            'service' => (int) $params['serviceid'], 'message' => $e->getMessage(),
        ));
    }
    return 'success';
}

/** Client-area service page output (inside the product details page). */
function cloudhost247_smm_ClientArea(array $params)
{
    $clientId = 0;
    if (!empty($params['userid'])) {
        $clientId = (int) $params['userid'];
    } elseif (!empty($params['clientsdetails']['id'])) {
        $clientId = (int) $params['clientsdetails']['id'];
    }
    try {
        $service = new ClientAreaService(
            new ProviderRepository(),
            new OrderRepository(),
            new LogRepository(),
            new AdapterFactory()
        );
        $order = $service->viewForService((int) $params['serviceid'], $clientId);
    } catch (\Throwable $e) {
        $order = null;
        \CloudHost247\Foundation\Support\Logger::write('cloudhost247_smm', 'error', 'clientarea.service_view_failed', array(
            'service' => (int) $params['serviceid'], 'message' => $e->getMessage(),
        ));
    }
    return array(
        'templatefile' => 'templates/clientarea',
        'vars' => array(
            'smmOrder' => $order,
        ),
    );
}

/** Custom client-area buttons, offered only when genuinely supported. */
function cloudhost247_smm_ClientAreaCustomButtonArray()
{
    return array(
        'Request Refill' => 'refill',
        'Request Cancellation' => 'cancelrequest',
    );
}

function cloudhost247_smm_refill(array $params)
{
    return cloudhost247_smm_clientAction('refill', $params);
}

function cloudhost247_smm_cancelrequest(array $params)
{
    return cloudhost247_smm_clientAction('cancelrequest', $params);
}

function cloudhost247_smm_clientAction($action, array $params)
{
    $clientId = 0;
    if (!empty($params['userid'])) {
        $clientId = (int) $params['userid'];
    } elseif (!empty($params['clientsdetails']['id'])) {
        $clientId = (int) $params['clientsdetails']['id'];
    }
    try {
        $service = new ClientAreaService(
            new ProviderRepository(),
            new OrderRepository(),
            new LogRepository(),
            new AdapterFactory()
        );
        $result = $action === 'refill'
            ? $service->requestRefill((int) $params['serviceid'], $clientId)
            : $service->requestCancel((int) $params['serviceid'], $clientId);
    } catch (\Throwable $e) {
        \CloudHost247\Foundation\Support\Logger::write('cloudhost247_smm', 'error', 'clientarea.action_failed', array(
            'action' => $action, 'service' => (int) $params['serviceid'], 'message' => $e->getMessage(),
        ));
        return 'The request could not be completed. Please contact support.';
    }
    if (!empty($result['ok'])) {
        return 'success';
    }
    return isset($result['message']) ? $result['message'] : 'The request could not be completed.';
}
