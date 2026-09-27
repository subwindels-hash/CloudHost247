<?php
/**
 * REST API Router
 * Handles internal REST API routing for module services
 */

namespace PhoneServices\Core;

use PhoneServices\API\Controllers\NumbersController;
use PhoneServices\API\Controllers\VoipController;
use PhoneServices\API\Controllers\SmsController;
use PhoneServices\API\Controllers\EsimController;
use PhoneServices\API\Controllers\UsageController;
use PhoneServices\API\Middleware\AuthMiddleware;

class Router
{
    private $routes = [];
    private $middleware = [];
    
    public function __construct()
    {
        $this->registerDefaultRoutes();
    }
    
    /**
     * Register default REST API routes
     */
    private function registerDefaultRoutes()
    {
        // Numbers API
        $this->addRoute('GET', '/api/numbers', [NumbersController::class, 'index']);
        $this->addRoute('POST', '/api/numbers/purchase', [NumbersController::class, 'purchase']);
        $this->addRoute('POST', '/api/numbers/:id/renew', [NumbersController::class, 'renew']);
        $this->addRoute('POST', '/api/numbers/:id/suspend', [NumbersController::class, 'suspend']);
        $this->addRoute('POST', '/api/numbers/:id/release', [NumbersController::class, 'release']);
        
        // VoIP API
        $this->addRoute('GET', '/api/voip/calls', [VoipController::class, 'calls']);
        $this->addRoute('POST', '/api/voip/call', [VoipController::class, 'initiateCall']);
        $this->addRoute('POST', '/api/voip/call/:id/end', [VoipController::class, 'endCall']);
        $this->addRoute('GET', '/api/voip/token', [VoipController::class, 'getToken']);
        
        // SMS API
        $this->addRoute('GET', '/api/sms/messages', [SmsController::class, 'messages']);
        $this->addRoute('POST', '/api/sms/send', [SmsController::class, 'send']);
        $this->addRoute('POST', '/api/sms/otp', [SmsController::class, 'sendOtp']);
        $this->addRoute('POST', '/api/sms/whatsapp', [SmsController::class, 'sendWhatsapp']);
        $this->addRoute('POST', '/api/sms/email', [SmsController::class, 'sendEmail']);
        
        // eSIM API
        $this->addRoute('GET', '/api/esim/profiles', [EsimController::class, 'profiles']);
        $this->addRoute('POST', '/api/esim/purchase', [EsimController::class, 'purchase']);
        $this->addRoute('GET', '/api/esim/:id/qrcode', [EsimController::class, 'qrCode']);
        $this->addRoute('GET', '/api/esim/plans', [EsimController::class, 'plans']);
        
        // Usage API
        $this->addRoute('GET', '/api/usage', [UsageController::class, 'index']);
        $this->addRoute('GET', '/api/usage/transactions', [UsageController::class, 'transactions']);
        $this->addRoute('GET', '/api/usage/report', [UsageController::class, 'report']);
    }
    
    /**
     * Add a route
     */
    public function addRoute($method, $path, $handler)
    {
        $this->routes[] = [
            'method' => strtoupper($method),
            'path' => $path,
            'handler' => $handler,
        ];
    }
    
    /**
     * Add middleware
     */
    public function addMiddleware($middleware)
    {
        $this->middleware[] = $middleware;
    }
    
    /**
     * Dispatch the current request
     */
    public function dispatch()
    {
        $method = $_SERVER['REQUEST_METHOD'];
        $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
        $path = str_replace('/modules/addons/phoneservices/', '/', $path);
        
        // Run middleware
        foreach ($this->middleware as $mw) {
            if (is_string($mw) && class_exists($mw)) {
                $instance = new $mw();
                if (method_exists($instance, 'handle')) {
                    $instance->handle();
                }
            }
        }
        
        $route = $this->matchRoute($method, $path);
        
        if (!$route) {
            $this->jsonResponse(['error' => 'Route not found'], 404);
            return;
        }
        
        try {
            $handler = $route['handler'];
            $params = $route['params'];
            
            $class = $handler[0];
            $method = $handler[1];
            $controller = new $class();
            
            $response = call_user_func_array([$controller, $method], [$params]);
            
            if (is_array($response) || is_object($response)) {
                $this->jsonResponse($response);
            } else {
                echo $response;
            }
        } catch (\Exception $e) {
            Logger::error('API Error: ' . $e->getMessage(), ['route' => $path]);
            $this->jsonResponse(['error' => 'Internal server error', 'message' => $e->getMessage()], 500);
        }
    }
    
    /**
     * Match route against registered routes
     */
    private function matchRoute($method, $path)
    {
        foreach ($this->routes as $route) {
            if ($route['method'] !== strtoupper($method)) {
                continue;
            }
            
            $pattern = preg_replace('/:([a-zA-Z0-9_]+)/', '([^/]+)', $route['path']);
            $pattern = '#^' . $pattern . '$#';
            
            if (preg_match($pattern, $path, $matches)) {
                $params = [];
                preg_match_all('/:([a-zA-Z0-9_]+)/', $route['path'], $keys);
                
                for ($i = 0; $i < count($keys[1]); $i++) {
                    $params[$keys[1][$i]] = $matches[$i + 1];
                }
                
                return ['handler' => $route['handler'], 'params' => $params];
            }
        }
        
        return null;
    }
    
    /**
     * Send JSON response
     */
    public function jsonResponse($data, $status = 200)
    {
        http_response_code($status);
        header('Content-Type: application/json');
        echo json_encode($data);
        exit;
    }
}
