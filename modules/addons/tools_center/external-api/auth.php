<?php
/**
 * API Authentication Handler
 * Token-based authentication between WHMCS and Tools API
 */

class APIAuth {
    private $config;
    private $clientId = 0;
    
    public function __construct($config) {
        $this->config = $config;
    }
    
    /**
     * Validate API request authentication
     * Supports: X-API-Token header, Authorization Bearer token, or POST token
     */
    public function validateRequest() {
        $token = $this->getToken();
        
        if (empty($token)) {
            return false;
        }
        
        // Simple token validation (implement your own logic)
        $validToken = $this->config['api_token'];
        
        if ($token === $validToken) {
            $this->clientId = $this->getClientIdFromToken($token);
            return true;
        }
        
        // HMAC validation for advanced security
        if ($this->validateHmac($token)) {
            return true;
        }
        
        return false;
    }
    
    /**
     * Extract token from request
     */
    private function getToken() {
        // Check X-API-Token header
        $headers = $this->getAllHeaders();
        if (isset($headers['X-Api-Token'])) {
            return $headers['X-Api-Token'];
        }
        
        // Check Authorization Bearer header
        if (isset($headers['Authorization'])) {
            $auth = $headers['Authorization'];
            if (strpos($auth, 'Bearer ') === 0) {
                return substr($auth, 7);
            }
        }
        
        // Check POST/GET token
        if (isset($_REQUEST['api_token'])) {
            return $_REQUEST['api_token'];
        }
        
        return null;
    }
    
    /**
     * Get all request headers
     */
    private function getAllHeaders() {
        if (function_exists('getallheaders')) {
            return getallheaders();
        }
        
        $headers = [];
        foreach ($_SERVER as $name => $value) {
            if (substr($name, 0, 5) === 'HTTP_') {
                $headerName = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($name, 5)))));
                $headers[$headerName] = $value;
            }
        }
        return $headers;
    }
    
    /**
     * HMAC validation for enhanced security
     */
    private function validateHmac($token) {
        $parts = explode('.', $token);
        if (count($parts) !== 2) {
            return false;
        }
        
        $payload = base64_decode($parts[0]);
        $signature = $parts[1];
        
        $expected = hash_hmac('sha256', $payload, $this->config['api_secret']);
        
        return hash_equals($expected, $signature);
    }
    
    /**
     * Extract client ID from token
     */
    private function getClientIdFromToken($token) {
        // Decode token payload if JWT-style
        $parts = explode('.', $token);
        if (count($parts) >= 1) {
            $payload = json_decode(base64_decode($parts[0]), true);
            if ($payload && isset($payload['client_id'])) {
                return (int)$payload['client_id'];
            }
        }
        
        return 0;
    }
    
    /**
     * Get authenticated client ID
     */
    public function getClientId() {
        return $this->clientId;
    }
    
    /**
     * Generate API token for WHMCS integration
     */
    public static function generateToken($clientId, $apiSecret) {
        $payload = json_encode([
            'client_id' => $clientId,
            'timestamp' => time(),
            'nonce' => bin2hex(random_bytes(16))
        ]);
        
        $base64Payload = base64_encode($payload);
        $signature = hash_hmac('sha256', $payload, $apiSecret);
        
        return $base64Payload . '.' . $signature;
    }
}