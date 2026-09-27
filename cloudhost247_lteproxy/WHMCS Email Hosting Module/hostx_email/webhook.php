<?php
/**
 * HostX Email Module - Webhook Handler
 * 
 * Handles asynchronous notifications from:
 * - Microsoft Graph API (change notifications)
 * - Google Workspace (push notifications)
 * - Professional Email API (event webhooks)
 * 
 * @package    WHMCS
 * @author     HostX Development Team
 * @copyright  2025 HostX
 * @license    Private
 * @version    1.0.0
 */

// Bootstrap WHMCS
require_once __DIR__ . '/../../../../init.php';
require_once __DIR__ . '/functions.php';
require_once __DIR__ . '/api.php';

use WHMCS\Database\Capsule;

// Set JSON response header
header('Content-Type: application/json');

/**
 * Send JSON response
 * 
 * @param int $httpCode
 * @param array $data
 */
function hostx_email_webhook_response($httpCode, $data)
{
    http_response_code($httpCode);
    echo json_encode($data);
    exit;
}

/**
 * Log webhook event
 * 
 * @param string $provider
 * @param string $event
 * @param array $payload
 */
function hostx_email_log_webhook($provider, $event, $payload)
{
    try {
        if (!Capsule::schema()->hasTable('mod_hostx_email_webhook_logs')) {
            Capsule::schema()->create('mod_hostx_email_webhook_logs', function ($table) {
                $table->increments('id');
                $table->string('provider', 50);
                $table->string('event', 100);
                $table->text('payload');
                $table->string('ip_address', 45)->nullable();
                $table->timestamp('created_at')->nullable();
            });
        }
        
        Capsule::table('mod_hostx_email_webhook_logs')->insert([
            'provider' => $provider,
            'event' => $event,
            'payload' => json_encode($payload),
            'ip_address' => $_SERVER['REMOTE_ADDR'] ?: 'unknown',
            'created_at' => date('Y-m-d H:i:s'),
        ]);
        
    } catch (Exception $e) {
        // Silently fail - don't break webhook processing due to logging issues
        error_log('HostX Email Webhook logging error: ' . $e->getMessage());
    }
}

// Main webhook handler
try {
    // Get request details
    $requestMethod = $_SERVER['REQUEST_METHOD'];
    $requestUri = $_SERVER['REQUEST_URI'] ?: '';
    
    // Parse provider from URL path
    // Expected format: /modules/servers/hostx_email/webhook.php?provider=microsoft365
    $provider = isset($_GET['provider']) ? strtolower(trim($_GET['provider'])) : '';
    
    // Validate provider
    $validProviders = ['microsoft365', 'google_workspace', 'professional'];
    
    if (empty($provider) || !in_array($provider, $validProviders)) {
        hostx_email_webhook_response(400, [
            'success' => false,
            'message' => 'Invalid or missing provider. Valid providers: ' . implode(', ', $validProviders),
        ]);
    }
    
    // Get raw input
    $rawInput = file_get_contents('php://input');
    
    if (empty($rawInput)) {
        hostx_email_webhook_response(400, [
            'success' => false,
            'message' => 'Empty request body',
        ]);
    }
    
    // Parse JSON payload
    $payload = json_decode($rawInput, true);
    
    if (json_last_error() !== JSON_ERROR_NONE) {
        hostx_email_webhook_response(400, [
            'success' => false,
            'message' => 'Invalid JSON payload: ' . json_last_error_msg(),
        ]);
    }
    
    // Log the webhook
    hostx_email_log_webhook($provider, 'received', $payload);
    
    // Get API handler
    $params = [
        'serverusername' => '',
        'serverpassword' => '',
        'serveraccesshash' => '',
        'configoption7' => '',
    ];
    
    // Load server credentials if available
    try {
        $server = Capsule::table('tblservers')
            ->where('type', 'hostx_email')
            ->first();
        
        if ($server) {
            $params['serverusername'] = $server->username;
            $params['serverpassword'] = $server->password;
            $params['serveraccesshash'] = $server->accesshash;
            
            // Load Google service account from config option
            $product = Capsule::table('tblproducts')
                ->where('servertype', 'hostx_email')
                ->first();
            
            if ($product) {
                $params['configoption7'] = $product->configoption7;
            }
        }
    } catch (Exception $e) {
        logModuleCall('hostx_email', 'Webhook-ConfigError', $e->getMessage(), [], null, null);
    }
    
    $api = new HostxEmailAPI($params);
    
    // Verify signature if present
    $signature = '';
    if (isset($_SERVER['HTTP_X_WEBHOOK_SIGNATURE'])) {
        $signature = $_SERVER['HTTP_X_WEBHOOK_SIGNATURE'];
    } elseif (isset($_SERVER['HTTP_X_HUB_SIGNATURE_256'])) {
        $signature = $_SERVER['HTTP_X_HUB_SIGNATURE_256'];
    }
    
    if (!empty($signature)) {
        if (!$api->verifyWebhookSignature($provider, $rawInput, $signature)) {
            hostx_email_webhook_response(401, [
                'success' => false,
                'message' => 'Invalid webhook signature',
            ]);
        }
    }
    
    // Process webhook based on provider
    switch ($provider) {
        case 'microsoft365':
            handleMicrosoft365Webhook($payload, $api);
            break;
            
        case 'google_workspace':
            handleGoogleWorkspaceWebhook($payload, $api);
            break;
            
        case 'professional':
            handleProfessionalEmailWebhook($payload, $api);
            break;
    }
    
    // Success response
    hostx_email_webhook_response(200, [
        'success' => true,
        'message' => 'Webhook processed successfully',
    ]);
    
} catch (Exception $e) {
    logModuleCall(
        'hostx_email',
        'Webhook-FatalError',
        $e->getMessage(),
        ['trace' => $e->getTraceAsString()],
        null,
        null
    );
    
    hostx_email_webhook_response(500, [
        'success' => false,
        'message' => 'Internal server error',
    ]);
}

/**
 * Handle Microsoft 365 webhooks
 * 
 * @param array $payload
 * @param HostxEmailAPI $api
 */
function handleMicrosoft365Webhook(array $payload, HostxEmailAPI $api)
{
    // Handle validation token (sent during subscription creation)
    if (isset($payload['validationToken'])) {
        // Microsoft expects the validation token to be returned in the body
        // with Content-Type: text/plain
        header('Content-Type: text/plain');
        echo $payload['validationToken'];
        exit;
    }
    
    // Handle change notifications
    if (isset($payload['value']) && is_array($payload['value'])) {
        foreach ($payload['value'] as $notification) {
            $changeType = $notification['changeType'] ?: 'unknown';
            $resource = $notification['resource'] ?: '';
            $clientState = $notification['clientState'] ?: '';
            
            // Verify client state for security
            $expectedClientState = Capsule::table('tblconfiguration')
                ->where('setting', 'hostx_email_ms_client_state')
                ->value('value');
            
            if (!empty($expectedClientState) && $clientState !== $expectedClientState) {
                logModuleCall(
                    'hostx_email',
                    'Webhook-InvalidClientState',
                    'Invalid client state received',
                    $notification,
                    null,
                    null
                );
                continue;
            }
            
            // Extract user ID from resource path
            // Format: "users/{user-id}"
            $userId = '';
            if (preg_match('/users\/([^\/]+)/', $resource, $matches)) {
                $userId = $matches[1];
            }
            
            if (empty($userId)) {
                continue;
            }
            
            // Find corresponding service
            try {
                $account = Capsule::table('mod_hostx_email_accounts')
                    ->where('external_id', $userId)
                    ->where('provider', 'microsoft365')
                    ->first();
                
                if (!$account) {
                    logModuleCall(
                        'hostx_email',
                        'Webhook-AccountNotFound',
                        'No account found for user ID: ' . $userId,
                        $notification,
                        null,
                        null
                    );
                    continue;
                }
                
                logModuleCall(
                    'hostx_email',
                    'Webhook-Microsoft365-' . ucfirst($changeType),
                    'Processing ' . $changeType . ' for user: ' . $userId,
                    $notification,
                    null,
                    null
                );
                
                switch ($changeType) {
                    case 'updated':
                        // Sync account status
                        $service = Capsule::table('tblhosting')
                            ->where('id', $account->service_id)
                            ->first();
                        
                        if ($service) {
                            $params = hostx_email_build_params_from_service($service);
                            if ($params) {
                                hostx_email_syncAccountStatus($params);
                            }
                        }
                        break;
                        
                    case 'deleted':
                        hostx_email_update_account_status($account->service_id, 'terminated');
                        
                        // Optionally update WHMCS service status
                        Capsule::table('tblhosting')
                            ->where('id', $account->service_id)
                            ->update([
                                'domainstatus' => 'Terminated',
                            ]);
                        break;
                        
                    case 'created':
                        hostx_email_update_account_status($account->service_id, 'active');
                        break;
                }
                
                // Log processed event
                hostx_email_log_webhook('microsoft365', $changeType, $notification);
                
            } catch (Exception $e) {
                logModuleCall(
                    'hostx_email',
                    'Webhook-Microsoft365-Error',
                    $e->getMessage(),
                    $notification,
                    null,
                    null
                );
            }
        }
    }
}

/**
 * Handle Google Workspace webhooks
 * 
 * @param array $payload
 * @param HostxEmailAPI $api
 */
function handleGoogleWorkspaceWebhook(array $payload, HostxEmailAPI $api)
{
    // Google Workspace sends channel notifications
    if (isset($payload['kind']) && $payload['kind'] === 'admin#directory#user') {
        $userEmail = $payload['primaryEmail'] ?: '';
        $isSuspended = $payload['suspended'] ?: false;
        $includeInGlobalAddressList = $payload['includeInGlobalAddressList'] ?: true;
        
        if (empty($userEmail)) {
            return;
        }
        
        try {
            $account = Capsule::table('mod_hostx_email_accounts')
                ->where('email_address', $userEmail)
                ->where('provider', 'google_workspace')
                ->first();
            
            if ($account) {
                $newStatus = $isSuspended ? 'suspended' : 'active';
                hostx_email_update_account_status($account->service_id, $newStatus);
                
                hostx_email_log_webhook('google_workspace', $newStatus, $payload);
            }
            
        } catch (Exception $e) {
            logModuleCall(
                'hostx_email',
                'Webhook-Google-Error',
                $e->getMessage(),
                $payload,
                null,
                null
            );
        }
    }
    
    // Handle Google Workspace events format
    if (isset($payload['events']) && is_array($payload['events'])) {
        foreach ($payload['events'] as $event) {
            $eventType = $event['eventType'] ?: '';
            $userEmail = $event['userEmail'] ?: '';
            
            if (empty($userEmail)) {
                continue;
            }
            
            try {
                $account = Capsule::table('mod_hostx_email_accounts')
                    ->where('email_address', $userEmail)
                    ->where('provider', 'google_workspace')
                    ->first();
                
                if ($account) {
                    $statusMap = [
                        'SUSPENDED' => 'suspended',
                        'UNSUSPENDED' => 'active',
                        'DELETED' => 'terminated',
                        'PASSWORD_CHANGED' => 'active',
                    ];
                    
                    $newStatus = $statusMap[$eventType] ?: 'active';
                    hostx_email_update_account_status($account->service_id, $newStatus);
                    
                    if ($eventType === 'DELETED') {
                        Capsule::table('tblhosting')
                            ->where('id', $account->service_id)
                            ->update([
                                'domainstatus' => 'Terminated',
                            ]);
                    }
                    
                    hostx_email_log_webhook('google_workspace', $eventType, $event);
                }
                
            } catch (Exception $e) {
                logModuleCall(
                    'hostx_email',
                    'Webhook-Google-EventError',
                    $e->getMessage(),
                    $event,
                    null,
                    null
                );
            }
        }
    }
}

/**
 * Handle Professional Email webhooks
 * 
 * @param array $payload
 * @param HostxEmailAPI $api
 */
function handleProfessionalEmailWebhook(array $payload, HostxEmailAPI $api)
{
    $event = $payload['event'] ?: '';
    $email = $payload['email'] ?: ($payload['data']['email'] ?: '');
    
    if (empty($event) || empty($email)) {
        return;
    }
    
    try {
        $account = Capsule::table('mod_hostx_email_accounts')
            ->where('email_address', $email)
            ->where('provider', 'professional')
            ->first();
        
        if ($account) {
            $eventStatusMap = [
                'mailbox.created' => 'active',
                'mailbox.activated' => 'active',
                'mailbox.suspended' => 'suspended',
                'mailbox.unsuspended' => 'active',
                'mailbox.deleted' => 'terminated',
                'mailbox.password_changed' => 'active',
            ];
            
            $newStatus = $eventStatusMap[$event] ?: null;
            
            if ($newStatus) {
                hostx_email_update_account_status($account->service_id, $newStatus);
                
                if ($event === 'mailbox.deleted') {
                    Capsule::table('tblhosting')
                        ->where('id', $account->service_id)
                        ->update([
                            'domainstatus' => 'Terminated',
                        ]);
                }
            }
            
            // Handle quota warnings
            if ($event === 'mailbox.quota_warning') {
                // Could send notification to client/admin here
                logModuleCall(
                    'hostx_email',
                    'Webhook-QuotaWarning',
                    'Mailbox ' . $email . ' approaching quota limit',
                    $payload,
                    null,
                    null
                );
            }
            
            hostx_email_log_webhook('professional', $event, $payload);
        }
        
    } catch (Exception $e) {
        logModuleCall(
            'hostx_email',
            'Webhook-Professional-Error',
            $e->getMessage(),
            $payload,
            null,
            null
        );
    }
}
