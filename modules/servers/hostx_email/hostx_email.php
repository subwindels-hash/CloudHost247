<?php
/**
 * HostX Email Provisioning Module for WHMCS
 * 
 * A comprehensive email hosting provisioning module supporting:
 * - Professional Email Hosting (IMAP/SMTP)
 * - Microsoft 365 subscriptions
 * - Google Workspace accounts
 * 
 * @package    WHMCS
 * @author     HostX Development Team
 * @copyright  2025 HostX
 * @license    Private
 * @version    1.0.0
 * @link       https://hostx.com
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

require_once __DIR__ . '/functions.php';
require_once __DIR__ . '/api.php';

use WHMCS\Database\Capsule;

/**
 * Define module metadata
 * 
 * @return array
 */
function hostx_email_MetaData()
{
    return [
        'DisplayName' => 'HostX Email Hosting',
        'APIVersion' => '1.1',
        'RequiresServer' => true,
        'DefaultNonSSLPort' => '443',
        'DefaultSSLPort' => '443',
        'ServiceSingleSignOnLabel' => 'Login to Email',
        'AdminSingleSignOnLabel' => 'Manage Email Account',
    ];
}

/**
 * Define product configuration options
 * 
 * @return array
 */
function hostx_email_ConfigOptions()
{
    return [
        'provider' => [
            'FriendlyName' => 'Email Provider',
            'Type' => 'dropdown',
            'Options' => [
                'professional' => 'Professional Email (IMAP/SMTP)',
                'microsoft365' => 'Microsoft 365',
                'google_workspace' => 'Google Workspace',
            ],
            'Description' => 'Select the email service provider for this product',
            'Default' => 'professional',
        ],
        'plan' => [
            'FriendlyName' => 'Plan Type',
            'Type' => 'dropdown',
            'Options' => [
                'basic' => 'Basic',
                'standard' => 'Standard',
                'premium' => 'Premium',
            ],
            'Description' => 'Select the plan tier for this product',
            'Default' => 'standard',
        ],
        'mailbox_size' => [
            'FriendlyName' => 'Mailbox Size (GB)',
            'Type' => 'text',
            'Size' => '10',
            'Default' => '10',
            'Description' => 'Mailbox storage limit in gigabytes',
        ],
        'max_aliases' => [
            'FriendlyName' => 'Max Aliases',
            'Type' => 'text',
            'Size' => '5',
            'Default' => '5',
            'Description' => 'Maximum number of email aliases allowed',
        ],
        'enable_dns_management' => [
            'FriendlyName' => 'Enable DNS Management',
            'Type' => 'yesno',
            'Description' => 'Allow clients to view and manage DNS records',
            'Default' => 'on',
        ],
    ];
}

/**
 * Define server configuration fields
 * 
 * @return array
 */
function hostx_email_CreateAccount(array $params)
{
    $provider = $params['configoption1'] ?: 'professional';
    $plan = $params['configoption2'] ?: 'standard';
    $domain = $params['domain'] ?: '';
    $username = $params['username'] ?: '';
    $password = $params['password'] ?: hostx_email_generate_password();
    $serviceId = $params['serviceid'] ?: 0;
    
    logModuleCall(
        'hostx_email',
        'CreateAccount',
        "Creating {$provider} account for {$domain}",
        $params,
        null,
        null
    );
    
    try {
        hostx_email_validate_input($params);
        
        $api = new HostxEmailAPI($params);
        
        switch ($provider) {
            case 'microsoft365':
                $result = $api->createMicrosoft365Account([
                    'domain' => $domain,
                    'username' => $username,
                    'password' => $password,
                    'plan' => $plan,
                    'display_name' => $params['clientsdetails']['fullname'] ?: $username,
                    'service_id' => $serviceId,
                ]);
                break;
                
            case 'google_workspace':
                $result = $api->createGoogleWorkspaceAccount([
                    'domain' => $domain,
                    'username' => $username,
                    'password' => $password,
                    'plan' => $plan,
                    'display_name' => $params['clientsdetails']['fullname'] ?: $username,
                    'service_id' => $serviceId,
                ]);
                break;
                
            case 'professional':
            default:
                $result = $api->createProfessionalEmailAccount([
                    'domain' => $domain,
                    'username' => $username,
                    'password' => $password,
                    'plan' => $plan,
                    'mailbox_size' => $params['configoption3'] ?: 10,
                    'service_id' => $serviceId,
                ]);
                break;
        }
        
        if ($result['success']) {
            // Store account details in custom fields
            hostx_email_store_account_data($serviceId, [
                'provider' => $provider,
                'plan' => $plan,
                'email_address' => $username . '@' . $domain,
                'external_id' => $result['external_id'] ?: '',
                'created_at' => date('Y-m-d H:i:s'),
                'status' => 'active',
            ]);
            
            logModuleCall(
                'hostx_email',
                'CreateAccount-Success',
                "Account created successfully",
                $result,
                null,
                null
            );
            
            return 'success';
        } else {
            throw new Exception($result['message'] ?: 'Unknown error creating account');
        }
        
    } catch (Exception $e) {
        logModuleCall(
            'hostx_email',
            'CreateAccount-Error',
            $e->getMessage(),
            $params,
            $e->getTraceAsString(),
            null
        );
        
        return 'Error: ' . $e->getMessage();
    }
}

/**
 * Suspend an email account
 * 
 * @param array $params
 * @return string
 */
function hostx_email_SuspendAccount(array $params)
{
    $provider = $params['configoption1'] ?: 'professional';
    $serviceId = $params['serviceid'] ?: 0;
    $domain = $params['domain'] ?: '';
    $username = $params['username'] ?: '';
    
    logModuleCall(
        'hostx_email',
        'SuspendAccount',
        "Suspending {$provider} account for {$domain}",
        $params,
        null,
        null
    );
    
    try {
        $api = new HostxEmailAPI($params);
        
        switch ($provider) {
            case 'microsoft365':
                $result = $api->suspendMicrosoft365Account([
                    'username' => $username,
                    'domain' => $domain,
                ]);
                break;
                
            case 'google_workspace':
                $result = $api->suspendGoogleWorkspaceAccount([
                    'username' => $username,
                    'domain' => $domain,
                ]);
                break;
                
            case 'professional':
            default:
                $result = $api->suspendProfessionalEmailAccount([
                    'username' => $username,
                    'domain' => $domain,
                ]);
                break;
        }
        
        if ($result['success']) {
            hostx_email_update_account_status($serviceId, 'suspended');
            
            logModuleCall(
                'hostx_email',
                'SuspendAccount-Success',
                "Account suspended successfully",
                $result,
                null,
                null
            );
            
            return 'success';
        } else {
            throw new Exception($result['message'] ?: 'Unknown error suspending account');
        }
        
    } catch (Exception $e) {
        logModuleCall(
            'hostx_email',
            'SuspendAccount-Error',
            $e->getMessage(),
            $params,
            $e->getTraceAsString(),
            null
        );
        
        return 'Error: ' . $e->getMessage();
    }
}

/**
 * Unsuspend an email account
 * 
 * @param array $params
 * @return string
 */
function hostx_email_UnsuspendAccount(array $params)
{
    $provider = $params['configoption1'] ?: 'professional';
    $serviceId = $params['serviceid'] ?: 0;
    $domain = $params['domain'] ?: '';
    $username = $params['username'] ?: '';
    
    logModuleCall(
        'hostx_email',
        'UnsuspendAccount',
        "Unsuspending {$provider} account for {$domain}",
        $params,
        null,
        null
    );
    
    try {
        $api = new HostxEmailAPI($params);
        
        switch ($provider) {
            case 'microsoft365':
                $result = $api->unsuspendMicrosoft365Account([
                    'username' => $username,
                    'domain' => $domain,
                ]);
                break;
                
            case 'google_workspace':
                $result = $api->unsuspendGoogleWorkspaceAccount([
                    'username' => $username,
                    'domain' => $domain,
                ]);
                break;
                
            case 'professional':
            default:
                $result = $api->unsuspendProfessionalEmailAccount([
                    'username' => $username,
                    'domain' => $domain,
                ]);
                break;
        }
        
        if ($result['success']) {
            hostx_email_update_account_status($serviceId, 'active');
            
            logModuleCall(
                'hostx_email',
                'UnsuspendAccount-Success',
                "Account unsuspended successfully",
                $result,
                null,
                null
            );
            
            return 'success';
        } else {
            throw new Exception($result['message'] ?: 'Unknown error unsuspending account');
        }
        
    } catch (Exception $e) {
        logModuleCall(
            'hostx_email',
            'UnsuspendAccount-Error',
            $e->getMessage(),
            $params,
            $e->getTraceAsString(),
            null
        );
        
        return 'Error: ' . $e->getMessage();
    }
}

/**
 * Terminate an email account
 * 
 * @param array $params
 * @return string
 */
function hostx_email_TerminateAccount(array $params)
{
    $provider = $params['configoption1'] ?: 'professional';
    $serviceId = $params['serviceid'] ?: 0;
    $domain = $params['domain'] ?: '';
    $username = $params['username'] ?: '';
    
    logModuleCall(
        'hostx_email',
        'TerminateAccount',
        "Terminating {$provider} account for {$domain}",
        $params,
        null,
        null
    );
    
    try {
        $api = new HostxEmailAPI($params);
        
        switch ($provider) {
            case 'microsoft365':
                $result = $api->deleteMicrosoft365Account([
                    'username' => $username,
                    'domain' => $domain,
                ]);
                break;
                
            case 'google_workspace':
                $result = $api->deleteGoogleWorkspaceAccount([
                    'username' => $username,
                    'domain' => $domain,
                ]);
                break;
                
            case 'professional':
            default:
                $result = $api->deleteProfessionalEmailAccount([
                    'username' => $username,
                    'domain' => $domain,
                ]);
                break;
        }
        
        if ($result['success']) {
            hostx_email_delete_account_data($serviceId);
            
            logModuleCall(
                'hostx_email',
                'TerminateAccount-Success',
                "Account terminated successfully",
                $result,
                null,
                null
            );
            
            return 'success';
        } else {
            throw new Exception($result['message'] ?: 'Unknown error terminating account');
        }
        
    } catch (Exception $e) {
        logModuleCall(
            'hostx_email',
            'TerminateAccount-Error',
            $e->getMessage(),
            $params,
            $e->getTraceAsString(),
            null
        );
        
        return 'Error: ' . $e->getMessage();
    }
}

/**
 * Change email account password
 * 
 * @param array $params
 * @return string
 */
function hostx_email_ChangePassword(array $params)
{
    $provider = $params['configoption1'] ?: 'professional';
    $domain = $params['domain'] ?: '';
    $username = $params['username'] ?: '';
    $password = $params['password'] ?: '';
    $serviceId = $params['serviceid'] ?: 0;
    
    if (empty($password)) {
        return 'Error: New password is required';
    }
    
    logModuleCall(
        'hostx_email',
        'ChangePassword',
        "Changing password for {$provider} account {$username}@{$domain}",
        ['domain' => $domain, 'username' => $username],
        null,
        null
    );
    
    try {
        hostx_email_validate_password($password);
        
        $api = new HostxEmailAPI($params);
        
        switch ($provider) {
            case 'microsoft365':
                $result = $api->changeMicrosoft365Password([
                    'username' => $username,
                    'domain' => $domain,
                    'password' => $password,
                ]);
                break;
                
            case 'google_workspace':
                $result = $api->changeGoogleWorkspacePassword([
                    'username' => $username,
                    'domain' => $domain,
                    'password' => $password,
                ]);
                break;
                
            case 'professional':
            default:
                $result = $api->changeProfessionalEmailPassword([
                    'username' => $username,
                    'domain' => $domain,
                    'password' => $password,
                ]);
                break;
        }
        
        if ($result['success']) {
            logModuleCall(
                'hostx_email',
                'ChangePassword-Success',
                "Password changed successfully",
                $result,
                null,
                null
            );
            
            return 'success';
        } else {
            throw new Exception($result['message'] ?: 'Unknown error changing password');
        }
        
    } catch (Exception $e) {
        logModuleCall(
            'hostx_email',
            'ChangePassword-Error',
            $e->getMessage(),
            $params,
            $e->getTraceAsString(),
            null
        );
        
        return 'Error: ' . $e->getMessage();
    }
}

/**
 * Client area output
 * 
 * @param array $params
 * @return array
 */
function hostx_email_ClientArea(array $params)
{
    $provider = $params['configoption1'] ?: 'professional';
    $plan = $params['configoption2'] ?: 'standard';
    $domain = $params['domain'] ?: '';
    $username = $params['username'] ?: '';
    $serviceId = $params['serviceid'] ?: 0;
    $enableDns = $params['configoption5'] ?: 'on';
    
    $accountData = hostx_email_get_account_data($serviceId);
    $emailAddress = $username . '@' . $domain;
    $status = $accountData['status'] ?: 'active';
    
    // Determine login URLs based on provider
    $loginUrls = hostx_email_get_login_urls($provider, $domain);
    
    // Get DNS records if enabled
    $dnsRecords = [];
    if ($enableDns === 'on') {
        $dnsRecords = hostx_email_get_dns_records($provider, $domain);
    }
    
    return [
        'tabOverviewReplacementTemplate' => 'templates/overview.tpl',
        'templateVariables' => [
            'provider' => $provider,
            'provider_name' => hostx_email_get_provider_name($provider),
            'plan' => ucfirst($plan),
            'domain' => $domain,
            'username' => $username,
            'email_address' => $emailAddress,
            'status' => $status,
            'status_class' => $status === 'active' ? 'success' : 'warning',
            'created_at' => $accountData['created_at'] ?: 'N/A',
            'login_urls' => $loginUrls,
            'dns_records' => $dnsRecords,
            'enable_dns' => $enableDns === 'on',
            'webmail_url' => $loginUrls['webmail'] ?? '',
            'module_url' => $params['systemurl'] . 'modules/servers/hostx_email/',
            'service_id' => $serviceId,
        ],
    ];
}

/**
 * Admin area output
 * 
 * @param array $params
 * @return string
 */
function hostx_email_AdminServicesTabFields(array $params)
{
    $provider = $params['configoption1'] ?: 'professional';
    $domain = $params['domain'] ?: '';
    $username = $params['username'] ?: '';
    $serviceId = $params['serviceid'] ?: 0;
    
    $accountData = hostx_email_get_account_data($serviceId);
    
    $fields = [];
    
    $fields['Email Provider'] = '<strong>' . hostx_email_get_provider_name($provider) . '</strong>';
    $fields['Email Address'] = htmlspecialchars($username . '@' . $domain);
    $fields['Account Status'] = '<span class="label label-' . ($accountData['status'] === 'active' ? 'success' : 'warning') . '">'
        . ucfirst($accountData['status'] ?: 'Unknown') . '</span>';
    
    if (!empty($accountData['external_id'])) {
        $fields['External ID'] = htmlspecialchars($accountData['external_id']);
    }
    
    $fields['Created'] = $accountData['created_at'] ?: 'N/A';
    
    return $fields;
}

/**
 * Test connection to API
 * 
 * @param array $params
 * @return array
 */
function hostx_email_TestConnection(array $params)
{
    try {
        $api = new HostxEmailAPI($params);
        
        // Test Microsoft 365 connection if credentials exist
        if (!empty($params['serveraccesshash']) && !empty($params['serverusername'])) {
            $msResult = $api->testMicrosoft365Connection();
            if (!$msResult['success']) {
                return [
                    'success' => false,
                    'error' => 'Microsoft 365: ' . $msResult['message'],
                ];
            }
        }
        
        // Test Google Workspace connection if credentials exist
        if (!empty($params['configoption7'])) {
            $googleResult = $api->testGoogleWorkspaceConnection();
            if (!$googleResult['success']) {
                return [
                    'success' => false,
                    'error' => 'Google Workspace: ' . $googleResult['message'],
                ];
            }
        }
        
        // Test Professional Email connection if credentials exist
        if (!empty($params['serverip']) && !empty($params['serverpassword'])) {
            $profResult = $api->testProfessionalEmailConnection();
            if (!$profResult['success']) {
                return [
                    'success' => false,
                    'error' => 'Professional Email: ' . $profResult['message'],
                ];
            }
        }
        
        return [
            'success' => true,
        ];
        
    } catch (Exception $e) {
        return [
            'success' => false,
            'error' => $e->getMessage(),
        ];
    }
}

/**
 * Single sign-on functionality
 * 
 * @param array $params
 * @return array
 */
function hostx_email_ServiceSingleSignOn(array $params)
{
    $provider = $params['configoption1'] ?: 'professional';
    $domain = $params['domain'] ?: '';
    
    $loginUrls = hostx_email_get_login_urls($provider, $domain);
    
    return [
        'success' => true,
        'redirectTo' => $loginUrls['webmail'] ?? $loginUrls['primary'] ?? '',
    ];
}

/**
 * Admin single sign-on
 * 
 * @param array $params
 * @return array
 */
function hostx_email_AdminSingleSignOn(array $params)
{
    return hostx_email_ServiceSingleSignOn($params);
}

/**
 * Additional actions for admin area
 * 
 * @return array
 */
function hostx_email_AdminCustomButtonArray()
{
    return [
        'Sync Account Status' => 'syncAccountStatus',
        'Reset Password' => 'resetPassword',
    ];
}

/**
 * Sync account status with provider
 * 
 * @param array $params
 * @return string
 */
function hostx_email_syncAccountStatus(array $params)
{
    $provider = $params['configoption1'] ?: 'professional';
    $serviceId = $params['serviceid'] ?: 0;
    $domain = $params['domain'] ?: '';
    $username = $params['username'] ?: '';
    
    try {
        $api = new HostxEmailAPI($params);
        
        switch ($provider) {
            case 'microsoft365':
                $result = $api->getMicrosoft365AccountStatus([
                    'username' => $username,
                    'domain' => $domain,
                ]);
                break;
                
            case 'google_workspace':
                $result = $api->getGoogleWorkspaceAccountStatus([
                    'username' => $username,
                    'domain' => $domain,
                ]);
                break;
                
            case 'professional':
            default:
                $result = $api->getProfessionalEmailAccountStatus([
                    'username' => $username,
                    'domain' => $domain,
                ]);
                break;
        }
        
        if ($result['success'] && isset($result['status'])) {
            hostx_email_update_account_status($serviceId, $result['status']);
            return 'Account status synced: ' . ucfirst($result['status']);
        } else {
            return 'Error: Unable to sync account status - ' . ($result['message'] ?: 'Unknown error');
        }
        
    } catch (Exception $e) {
        return 'Error: ' . $e->getMessage();
    }
}

/**
 * Admin reset password action
 * 
 * @param array $params
 * @return string
 */
function hostx_email_resetPassword(array $params)
{
    $newPassword = hostx_email_generate_password();
    
    $result = hostx_email_ChangePassword(array_merge($params, [
        'password' => $newPassword,
    ]));
    
    if ($result === 'success') {
        return 'Password reset successfully. New password: ' . $newPassword;
    }
    
    return $result;
}

/**
 * Upgrade/Downgrade account
 * 
 * @param array $params
 * @return string
 */
function hostx_email_ChangePackage(array $params)
{
    $provider = $params['configoption1'] ?: 'professional';
    $newPlan = $params['configoption2'] ?: 'standard';
    $domain = $params['domain'] ?: '';
    $username = $params['username'] ?: '';
    $serviceId = $params['serviceid'] ?: 0;
    
    try {
        $api = new HostxEmailAPI($params);
        
        switch ($provider) {
            case 'microsoft365':
                $result = $api->changeMicrosoft365Plan([
                    'username' => $username,
                    'domain' => $domain,
                    'plan' => $newPlan,
                ]);
                break;
                
            case 'google_workspace':
                $result = $api->changeGoogleWorkspacePlan([
                    'username' => $username,
                    'domain' => $domain,
                    'plan' => $newPlan,
                ]);
                break;
                
            case 'professional':
            default:
                $result = $api->changeProfessionalEmailPlan([
                    'username' => $username,
                    'domain' => $domain,
                    'plan' => $newPlan,
                    'mailbox_size' => $params['configoption3'] ?: 10,
                ]);
                break;
        }
        
        if ($result['success']) {
            hostx_email_update_account_data($serviceId, ['plan' => $newPlan]);
            return 'success';
        } else {
            throw new Exception($result['message'] ?: 'Unknown error changing plan');
        }
        
    } catch (Exception $e) {
        return 'Error: ' . $e->getMessage();
    }
}

/**
 * Renew account (extend subscription)
 * 
 * @param array $params
 * @return string
 */
function hostx_email_Renew(array $params)
{
    // Email accounts typically don't need renewal actions
    // as they are subscription-based, but we can log it
    logModuleCall(
        'hostx_email',
        'Renew',
        "Account renewal processed",
        $params,
        null,
        null
    );
    
    return 'success';
}

/**
 * Usage metrics for reporting
 * 
 * @param array $params
 * @return array
 */
function hostx_email_UsageUpdate($params)
{
    $serviceId = $params['serviceid'] ?: 0;
    $domain = $params['domain'] ?: '';
    $username = $params['username'] ?: '';
    $provider = $params['configoption1'] ?: 'professional';
    
    try {
        $api = new HostxEmailAPI($params);
        
        switch ($provider) {
            case 'microsoft365':
                $usage = $api->getMicrosoft365Usage([
                    'username' => $username,
                    'domain' => $domain,
                ]);
                break;
                
            case 'google_workspace':
                $usage = $api->getGoogleWorkspaceUsage([
                    'username' => $username,
                    'domain' => $domain,
                ]);
                break;
                
            case 'professional':
            default:
                $usage = $api->getProfessionalEmailUsage([
                    'username' => $username,
                    'domain' => $domain,
                ]);
                break;
        }
        
        if ($usage['success']) {
            // Update usage in database if needed
            Capsule::table('tblhosting')
                ->where('id', $serviceId)
                ->update([
                    'diskusage' => $usage['disk_usage'] ?? 0,
                    'disklimit' => $usage['disk_limit'] ?? 0,
                    'bwusage' => 0,
                    'bwlimit' => 0,
                    'lastupdate' => Capsule::raw('NOW()'),
                ]);
        }
        
    } catch (Exception $e) {
        logModuleCall(
            'hostx_email',
            'UsageUpdate-Error',
            $e->getMessage(),
            $params,
            null,
            null
        );
    }
}

/**
 * Hook for daily cron job synchronization
 */
add_hook('DailyCronJob', 1, function($vars) {
    try {
        $services = Capsule::table('tblhosting')
            ->where('servertype', 'hostx_email')
            ->where('domainstatus', 'Active')
            ->get();
        
        foreach ($services as $service) {
            $params = hostx_email_build_params_from_service($service);
            if ($params) {
                hostx_email_syncAccountStatus($params);
            }
        }
        
        logActivity("HostX Email: Daily sync completed for " . count($services) . " services");
        
    } catch (Exception $e) {
        logActivity("HostX Email: Daily sync error - " . $e->getMessage());
    }
});

/**
 * Hook for invoice payment completion
 */
add_hook('InvoicePaid', 1, function($vars) {
    try {
        $invoiceId = $vars['invoiceid'];
        
        $items = Capsule::table('tblinvoiceitems')
            ->where('invoiceid', $invoiceId)
            ->where('type', 'Hosting')
            ->get();
        
        foreach ($items as $item) {
            $service = Capsule::table('tblhosting')
                ->where('id', $item['relid'])
                ->where('servertype', 'hostx_email')
                ->first();
            
            if ($service && $service->domainstatus === 'Pending') {
                $params = hostx_email_build_params_from_service($service);
                if ($params) {
                    hostx_email_CreateAccount($params);
                }
            }
        }
        
    } catch (Exception $e) {
        logActivity("HostX Email: Invoice payment hook error - " . $e->getMessage());
    }
});
