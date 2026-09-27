<?php
/**
 * API Authentication Middleware
 * Validates JWT or session tokens for REST API requests
 */

namespace PhoneServices\API\Middleware;

use PhoneServices\Core\Logger;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;

class AuthMiddleware
{
    /**
     * Handle authentication
     */
    public function handle()
    {
        $headers = getallheaders();
        $authHeader = $headers['Authorization'] ?? '';
        
        // Skip auth for public webhooks
        $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
        if (strpos($path, 'webhooks') !== false) {
            return;
        }
        
        // Check WHMCS session auth for browser requests
        if (isset($_SESSION['uid']) && $_SESSION['uid'] > 0) {
            return;
        }
        
        // Check API key / JWT for programmatic requests
        if (!empty($authHeader)) {
            if (strpos($authHeader, 'Bearer ') === 0) {
                $token = substr($authHeader, 7);
                if ($this->validateJwt($token)) {
                    return;
                }
            }
            
            if (strpos($authHeader, 'ApiKey ') === 0) {
                $apiKey = substr($authHeader, 7);
                if ($this->validateApiKey($apiKey)) {
                    return;
                }
            }
        }
        
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }
    
    /**
     * Validate JWT token
     */
    private function validateJwt(string $token): bool
    {
        try {
            $secret = \PhoneServices\Core\Config::get('jwt_secret', '');
            if (empty($secret)) {
                return false;
            }
            
            $decoded = JWT::decode($token, new Key($secret, 'HS256'));
            if (isset($decoded->sub)) {
                $_SESSION['api_user_id'] = $decoded->sub;
                return true;
            }
        } catch (\Exception $e) {
            Logger::error('JWT validation failed', ['error' => $e->getMessage()]);
        }
        return false;
    }
    
    /**
     * Validate API key
     */
    private function validateApiKey(string $apiKey): bool
    {
        // In production, validate against stored API keys
        $validKey = \PhoneServices\Core\Config::get('api_key', '');
        return !empty($validKey) && hash_equals($validKey, $apiKey);
    }
}
