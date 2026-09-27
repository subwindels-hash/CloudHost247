<?php
/**
 * HostX Email Module - Shared Functions
 * 
 * Helper functions for encryption, validation, data management,
 * and utility operations.
 * 
 * @package    WHMCS
 * @author     HostX Development Team
 * @copyright  2025 HostX
 * @license    Private
 * @version    1.0.0
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

use WHMCS\Database\Capsule;

/**
 * Encryption key for API credentials
 * 
 * @return string
 */
function hostx_email_get_encryption_key()
{
    $systemUrl = Capsule::table('tblconfiguration')
        ->where('setting', 'SystemURL')
        ->value('value');
    
    return hash('sha256', $systemUrl . 'HostXEmail_v1.0.0');
}

/**
 * Encrypt sensitive data
 * 
 * @param string $data
 * @return string
 */
function hostx_email_encrypt($data)
{
    if (empty($data)) {
        return '';
    }
    
    $key = hostx_email_get_encryption_key();
    $iv = openssl_random_pseudo_bytes(16);
    $encrypted = openssl_encrypt($data, 'AES-256-CBC', $key, OPENSSL_RAW_DATA, $iv);
    
    return base64_encode($iv . $encrypted);
}

/**
 * Decrypt sensitive data
 * 
 * @param string $data
 * @return string
 */
function hostx_email_decrypt($data)
{
    if (empty($data)) {
        return '';
    }
    
    try {
        $key = hostx_email_get_encryption_key();
        $data = base64_decode($data);
        
        if ($data === false || strlen($data) < 16) {
            return '';
        }
        
        $iv = substr($data, 0, 16);
        $encrypted = substr($data, 16);
        
        $decrypted = openssl_decrypt($encrypted, 'AES-256-CBC', $key, OPENSSL_RAW_DATA, $iv);
        
        return $decrypted !== false ? $decrypted : '';
        
    } catch (Exception $e) {
        return '';
    }
}

/**
 * Generate a secure random password
 * 
 * @param int $length
 * @return string
 */
function hostx_email_generate_password($length = 16)
{
    $uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    $lowercase = 'abcdefghijklmnopqrstuvwxyz';
    $numbers = '0123456789';
    $special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    
    $all = $uppercase . $lowercase . $numbers . $special;
    
    $password = '';
    $password .= $uppercase[random_int(0, strlen($uppercase) - 1)];
    $password .= $lowercase[random_int(0, strlen($lowercase) - 1)];
    $password .= $numbers[random_int(0, strlen($numbers) - 1)];
    $password .= $special[random_int(0, strlen($special) - 1)];
    
    for ($i = 4; $i < $length; $i++) {
        $password .= $all[random_int(0, strlen($all) - 1)];
    }
    
    return str_shuffle($password);
}

/**
 * Validate input parameters
 * 
 * @param array $params
 * @return bool
 * @throws Exception
 */
function hostx_email_validate_input(array $params)
{
    $domain = $params['domain'] ?: '';
    $username = $params['username'] ?: '';
    
    if (empty($domain)) {
        throw new Exception('Domain name is required');
    }
    
    if (empty($username)) {
        throw new Exception('Username is required');
    }
    
    // Validate domain format
    if (!filter_var($domain, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME)) {
        throw new Exception('Invalid domain name format');
    }
    
    // Validate username format (alphanumeric, dots, hyphens, underscores)
    if (!preg_match('/^[a-zA-Z0-9._-]+$/', $username)) {
        throw new Exception('Invalid username format. Use only letters, numbers, dots, hyphens, and underscores.');
    }
    
    // Validate username length
    if (strlen($username) < 1 || strlen($username) > 64) {
        throw new Exception('Username must be between 1 and 64 characters');
    }
    
    return true;
}

/**
 * Validate password strength
 * 
 * @param string $password
 * @return bool
 * @throws Exception
 */
function hostx_email_validate_password($password)
{
    if (empty($password)) {
        throw new Exception('Password cannot be empty');
    }
    
    if (strlen($password) < 8) {
        throw new Exception('Password must be at least 8 characters long');
    }
    
    if (strlen($password) > 128) {
        throw new Exception('Password cannot exceed 128 characters');
    }
    
    return true;
}

/**
 * Store account data in database
 * 
 * @param int $serviceId
 * @param array $data
 * @return bool
 */
function hostx_email_store_account_data($serviceId, array $data)
{
    try {
        // Check if table exists, create if not
        if (!Capsule::schema()->hasTable('mod_hostx_email_accounts')) {
            Capsule::schema()->create('mod_hostx_email_accounts', function ($table) {
                $table->increments('id');
                $table->integer('service_id')->unsigned();
                $table->string('provider', 50);
                $table->string('plan', 50);
                $table->string('email_address', 255);
                $table->string('external_id', 255)->nullable();
                $table->string('status', 50)->default('active');
                $table->text('additional_data')->nullable();
                $table->timestamp('created_at')->nullable();
                $table->timestamp('updated_at')->nullable();
                $table->unique('service_id');
            });
        }
        
        $existing = Capsule::table('mod_hostx_email_accounts')
            ->where('service_id', $serviceId)
            ->first();
        
        $recordData = [
            'service_id' => $serviceId,
            'provider' => $data['provider'] ?: '',
            'plan' => $data['plan'] ?: '',
            'email_address' => $data['email_address'] ?: '',
            'external_id' => $data['external_id'] ?: '',
            'status' => $data['status'] ?: 'active',
            'updated_at' => date('Y-m-d H:i:s'),
        ];
        
        if (!empty($data['additional_data'])) {
            $recordData['additional_data'] = json_encode($data['additional_data']);
        }
        
        if ($existing) {
            Capsule::table('mod_hostx_email_accounts')
                ->where('service_id', $serviceId)
                ->update($recordData);
        } else {
            $recordData['created_at'] = $data['created_at'] ?: date('Y-m-d H:i:s');
            Capsule::table('mod_hostx_email_accounts')->insert($recordData);
        }
        
        return true;
        
    } catch (Exception $e) {
        logModuleCall(
            'hostx_email',
            'StoreAccountData-Error',
            $e->getMessage(),
            ['service_id' => $serviceId],
            null,
            null
        );
        return false;
    }
}

/**
 * Get account data from database
 * 
 * @param int $serviceId
 * @return array
 */
function hostx_email_get_account_data($serviceId)
{
    try {
        if (!Capsule::schema()->hasTable('mod_hostx_email_accounts')) {
            return [];
        }
        
        $record = Capsule::table('mod_hostx_email_accounts')
            ->where('service_id', $serviceId)
            ->first();
        
        if ($record) {
            $data = (array) $record;
            if (!empty($data['additional_data'])) {
                $data['additional_data'] = json_decode($data['additional_data'], true);
            }
            return $data;
        }
        
        return [];
        
    } catch (Exception $e) {
        return [];
    }
}

/**
 * Update account status
 * 
 * @param int $serviceId
 * @param string $status
 * @return bool
 */
function hostx_email_update_account_status($serviceId, $status)
{
    try {
        if (!Capsule::schema()->hasTable('mod_hostx_email_accounts')) {
            return false;
        }
        
        Capsule::table('mod_hostx_email_accounts')
            ->where('service_id', $serviceId)
            ->update([
                'status' => $status,
                'updated_at' => date('Y-m-d H:i:s'),
            ]);
        
        return true;
        
    } catch (Exception $e) {
        logModuleCall(
            'hostx_email',
            'UpdateAccountStatus-Error',
            $e->getMessage(),
            ['service_id' => $serviceId, 'status' => $status],
            null,
            null
        );
        return false;
    }
}

/**
 * Update account data
 * 
 * @param int $serviceId
 * @param array $data
 * @return bool
 */
function hostx_email_update_account_data($serviceId, array $data)
{
    try {
        if (!Capsule::schema()->hasTable('mod_hostx_email_accounts')) {
            return false;
        }
        
        $updateData = ['updated_at' => date('Y-m-d H:i:s')];
        
        if (isset($data['plan'])) {
            $updateData['plan'] = $data['plan'];
        }
        if (isset($data['external_id'])) {
            $updateData['external_id'] = $data['external_id'];
        }
        if (isset($data['status'])) {
            $updateData['status'] = $data['status'];
        }
        
        Capsule::table('mod_hostx_email_accounts')
            ->where('service_id', $serviceId)
            ->update($updateData);
        
        return true;
        
    } catch (Exception $e) {
        return false;
    }
}

/**
 * Delete account data
 * 
 * @param int $serviceId
 * @return bool
 */
function hostx_email_delete_account_data($serviceId)
{
    try {
        if (!Capsule::schema()->hasTable('mod_hostx_email_accounts')) {
            return false;
        }
        
        Capsule::table('mod_hostx_email_accounts')
            ->where('service_id', $serviceId)
            ->delete();
        
        return true;
        
    } catch (Exception $e) {
        return false;
    }
}

/**
 * Get provider display name
 * 
 * @param string $provider
 * @return string
 */
function hostx_email_get_provider_name($provider)
{
    $providers = [
        'professional' => 'Professional Email (IMAP/SMTP)',
        'microsoft365' => 'Microsoft 365',
        'google_workspace' => 'Google Workspace',
    ];
    
    return $providers[$provider] ?: 'Unknown Provider';
}

/**
 * Get login URLs for provider
 * 
 * @param string $provider
 * @param string $domain
 * @return array
 */
function hostx_email_get_login_urls($provider, $domain = '')
{
    $urls = [
        'professional' => [
            'primary' => 'https://webmail.' . $domain,
            'webmail' => 'https://webmail.' . $domain,
            'smtp' => 'smtp.' . $domain,
            'imap' => 'imap.' . $domain,
        ],
        'microsoft365' => [
            'primary' => 'https://outlook.office365.com',
            'webmail' => 'https://outlook.office365.com/mail',
            'outlook' => 'https://outlook.office365.com',
            'admin' => 'https://admin.microsoft.com',
        ],
        'google_workspace' => [
            'primary' => 'https://mail.google.com',
            'webmail' => 'https://mail.google.com',
            'gmail' => 'https://mail.google.com',
            'admin' => 'https://admin.google.com',
        ],
    ];
    
    return $urls[$provider] ?: $urls['professional'];
}

/**
 * Get DNS records for domain configuration
 * 
 * @param string $provider
 * @param string $domain
 * @return array
 */
function hostx_email_get_dns_records($provider, $domain)
{
    $records = [];
    
    switch ($provider) {
        case 'microsoft365':
            $records = [
                [
                    'type' => 'MX',
                    'host' => '@',
                    'priority' => 0,
                    'value' => $domain . '.mail.protection.outlook.com',
                    'description' => 'Mail Exchanger for Microsoft 365',
                ],
                [
                    'type' => 'TXT',
                    'host' => '@',
                    'value' => 'v=spf1 include:spf.protection.outlook.com -all',
                    'description' => 'SPF record for Microsoft 365',
                ],
                [
                    'type' => 'CNAME',
                    'host' => 'autodiscover',
                    'value' => 'autodiscover.outlook.com',
                    'description' => 'AutoDiscover for Outlook clients',
                ],
                [
                    'type' => 'CNAME',
                    'host' => 'msoid',
                    'value' => 'clientconfig.microsoftonline-p.net',
                    'description' => 'Microsoft Online ID',
                ],
                [
                    'type' => 'TXT',
                    'host' => '@',
                    'value' => 'v=DMARC1; p=quarantine; rua=mailto:dmarc@' . $domain,
                    'description' => 'DMARC policy record',
                ],
            ];
            break;
            
        case 'google_workspace':
            $records = [
                [
                    'type' => 'MX',
                    'host' => '@',
                    'priority' => 1,
                    'value' => 'ASPMX.L.GOOGLE.COM',
                    'description' => 'Primary Google Mail Exchanger',
                ],
                [
                    'type' => 'MX',
                    'host' => '@',
                    'priority' => 5,
                    'value' => 'ALT1.ASPMX.L.GOOGLE.COM',
                    'description' => 'Backup Google Mail Exchanger 1',
                ],
                [
                    'type' => 'MX',
                    'host' => '@',
                    'priority' => 5,
                    'value' => 'ALT2.ASPMX.L.GOOGLE.COM',
                    'description' => 'Backup Google Mail Exchanger 2',
                ],
                [
                    'type' => 'MX',
                    'host' => '@',
                    'priority' => 10,
                    'value' => 'ALT3.ASPMX.L.GOOGLE.COM',
                    'description' => 'Backup Google Mail Exchanger 3',
                ],
                [
                    'type' => 'MX',
                    'host' => '@',
                    'priority' => 10,
                    'value' => 'ALT4.ASPMX.L.GOOGLE.COM',
                    'description' => 'Backup Google Mail Exchanger 4',
                ],
                [
                    'type' => 'TXT',
                    'host' => '@',
                    'value' => 'v=spf1 include:_spf.google.com -all',
                    'description' => 'SPF record for Google Workspace',
                ],
                [
                    'type' => 'CNAME',
                    'host' => 'mail',
                    'value' => 'ghs.googlehosted.com',
                    'description' => 'Webmail access alias',
                ],
                [
                    'type' => 'TXT',
                    'host' => '@',
                    'value' => 'v=DMARC1; p=quarantine; rua=mailto:dmarc@' . $domain,
                    'description' => 'DMARC policy record',
                ],
            ];
            break;
            
        case 'professional':
        default:
            $records = [
                [
                    'type' => 'MX',
                    'host' => '@',
                    'priority' => 10,
                    'value' => 'mx1.' . $domain,
                    'description' => 'Primary Mail Exchanger',
                ],
                [
                    'type' => 'MX',
                    'host' => '@',
                    'priority' => 20,
                    'value' => 'mx2.' . $domain,
                    'description' => 'Backup Mail Exchanger',
                ],
                [
                    'type' => 'A',
                    'host' => 'mail',
                    'value' => $_SERVER['SERVER_ADDR'] ?: 'YOUR_SERVER_IP',
                    'description' => 'Webmail access',
                ],
                [
                    'type' => 'A',
                    'host' => 'mx1',
                    'value' => $_SERVER['SERVER_ADDR'] ?: 'YOUR_SERVER_IP',
                    'description' => 'Primary Mail Server',
                ],
                [
                    'type' => 'A',
                    'host' => 'mx2',
                    'value' => $_SERVER['SERVER_ADDR'] ?: 'YOUR_SERVER_IP_BACKUP',
                    'description' => 'Backup Mail Server',
                ],
                [
                    'type' => 'TXT',
                    'host' => '@',
                    'value' => 'v=spf1 a mx include:' . $domain . ' -all',
                    'description' => 'SPF record',
                ],
                [
                    'type' => 'CNAME',
                    'host' => 'webmail',
                    'value' => 'mail.' . $domain,
                    'description' => 'Webmail alias',
                ],
                [
                    'type' => 'TXT',
                    'host' => '_dmarc',
                    'value' => 'v=DMARC1; p=quarantine; rua=mailto:dmarc@' . $domain,
                    'description' => 'DMARC policy record',
                ],
            ];
            break;
    }
    
    return $records;
}

/**
 * Build params array from service object
 * 
 * @param object $service
 * @return array|null
 */
function hostx_email_build_params_from_service($service)
{
    try {
        $product = Capsule::table('tblproducts')
            ->where('id', $service->packageid)
            ->first();
        
        $server = Capsule::table('tblservers')
            ->where('id', $service->server)
            ->first();
        
        $client = Capsule::table('tblclients')
            ->where('id', $service->userid)
            ->first();
        
        if (!$product) {
            return null;
        }
        
        return [
            'serviceid' => $service->id,
            'pid' => $service->packageid,
            'userid' => $service->userid,
            'domain' => $service->domain,
            'username' => $service->username,
            'password' => $service->password ? hostx_email_decrypt($service->password) : '',
            'configoption1' => $product->configoption1,
            'configoption2' => $product->configoption2,
            'configoption3' => $product->configoption3,
            'configoption4' => $product->configoption4,
            'configoption5' => $product->configoption5,
            'server' => $service->server,
            'serverusername' => $server ? hostx_email_decrypt($server->username) : '',
            'serverpassword' => $server ? hostx_email_decrypt($server->password) : '',
            'serveraccesshash' => $server ? $server->accesshash : '',
            'serverip' => $server ? $server->ipaddress : '',
            'serverhostname' => $server ? $server->hostname : '',
            'clientsdetails' => [
                'fullname' => $client ? $client->firstname . ' ' . $client->lastname : '',
                'firstname' => $client ? $client->firstname : '',
                'lastname' => $client ? $client->lastname : '',
                'email' => $client ? $client->email : '',
            ],
            'systemurl' => Capsule::table('tblconfiguration')
                ->where('setting', 'SystemURL')
                ->value('value'),
        ];
        
    } catch (Exception $e) {
        logActivity("HostX Email: Error building params - " . $e->getMessage());
        return null;
    }
}

/**
 * Log API request/response
 * 
 * @param string $provider
 * @param string $action
 * @param string $endpoint
 * @param array $request
 * @param array $response
 * @param int $httpCode
 */
function hostx_email_log_api_call($provider, $action, $endpoint, $request, $response, $httpCode = 200)
{
    try {
        // Check if log table exists, create if not
        if (!Capsule::schema()->hasTable('mod_hostx_email_api_logs')) {
            Capsule::schema()->create('mod_hostx_email_api_logs', function ($table) {
                $table->increments('id');
                $table->string('provider', 50);
                $table->string('action', 100);
                $table->text('endpoint');
                $table->text('request')->nullable();
                $table->text('response')->nullable();
                $table->integer('http_code')->default(0);
                $table->timestamp('created_at')->nullable();
            });
        }
        
        // Sanitize request to remove sensitive data
        $sanitizedRequest = $request;
        if (isset($sanitizedRequest['password'])) {
            $sanitizedRequest['password'] = '***REDACTED***';
        }
        if (isset($sanitizedRequest['client_secret'])) {
            $sanitizedRequest['client_secret'] = '***REDACTED***';
        }
        
        Capsule::table('mod_hostx_email_api_logs')->insert([
            'provider' => $provider,
            'action' => $action,
            'endpoint' => $endpoint,
            'request' => json_encode($sanitizedRequest),
            'response' => json_encode($response),
            'http_code' => $httpCode,
            'created_at' => date('Y-m-d H:i:s'),
        ]);
        
    } catch (Exception $e) {
        // Silently fail - don't break functionality due to logging issues
    }
}

/**
 * Clean old API logs (keep last 30 days)
 */
function hostx_email_clean_old_logs()
{
    try {
        if (Capsule::schema()->hasTable('mod_hostx_email_api_logs')) {
            Capsule::table('mod_hostx_email_api_logs')
                ->where('created_at', '<', date('Y-m-d H:i:s', strtotime('-30 days')))
                ->delete();
        }
    } catch (Exception $e) {
        // Silently fail
    }
}

/**
 * Rate limiting check
 * 
 * @param string $identifier
 * @param int $maxRequests
 * @param int $timeWindow
 * @return bool
 */
function hostx_email_check_rate_limit($identifier, $maxRequests = 60, $timeWindow = 3600)
{
    try {
        $cacheKey = 'hostx_email_ratelimit_' . md5($identifier);
        $cacheFile = sys_get_temp_dir() . '/' . $cacheKey . '.cache';
        
        $requests = [];
        if (file_exists($cacheFile)) {
            $requests = json_decode(file_get_contents($cacheFile), true) ?: [];
        }
        
        $now = time();
        $requests = array_filter($requests, function ($timestamp) use ($now, $timeWindow) {
            return ($now - $timestamp) < $timeWindow;
        });
        
        if (count($requests) >= $maxRequests) {
            return false;
        }
        
        $requests[] = $now;
        file_put_contents($cacheFile, json_encode($requests), LOCK_EX);
        
        return true;
        
    } catch (Exception $e) {
        // If rate limiting fails, allow the request
        return true;
    }
}

/**
 * Safe cURL execution with timeout and error handling
 * 
 * @param string $url
 * @param array $options
 * @return array
 */
function hostx_email_curl_execute($url, array $options = [])
{
    $ch = curl_init($url);
    
    $defaultOptions = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERAGENT => 'HostX-Email-Module/1.0',
    ];
    
    foreach ($defaultOptions as $option => $value) {
        curl_setopt($ch, $option, $value);
    }
    
    // Apply custom options
    foreach ($options as $option => $value) {
        curl_setopt($ch, $option, $value);
    }
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    $errno = curl_errno($ch);
    
    curl_close($ch);
    
    if ($errno !== 0) {
        return [
            'success' => false,
            'error' => 'cURL Error (' . $errno . '): ' . $error,
            'http_code' => 0,
            'response' => null,
        ];
    }
    
    return [
        'success' => true,
        'http_code' => $httpCode,
        'response' => $response,
    ];
}

/**
 * Parse JSON response safely
 * 
 * @param string $json
 * @return array|null
 */
function hostx_email_parse_json($json)
{
    if (empty($json)) {
        return null;
    }
    
    $data = json_decode($json, true);
    
    if (json_last_error() !== JSON_ERROR_NONE) {
        return ['raw_response' => $json];
    }
    
    return $data;
}

/**
 * Check if required PHP extensions are loaded
 * 
 * @return array
 */
function hostx_email_check_requirements()
{
    $requirements = [
        'curl' => extension_loaded('curl'),
        'openssl' => extension_loaded('openssl'),
        'json' => extension_loaded('json'),
        'pdo' => extension_loaded('pdo'),
        'filter' => extension_loaded('filter'),
    ];
    
    $missing = array_filter($requirements, function ($loaded) {
        return !$loaded;
    });
    
    return [
        'met' => empty($missing),
        'missing' => array_keys($missing),
    ];
}

/**
 * Module installation routine
 */
function hostx_email_install()
{
    try {
        // Create accounts table
        if (!Capsule::schema()->hasTable('mod_hostx_email_accounts')) {
            Capsule::schema()->create('mod_hostx_email_accounts', function ($table) {
                $table->increments('id');
                $table->integer('service_id')->unsigned();
                $table->string('provider', 50);
                $table->string('plan', 50);
                $table->string('email_address', 255);
                $table->string('external_id', 255)->nullable();
                $table->string('status', 50)->default('active');
                $table->text('additional_data')->nullable();
                $table->timestamp('created_at')->nullable();
                $table->timestamp('updated_at')->nullable();
                $table->unique('service_id');
            });
        }
        
        // Create API logs table
        if (!Capsule::schema()->hasTable('mod_hostx_email_api_logs')) {
            Capsule::schema()->create('mod_hostx_email_api_logs', function ($table) {
                $table->increments('id');
                $table->string('provider', 50);
                $table->string('action', 100);
                $table->text('endpoint');
                $table->text('request')->nullable();
                $table->text('response')->nullable();
                $table->integer('http_code')->default(0);
                $table->timestamp('created_at')->nullable();
            });
        }
        
        logActivity('HostX Email Module: Installation completed successfully');
        
    } catch (Exception $e) {
        logActivity('HostX Email Module: Installation error - ' . $e->getMessage());
    }
}

/**
 * Module upgrade routine
 * 
 * @param array $vars
 */
function hostx_email_upgrade($vars)
{
    $version = $vars['version'];
    
    // Future upgrade routines can be added here
    logActivity('HostX Email Module: Upgraded from version ' . $version);
}

/**
 * Module activation
 */
function hostx_email_activate()
{
    hostx_email_install();
    return [
        'status' => 'success',
        'description' => 'HostX Email module activated successfully.',
    ];
}

/**
 * Module deactivation
 */
function hostx_email_deactivate()
{
    return [
        'status' => 'success',
        'description' => 'HostX Email module deactivated. Database tables preserved for data integrity.',
    ];
}
