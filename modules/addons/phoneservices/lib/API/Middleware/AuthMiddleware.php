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
        
        // Session requests are same-origin and state-changing calls require WHMCS CSRF.
        if (isset($_SESSION['uid']) && (int) $_SESSION['uid'] > 0) {
            if (in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
                $csrf = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['token'] ?? '');
                $sessionToken = $_SESSION['token'] ?? '';
                if (!$csrf || !$sessionToken || !hash_equals((string) $sessionToken, (string) $csrf)) {
                    $this->deny(403, 'Invalid CSRF token');
                }
            }
            $_SESSION['phoneservices_auth_type'] = 'session';
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
        
        $this->deny(401, 'Unauthorized');
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
            if (isset($decoded->sub) && (int) $decoded->sub > 0 && isset($decoded->exp) && (int) $decoded->exp >= time()) {
                $_SESSION['api_user_id'] = (int) $decoded->sub;
                $_SESSION['phoneservices_auth_type'] = 'jwt';
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
        $userId = (int) \PhoneServices\Core\Config::get('api_user_id', 0);
        if (!empty($validKey) && $userId > 0 && hash_equals((string) $validKey, $apiKey)) {
            $_SESSION['api_user_id'] = $userId;
            $_SESSION['phoneservices_auth_type'] = 'api_key';
            return true;
        }
        return false;
    }

    private function deny(int $status, string $message): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success' => false, 'error' => $message]);
        exit;
    }
}
