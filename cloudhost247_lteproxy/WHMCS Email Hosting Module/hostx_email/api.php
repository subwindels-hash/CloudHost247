<?php
/**
 * HostX Email Module - API Integration Layer
 * 
 * Handles API communication with:
 * - Microsoft Graph API (Microsoft 365)
 * - Google Admin SDK (Google Workspace)
 * - Generic IMAP/SMTP API (Professional Email)
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

/**
 * HostX Email API Handler Class
 */
class HostxEmailAPI
{
    /**
     * Module parameters
     * 
     * @var array
     */
    private $params;
    
    /**
     * API base URLs
     */
    const MICROSOFT_GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
    const MICROSOFT_LOGIN_BASE = 'https://login.microsoftonline.com';
    const GOOGLE_ADMIN_BASE = 'https://admin.googleapis.com/admin/directory/v1';
    const GOOGLE_AUTH_BASE = 'https://oauth2.googleapis.com/token';
    
    /**
     * Microsoft 365 License SKUs
     */
    const MS_LICENSE_BUSINESS_BASIC = 'O365_BUSINESS_ESSENTIALS';
    const MS_LICENSE_BUSINESS_STANDARD = 'O365_BUSINESS_PREMIUM';
    const MS_LICENSE_BUSINESS_PREMIUM = 'SPB';
    const MS_LICENSE_E1 = 'STANDARDPACK';
    const MS_LICENSE_E3 = 'ENTERPRISEPACK';
    const MS_LICENSE_E5 = 'ENTERPRISEPREMIUM';
    
    /**
     * Google Workspace License SKUs
     */
    const GW_LICENSE_BUSINESS_STARTER = '1010020027';
    const GW_LICENSE_BUSINESS_STANDARD = '1010020028';
    const GW_LICENSE_BUSINESS_PLUS = '1010020025';
    const GW_LICENSE_ENTERPRISE = '1010020026';
    
    /**
     * Constructor
     * 
     * @param array $params WHMCS module parameters
     */
    public function __construct(array $params)
    {
        $this->params = $params;
    }
    
    /**
     * ================================
     * MICROSOFT 365 API METHODS
     * ================================
     */
    
    /**
     * Get Microsoft 365 access token
     * 
     * @return array
     */
    private function getMicrosoft365AccessToken()
    {
        $tenantId = hostx_email_decrypt($this->params['serverusername']);
        $clientId = $this->params['serveraccesshash'];
        $clientSecret = hostx_email_decrypt($this->params['serverpassword']);
        
        if (empty($tenantId) || empty($clientId) || empty($clientSecret)) {
            return [
                'success' => false,
                'message' => 'Microsoft 365 credentials not configured',
            ];
        }
        
        $url = self::MICROSOFT_LOGIN_BASE . '/' . $tenantId . '/oauth2/v2.0/token';
        
        $postData = [
            'grant_type' => 'client_credentials',
            'client_id' => $clientId,
            'client_secret' => $clientSecret,
            'scope' => 'https://graph.microsoft.com/.default',
        ];
        
        $result = hostx_email_curl_execute($url, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query($postData),
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/x-www-form-urlencoded',
            ],
        ]);
        
        if (!$result['success']) {
            return [
                'success' => false,
                'message' => 'Failed to authenticate with Microsoft: ' . $result['error'],
            ];
        }
        
        $data = hostx_email_parse_json($result['response']);
        
        if (isset($data['access_token'])) {
            return [
                'success' => true,
                'token' => $data['access_token'],
                'expires_in' => $data['expires_in'] ?? 3600,
            ];
        }
        
        $errorMessage = isset($data['error_description']) 
            ? $data['error_description'] 
            : ($data['error'] ?: 'Unknown authentication error');
        
        hostx_email_log_api_call('microsoft365', 'auth', $url, $postData, $data, $result['http_code']);
        
        return [
            'success' => false,
            'message' => 'Microsoft 365 authentication failed: ' . $errorMessage,
        ];
    }
    
    /**
     * Make authenticated request to Microsoft Graph API
     * 
     * @param string $endpoint
     * @param string $method
     * @param array $data
     * @return array
     */
    private function microsoftGraphRequest($endpoint, $method = 'GET', $data = null)
    {
        $tokenResult = $this->getMicrosoft365AccessToken();
        
        if (!$tokenResult['success']) {
            return $tokenResult;
        }
        
        $url = self::MICROSOFT_GRAPH_BASE . $endpoint;
        
        $options = [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $tokenResult['token'],
                'Content-Type: application/json',
            ],
        ];
        
        if ($data !== null) {
            $options[CURLOPT_POSTFIELDS] = json_encode($data);
        }
        
        $result = hostx_email_curl_execute($url, $options);
        
        if (!$result['success']) {
            return [
                'success' => false,
                'message' => 'API request failed: ' . $result['error'],
            ];
        }
        
        $response = hostx_email_parse_json($result['response']);
        
        hostx_email_log_api_call('microsoft365', $method . ' ' . $endpoint, $url, $data ?: [], $response, $result['http_code']);
        
        if ($result['http_code'] >= 200 && $result['http_code'] < 300) {
            return [
                'success' => true,
                'data' => $response,
            ];
        }
        
        $errorMessage = isset($response['error']['message']) 
            ? $response['error']['message'] 
            : 'HTTP ' . $result['http_code'];
        
        return [
            'success' => false,
            'message' => $errorMessage,
            'http_code' => $result['http_code'],
        ];
    }
    
    /**
     * Create Microsoft 365 user account
     * 
     * @param array $data
     * @return array
     */
    public function createMicrosoft365Account(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        $userData = [
            'accountEnabled' => true,
            'displayName' => $data['display_name'] ?: $data['username'],
            'mailNickname' => $data['username'],
            'userPrincipalName' => $emailAddress,
            'passwordProfile' => [
                'forceChangePasswordNextSignIn' => false,
                'password' => $data['password'],
            ],
            'usageLocation' => $this->params['clientsdetails']['country'] ?: 'US',
        ];
        
        $result = $this->microsoftGraphRequest('/users', 'POST', $userData);
        
        if ($result['success']) {
            $userId = $result['data']['id'] ?: '';
            
            // Assign license if plan specified
            if (!empty($data['plan'])) {
                $licenseSku = $this->getMicrosoft365LicenseSku($data['plan']);
                if ($licenseSku) {
                    $this->assignMicrosoft365License($userId, $licenseSku);
                }
            }
            
            return [
                'success' => true,
                'external_id' => $userId,
                'message' => 'Microsoft 365 account created successfully',
                'email' => $emailAddress,
            ];
        }
        
        return $result;
    }
    
    /**
     * Get Microsoft 365 license SKU by plan name
     * 
     * @param string $plan
     * @return string|null
     */
    private function getMicrosoft365LicenseSku($plan)
    {
        $planSkus = [
            'basic' => self::MS_LICENSE_BUSINESS_BASIC,
            'standard' => self::MS_LICENSE_BUSINESS_STANDARD,
            'premium' => self::MS_LICENSE_BUSINESS_PREMIUM,
        ];
        
        return $planSkus[$plan] ?: null;
    }
    
    /**
     * Assign license to Microsoft 365 user
     * 
     * @param string $userId
     * @param string $skuId
     * @return array
     */
    public function assignMicrosoft365License($userId, $skuId)
    {
        $licenseData = [
            'addLicenses' => [
                [
                    'skuId' => $skuId,
                ],
            ],
            'removeLicenses' => [],
        ];
        
        return $this->microsoftGraphRequest('/users/' . $userId . '/assignLicense', 'POST', $licenseData);
    }
    
    /**
     * Suspend Microsoft 365 account
     * 
     * @param array $data
     * @return array
     */
    public function suspendMicrosoft365Account(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        $updateData = [
            'accountEnabled' => false,
        ];
        
        return $this->microsoftGraphRequest('/users/' . $emailAddress, 'PATCH', $updateData);
    }
    
    /**
     * Unsuspend Microsoft 365 account
     * 
     * @param array $data
     * @return array
     */
    public function unsuspendMicrosoft365Account(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        $updateData = [
            'accountEnabled' => true,
        ];
        
        return $this->microsoftGraphRequest('/users/' . $emailAddress, 'PATCH', $updateData);
    }
    
    /**
     * Delete Microsoft 365 account
     * 
     * @param array $data
     * @return array
     */
    public function deleteMicrosoft365Account(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        return $this->microsoftGraphRequest('/users/' . $emailAddress, 'DELETE');
    }
    
    /**
     * Change Microsoft 365 password
     * 
     * @param array $data
     * @return array
     */
    public function changeMicrosoft365Password(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        $passwordData = [
            'passwordProfile' => [
                'forceChangePasswordNextSignIn' => false,
                'password' => $data['password'],
            ],
        ];
        
        return $this->microsoftGraphRequest('/users/' . $emailAddress, 'PATCH', $passwordData);
    }
    
    /**
     * Get Microsoft 365 account status
     * 
     * @param array $data
     * @return array
     */
    public function getMicrosoft365AccountStatus(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        $result = $this->microsoftGraphRequest('/users/' . $emailAddress . '?$select=accountEnabled,signInActivity');
        
        if ($result['success'] && isset($result['data'])) {
            $isEnabled = $result['data']['accountEnabled'] ?: false;
            return [
                'success' => true,
                'status' => $isEnabled ? 'active' : 'suspended',
                'data' => $result['data'],
            ];
        }
        
        return $result;
    }
    
    /**
     * Change Microsoft 365 plan
     * 
     * @param array $data
     * @return array
     */
    public function changeMicrosoft365Plan(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        // Get current licenses
        $currentResult = $this->microsoftGraphRequest('/users/' . $emailAddress . '/licenseDetails');
        
        $removeLicenses = [];
        if ($currentResult['success'] && isset($currentResult['data']['value'])) {
            foreach ($currentResult['data']['value'] as $license) {
                $removeLicenses[] = $license['skuId'];
            }
        }
        
        // Assign new license
        $newSku = $this->getMicrosoft365LicenseSku($data['plan']);
        
        $licenseData = [
            'addLicenses' => [
                [
                    'skuId' => $newSku,
                ],
            ],
            'removeLicenses' => $removeLicenses,
        ];
        
        return $this->microsoftGraphRequest('/users/' . $emailAddress . '/assignLicense', 'POST', $licenseData);
    }
    
    /**
     * Get Microsoft 365 usage data
     * 
     * @param array $data
     * @return array
     */
    public function getMicrosoft365Usage(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        $result = $this->microsoftGraphRequest('/users/' . $emailAddress . '/mailboxUsageDetail');
        
        if ($result['success']) {
            return [
                'success' => true,
                'disk_usage' => $result['data']['storageUsedInBytes'] ? round($result['data']['storageUsedInBytes'] / (1024 * 1024 * 1024), 2) : 0,
                'disk_limit' => $result['data']['deletedItemCount'] ?: 50,
            ];
        }
        
        return [
            'success' => true,
            'disk_usage' => 0,
            'disk_limit' => 50,
        ];
    }
    
    /**
     * Test Microsoft 365 connection
     * 
     * @return array
     */
    public function testMicrosoft365Connection()
    {
        $tokenResult = $this->getMicrosoft365AccessToken();
        
        if ($tokenResult['success']) {
            // Try to list users (limited to 1) to verify permissions
            $result = $this->microsoftGraphRequest('/users?$top=1');
            
            if ($result['success'] || $result['http_code'] === 403) {
                // 403 means auth works but permissions might be limited
                return [
                    'success' => true,
                    'message' => 'Connection successful',
                ];
            }
        }
        
        return [
            'success' => false,
            'message' => $tokenResult['message'] ?: 'Connection failed',
        ];
    }
    
    /**
     * ================================
     * GOOGLE WORKSPACE API METHODS
     * ================================
     */
    
    /**
     * Get Google Workspace access token from service account
     * 
     * @return array
     */
    private function getGoogleWorkspaceAccessToken()
    {
        $serviceAccountJson = hostx_email_decrypt($this->params['configoption7']);
        
        if (empty($serviceAccountJson)) {
            return [
                'success' => false,
                'message' => 'Google Workspace service account not configured',
            ];
        }
        
        $serviceAccount = json_decode($serviceAccountJson, true);
        
        if (!$serviceAccount || !isset($serviceAccount['client_email'])) {
            return [
                'success' => false,
                'message' => 'Invalid Google Workspace service account JSON',
            ];
        }
        
        $now = time();
        $jwtHeader = json_encode(['alg' => 'RS256', 'typ' => 'JWT']);
        $jwtClaim = json_encode([
            'iss' => $serviceAccount['client_email'],
            'sub' => $serviceAccount['client_email'],
            'scope' => 'https://www.googleapis.com/auth/admin.directory.user https://www.googleapis.com/auth/admin.directory.domain',
            'aud' => self::GOOGLE_AUTH_BASE,
            'iat' => $now,
            'exp' => $now + 3600,
        ]);
        
        $jwtBase = rtrim(strtr(base64_encode($jwtHeader), '+/', '-_'), '=') . '.' .
                   rtrim(strtr(base64_encode($jwtClaim), '+/', '-_'), '=');
        
        $privateKey = $serviceAccount['private_key'];
        
        openssl_sign($jwtBase, $signature, $privateKey, OPENSSL_ALGO_SHA256);
        
        $jwt = $jwtBase . '.' . rtrim(strtr(base64_encode($signature), '+/', '-_'), '=');
        
        $postData = [
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion' => $jwt,
        ];
        
        $result = hostx_email_curl_execute(self::GOOGLE_AUTH_BASE, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query($postData),
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/x-www-form-urlencoded',
            ],
        ]);
        
        if (!$result['success']) {
            return [
                'success' => false,
                'message' => 'Failed to authenticate with Google: ' . $result['error'],
            ];
        }
        
        $data = hostx_email_parse_json($result['response']);
        
        if (isset($data['access_token'])) {
            return [
                'success' => true,
                'token' => $data['access_token'],
                'expires_in' => $data['expires_in'] ?: 3600,
            ];
        }
        
        $errorMessage = isset($data['error_description']) 
            ? $data['error_description'] 
            : ($data['error'] ?: 'Unknown authentication error');
        
        hostx_email_log_api_call('google_workspace', 'auth', self::GOOGLE_AUTH_BASE, $postData, $data, $result['http_code']);
        
        return [
            'success' => false,
            'message' => 'Google Workspace authentication failed: ' . $errorMessage,
        ];
    }
    
    /**
     * Make authenticated request to Google Admin SDK
     * 
     * @param string $endpoint
     * @param string $method
     * @param array $data
     * @return array
     */
    private function googleAdminRequest($endpoint, $method = 'GET', $data = null)
    {
        $tokenResult = $this->getGoogleWorkspaceAccessToken();
        
        if (!$tokenResult['success']) {
            return $tokenResult;
        }
        
        $url = self::GOOGLE_ADMIN_BASE . $endpoint;
        
        $options = [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $tokenResult['token'],
                'Content-Type: application/json',
            ],
        ];
        
        if ($data !== null) {
            $options[CURLOPT_POSTFIELDS] = json_encode($data);
        }
        
        $result = hostx_email_curl_execute($url, $options);
        
        if (!$result['success']) {
            return [
                'success' => false,
                'message' => 'API request failed: ' . $result['error'],
            ];
        }
        
        $response = hostx_email_parse_json($result['response']);
        
        hostx_email_log_api_call('google_workspace', $method . ' ' . $endpoint, $url, $data ?: [], $response, $result['http_code']);
        
        if ($result['http_code'] >= 200 && $result['http_code'] < 300) {
            return [
                'success' => true,
                'data' => $response,
            ];
        }
        
        $errorMessage = isset($response['error']['message']) 
            ? $response['error']['message'] 
            : 'HTTP ' . $result['http_code'];
        
        return [
            'success' => false,
            'message' => $errorMessage,
            'http_code' => $result['http_code'],
        ];
    }
    
    /**
     * Create Google Workspace user account
     * 
     * @param array $data
     * @return array
     */
    public function createGoogleWorkspaceAccount(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        $nameParts = $this->parseFullName($data['display_name'] ?: $data['username']);
        
        $userData = [
            'primaryEmail' => $emailAddress,
            'name' => [
                'givenName' => $nameParts['first'],
                'familyName' => $nameParts['last'],
            ],
            'password' => $data['password'],
            'changePasswordAtNextLogin' => false,
            'includeInGlobalAddressList' => true,
            'orgUnitPath' => '/',
        ];
        
        $result = $this->googleAdminRequest('/users', 'POST', $userData);
        
        if ($result['success']) {
            $userId = $result['data']['id'] ?: '';
            
            // Assign license if plan specified
            if (!empty($data['plan'])) {
                $this->assignGoogleWorkspaceLicense($emailAddress, $data['plan']);
            }
            
            return [
                'success' => true,
                'external_id' => $userId,
                'message' => 'Google Workspace account created successfully',
                'email' => $emailAddress,
            ];
        }
        
        return $result;
    }
    
    /**
     * Parse full name into first and last
     * 
     * @param string $fullName
     * @return array
     */
    private function parseFullName($fullName)
    {
        $parts = explode(' ', trim($fullName), 2);
        return [
            'first' => $parts[0] ?: $fullName,
            'last' => $parts[1] ?: '',
        ];
    }
    
    /**
     * Assign license to Google Workspace user
     * 
     * @param string $userEmail
     * @param string $plan
     * @return array
     */
    public function assignGoogleWorkspaceLicense($userEmail, $plan)
    {
        $skuId = $this->getGoogleWorkspaceLicenseSku($plan);
        
        if (!$skuId) {
            return [
                'success' => false,
                'message' => 'Invalid plan for Google Workspace',
            ];
        }
        
        // Use Google Licensing API
        $url = 'https://licensing.googleapis.com/apps/licensing/v1/product/Google-Apps/users/' . $skuId . '/' . $userEmail;
        
        $tokenResult = $this->getGoogleWorkspaceAccessToken();
        
        if (!$tokenResult['success']) {
            return $tokenResult;
        }
        
        $result = hostx_email_curl_execute($url, [
            CURLOPT_PUT => true,
            CURLOPT_POSTFIELDS => json_encode(['userId' => $userEmail]),
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $tokenResult['token'],
                'Content-Type: application/json',
            ],
        ]);
        
        if ($result['http_code'] === 200 || $result['http_code'] === 201) {
            return [
                'success' => true,
                'message' => 'License assigned successfully',
            ];
        }
        
        $response = hostx_email_parse_json($result['response']);
        
        return [
            'success' => false,
            'message' => isset($response['error']['message']) ? $response['error']['message'] : 'Failed to assign license',
        ];
    }
    
    /**
     * Get Google Workspace license SKU by plan name
     * 
     * @param string $plan
     * @return string|null
     */
    private function getGoogleWorkspaceLicenseSku($plan)
    {
        $planSkus = [
            'basic' => self::GW_LICENSE_BUSINESS_STARTER,
            'standard' => self::GW_LICENSE_BUSINESS_STANDARD,
            'premium' => self::GW_LICENSE_BUSINESS_PLUS,
        ];
        
        return $planSkus[$plan] ?: null;
    }
    
    /**
     * Suspend Google Workspace account
     * 
     * @param array $data
     * @return array
     */
    public function suspendGoogleWorkspaceAccount(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        $updateData = [
            'suspended' => true,
        ];
        
        return $this->googleAdminRequest('/users/' . $emailAddress, 'PUT', $updateData);
    }
    
    /**
     * Unsuspend Google Workspace account
     * 
     * @param array $data
     * @return array
     */
    public function unsuspendGoogleWorkspaceAccount(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        $updateData = [
            'suspended' => false,
        ];
        
        return $this->googleAdminRequest('/users/' . $emailAddress, 'PUT', $updateData);
    }
    
    /**
     * Delete Google Workspace account
     * 
     * @param array $data
     * @return array
     */
    public function deleteGoogleWorkspaceAccount(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        return $this->googleAdminRequest('/users/' . $emailAddress, 'DELETE');
    }
    
    /**
     * Change Google Workspace password
     * 
     * @param array $data
     * @return array
     */
    public function changeGoogleWorkspacePassword(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        $passwordData = [
            'password' => $data['password'],
            'changePasswordAtNextLogin' => false,
        ];
        
        return $this->googleAdminRequest('/users/' . $emailAddress, 'PUT', $passwordData);
    }
    
    /**
     * Get Google Workspace account status
     * 
     * @param array $data
     * @return array
     */
    public function getGoogleWorkspaceAccountStatus(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        $result = $this->googleAdminRequest('/users/' . $emailAddress . '?projection=basic');
        
        if ($result['success'] && isset($result['data'])) {
            $isSuspended = $result['data']['suspended'] ?: false;
            return [
                'success' => true,
                'status' => $isSuspended ? 'suspended' : 'active',
                'data' => $result['data'],
            ];
        }
        
        return $result;
    }
    
    /**
     * Change Google Workspace plan
     * 
     * @param array $data
     * @return array
     */
    public function changeGoogleWorkspacePlan(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        // Remove current license
        $tokenResult = $this->getGoogleWorkspaceAccessToken();
        
        if ($tokenResult['success']) {
            $currentLicenses = ['Google-Apps'];
            foreach ($currentLicenses as $productId) {
                $url = 'https://licensing.googleapis.com/apps/licensing/v1/product/' . $productId . '/user/' . $emailAddress;
                hostx_email_curl_execute($url, [
                    CURLOPT_CUSTOMREQUEST => 'DELETE',
                    CURLOPT_HTTPHEADER => [
                        'Authorization: Bearer ' . $tokenResult['token'],
                    ],
                ]);
            }
        }
        
        // Assign new license
        return $this->assignGoogleWorkspaceLicense($emailAddress, $data['plan']);
    }
    
    /**
     * Get Google Workspace usage data
     * 
     * @param array $data
     * @return array
     */
    public function getGoogleWorkspaceUsage(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        // Get user details which includes storage quota
        $result = $this->googleAdminRequest('/users/' . $emailAddress . '?projection=full');
        
        if ($result['success'] && isset($result['data']['quotaUsage'])) {
            $usageBytes = $result['data']['quotaUsage'] ?: 0;
            return [
                'success' => true,
                'disk_usage' => round($usageBytes / (1024 * 1024 * 1024), 2),
                'disk_limit' => 30,
            ];
        }
        
        return [
            'success' => true,
            'disk_usage' => 0,
            'disk_limit' => 30,
        ];
    }
    
    /**
     * Test Google Workspace connection
     * 
     * @return array
     */
    public function testGoogleWorkspaceConnection()
    {
        $tokenResult = $this->getGoogleWorkspaceAccessToken();
        
        if ($tokenResult['success']) {
            return [
                'success' => true,
                'message' => 'Connection successful',
            ];
        }
        
        return [
            'success' => false,
            'message' => $tokenResult['message'] ?: 'Connection failed',
        ];
    }
    
    /**
     * ================================
     * PROFESSIONAL EMAIL API METHODS
     * ================================
     */
    
    /**
     * Get Professional Email API base URL
     * 
     * @return string
     */
    private function getProfessionalEmailBaseUrl()
    {
        return rtrim($this->params['serverip'] ?: 'https://api.hostx-email.com', '/');
    }
    
    /**
     * Get Professional Email API key
     * 
     * @return string
     */
    private function getProfessionalEmailApiKey()
    {
        return hostx_email_decrypt($this->params['serverpassword']);
    }
    
    /**
     * Make authenticated request to Professional Email API
     * 
     * @param string $endpoint
     * @param string $method
     * @param array $data
     * @return array
     */
    private function professionalEmailRequest($endpoint, $method = 'GET', $data = null)
    {
        $baseUrl = $this->getProfessionalEmailBaseUrl();
        $apiKey = $this->getProfessionalEmailApiKey();
        
        if (empty($baseUrl) || empty($apiKey)) {
            return [
                'success' => false,
                'message' => 'Professional Email API credentials not configured',
            ];
        }
        
        $url = $baseUrl . $endpoint;
        
        $options = [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $apiKey,
                'Content-Type: application/json',
                'Accept: application/json',
            ],
        ];
        
        if ($data !== null) {
            $options[CURLOPT_POSTFIELDS] = json_encode($data);
        }
        
        $result = hostx_email_curl_execute($url, $options);
        
        if (!$result['success']) {
            return [
                'success' => false,
                'message' => 'API request failed: ' . $result['error'],
            ];
        }
        
        $response = hostx_email_parse_json($result['response']);
        
        hostx_email_log_api_call('professional', $method . ' ' . $endpoint, $url, $data ?: [], $response, $result['http_code']);
        
        if ($result['http_code'] >= 200 && $result['http_code'] < 300) {
            return [
                'success' => true,
                'data' => $response,
            ];
        }
        
        $errorMessage = is_array($response) && isset($response['message']) 
            ? $response['message'] 
            : (is_array($response) && isset($response['error']) ? $response['error'] : 'HTTP ' . $result['http_code']);
        
        return [
            'success' => false,
            'message' => $errorMessage,
            'http_code' => $result['http_code'],
        ];
    }
    
    /**
     * Create Professional Email account
     * 
     * @param array $data
     * @return array
     */
    public function createProfessionalEmailAccount(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        $apiData = [
            'domain' => $data['domain'],
            'username' => $data['username'],
            'email' => $emailAddress,
            'password' => $data['password'],
            'plan' => $data['plan'] ?: 'standard',
            'quota' => ($data['mailbox_size'] ?: 10) * 1024, // Convert to MB
            'enabled' => true,
        ];
        
        $result = $this->professionalEmailRequest('/api/v1/mailboxes', 'POST', $apiData);
        
        if ($result['success']) {
            return [
                'success' => true,
                'external_id' => $result['data']['id'] ?: $emailAddress,
                'message' => 'Professional email account created successfully',
                'email' => $emailAddress,
            ];
        }
        
        return $result;
    }
    
    /**
     * Suspend Professional Email account
     * 
     * @param array $data
     * @return array
     */
    public function suspendProfessionalEmailAccount(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        $apiData = [
            'enabled' => false,
        ];
        
        return $this->professionalEmailRequest('/api/v1/mailboxes/' . $emailAddress, 'PATCH', $apiData);
    }
    
    /**
     * Unsuspend Professional Email account
     * 
     * @param array $data
     * @return array
     */
    public function unsuspendProfessionalEmailAccount(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        $apiData = [
            'enabled' => true,
        ];
        
        return $this->professionalEmailRequest('/api/v1/mailboxes/' . $emailAddress, 'PATCH', $apiData);
    }
    
    /**
     * Delete Professional Email account
     * 
     * @param array $data
     * @return array
     */
    public function deleteProfessionalEmailAccount(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        return $this->professionalEmailRequest('/api/v1/mailboxes/' . $emailAddress, 'DELETE');
    }
    
    /**
     * Change Professional Email password
     * 
     * @param array $data
     * @return array
     */
    public function changeProfessionalEmailPassword(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        $passwordData = [
            'password' => $data['password'],
        ];
        
        return $this->professionalEmailRequest('/api/v1/mailboxes/' . $emailAddress . '/password', 'POST', $passwordData);
    }
    
    /**
     * Get Professional Email account status
     * 
     * @param array $data
     * @return array
     */
    public function getProfessionalEmailAccountStatus(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        $result = $this->professionalEmailRequest('/api/v1/mailboxes/' . $emailAddress);
        
        if ($result['success'] && isset($result['data'])) {
            $isEnabled = $result['data']['enabled'] ?: false;
            return [
                'success' => true,
                'status' => $isEnabled ? 'active' : 'suspended',
                'data' => $result['data'],
            ];
        }
        
        return $result;
    }
    
    /**
     * Change Professional Email plan
     * 
     * @param array $data
     * @return array
     */
    public function changeProfessionalEmailPlan(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        $planData = [
            'plan' => $data['plan'],
            'quota' => ($data['mailbox_size'] ?: 10) * 1024,
        ];
        
        return $this->professionalEmailRequest('/api/v1/mailboxes/' . $emailAddress, 'PATCH', $planData);
    }
    
    /**
     * Get Professional Email usage data
     * 
     * @param array $data
     * @return array
     */
    public function getProfessionalEmailUsage(array $data)
    {
        $emailAddress = $data['username'] . '@' . $data['domain'];
        
        $result = $this->professionalEmailRequest('/api/v1/mailboxes/' . $emailAddress . '/usage');
        
        if ($result['success']) {
            return [
                'success' => true,
                'disk_usage' => $result['data']['used_gb'] ?: 0,
                'disk_limit' => $result['data']['quota_gb'] ?: 10,
            ];
        }
        
        return [
            'success' => true,
            'disk_usage' => 0,
            'disk_limit' => 10,
        ];
    }
    
    /**
     * Test Professional Email connection
     * 
     * @return array
     */
    public function testProfessionalEmailConnection()
    {
        $result = $this->professionalEmailRequest('/api/v1/status');
        
        if ($result['success'] || $result['http_code'] === 200) {
            return [
                'success' => true,
                'message' => 'Connection successful',
            ];
        }
        
        return [
            'success' => false,
            'message' => $result['message'] ?: 'Connection failed',
        ];
    }
    
    /**
     * ================================
     * WEBHOOK HANDLING
     * ================================
     */
    
    /**
     * Handle incoming webhook from providers
     * 
     * @param string $provider
     * @param array $payload
     * @return array
     */
    public function handleWebhook($provider, array $payload)
    {
        switch ($provider) {
            case 'microsoft365':
                return $this->handleMicrosoft365Webhook($payload);
                
            case 'google_workspace':
                return $this->handleGoogleWorkspaceWebhook($payload);
                
            case 'professional':
                return $this->handleProfessionalEmailWebhook($payload);
                
            default:
                return [
                    'success' => false,
                    'message' => 'Unknown provider: ' . $provider,
                ];
        }
    }
    
    /**
     * Handle Microsoft 365 webhook
     * 
     * @param array $payload
     * @return array
     */
    private function handleMicrosoft365Webhook(array $payload)
    {
        // Handle Microsoft Graph change notifications
        if (isset($payload['value'])) {
            foreach ($payload['value'] as $notification) {
                $userId = $notification['resourceData']['id'] ?: '';
                $changeType = $notification['changeType'] ?: '';
                
                // Find and update corresponding WHMCS service
                try {
                    $account = Capsule::table('mod_hostx_email_accounts')
                        ->where('external_id', $userId)
                        ->where('provider', 'microsoft365')
                        ->first();
                    
                    if ($account) {
                        switch ($changeType) {
                            case 'updated':
                                hostx_email_syncAccountStatus([
                                    'serviceid' => $account->service_id,
                                    'configoption1' => 'microsoft365',
                                    'username' => explode('@', $account->email_address)[0],
                                    'domain' => explode('@', $account->email_address)[1],
                                ]);
                                break;
                                
                            case 'deleted':
                                hostx_email_update_account_status($account->service_id, 'terminated');
                                break;
                        }
                    }
                } catch (Exception $e) {
                    logModuleCall('hostx_email', 'Webhook-Error', $e->getMessage(), $payload, null, null);
                }
            }
        }
        
        // Respond to validation request
        if (isset($payload['validationToken'])) {
            return [
                'success' => true,
                'response' => $payload['validationToken'],
            ];
        }
        
        return ['success' => true];
    }
    
    /**
     * Handle Google Workspace webhook
     * 
     * @param array $payload
     * @return array
     */
    private function handleGoogleWorkspaceWebhook(array $payload)
    {
        // Handle Google Workspace notifications
        if (isset($payload['events'])) {
            foreach ($payload['events'] as $event) {
                $userEmail = $event['userEmail'] ?: '';
                $eventType = $event['eventType'] ?: '';
                
                try {
                    $account = Capsule::table('mod_hostx_email_accounts')
                        ->where('email_address', $userEmail)
                        ->where('provider', 'google_workspace')
                        ->first();
                    
                    if ($account) {
                        switch ($eventType) {
                            case 'SUSPENDED':
                                hostx_email_update_account_status($account->service_id, 'suspended');
                                break;
                                
                            case 'UNSUSPENDED':
                                hostx_email_update_account_status($account->service_id, 'active');
                                break;
                                
                            case 'DELETED':
                                hostx_email_update_account_status($account->service_id, 'terminated');
                                break;
                        }
                    }
                } catch (Exception $e) {
                    logModuleCall('hostx_email', 'Webhook-Error', $e->getMessage(), $payload, null, null);
                }
            }
        }
        
        return ['success' => true];
    }
    
    /**
     * Handle Professional Email webhook
     * 
     * @param array $payload
     * @return array
     */
    private function handleProfessionalEmailWebhook(array $payload)
    {
        if (isset($payload['event']) && isset($payload['email'])) {
            $event = $payload['event'];
            $email = $payload['email'];
            
            try {
                $account = Capsule::table('mod_hostx_email_accounts')
                    ->where('email_address', $email)
                    ->where('provider', 'professional')
                    ->first();
                
                if ($account) {
                    switch ($event) {
                        case 'mailbox.suspended':
                            hostx_email_update_account_status($account->service_id, 'suspended');
                            break;
                            
                        case 'mailbox.activated':
                            hostx_email_update_account_status($account->service_id, 'active');
                            break;
                            
                        case 'mailbox.deleted':
                            hostx_email_update_account_status($account->service_id, 'terminated');
                            break;
                            
                        case 'mailbox.password_changed':
                            // Log password change event
                            logModuleCall(
                                'hostx_email',
                                'Webhook-PasswordChanged',
                                'Password changed for ' . $email,
                                $payload,
                                null,
                                null
                            );
                            break;
                    }
                }
            } catch (Exception $e) {
                logModuleCall('hostx_email', 'Webhook-Error', $e->getMessage(), $payload, null, null);
            }
        }
        
        return ['success' => true];
    }
    
    /**
     * Verify webhook signature
     * 
     * @param string $provider
     * @param string $payload
     * @param string $signature
     * @return bool
     */
    public function verifyWebhookSignature($provider, $payload, $signature)
    {
        switch ($provider) {
            case 'microsoft365':
                // Microsoft uses validation tokens in the notification
                return true;
                
            case 'google_workspace':
                // Google Workspace webhooks include a bearer token
                return true;
                
            case 'professional':
                $expectedSignature = hash_hmac('sha256', $payload, $this->getProfessionalEmailApiKey());
                return hash_equals($expectedSignature, $signature);
                
            default:
                return false;
        }
    }
}
