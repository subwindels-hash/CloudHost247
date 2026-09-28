<?php
/**
 * REST API router.
 *
 * Maps HTTP verb + path to a controller action, applies middleware (with the
 * scope the route requires) and normalises every response envelope.
 *
 * @package PhoneServices
 */

namespace PhoneServices\Core;

use PhoneServices\API\Controllers\EsimController;
use PhoneServices\API\Controllers\NumbersController;
use PhoneServices\API\Controllers\SmsController;
use PhoneServices\API\Controllers\UsageController;
use PhoneServices\API\Controllers\VoipController;

class Router
{
    /** @var array<int,array<string,mixed>> */
    private $routes = [];

    /** @var array<int,string> */
    private $middleware = [];

    public function __construct()
    {
        $this->registerDefaultRoutes();
    }

    private function registerDefaultRoutes(): void
    {
        // Service discovery / health
        $this->addRoute('GET', '/api/health', [UsageController::class, 'health'], '');

        // Numbers
        $this->addRoute('GET', '/api/numbers', [NumbersController::class, 'index'], 'numbers');
        $this->addRoute('GET', '/api/numbers/search', [NumbersController::class, 'search'], 'numbers');
        $this->addRoute('GET', '/api/numbers/countries', [NumbersController::class, 'countries'], 'numbers');
        $this->addRoute('POST', '/api/numbers/purchase', [NumbersController::class, 'purchase'], 'numbers');
        $this->addRoute('POST', '/api/numbers/:id/renew', [NumbersController::class, 'renew'], 'numbers');
        $this->addRoute('POST', '/api/numbers/:id/suspend', [NumbersController::class, 'suspend'], 'numbers');
        $this->addRoute('POST', '/api/numbers/:id/release', [NumbersController::class, 'release'], 'numbers');
        $this->addRoute('POST', '/api/numbers/:id/assign', [NumbersController::class, 'assign'], 'numbers');

        // VoIP
        $this->addRoute('GET', '/api/voip/calls', [VoipController::class, 'calls'], 'voip');
        $this->addRoute('POST', '/api/voip/call', [VoipController::class, 'initiateCall'], 'voip');
        $this->addRoute('POST', '/api/voip/call/:id/end', [VoipController::class, 'endCall'], 'voip');
        $this->addRoute('GET', '/api/voip/token', [VoipController::class, 'getToken'], 'voip');

        // Messaging
        $this->addRoute('GET', '/api/sms/messages', [SmsController::class, 'messages'], 'sms');
        $this->addRoute('POST', '/api/sms/send', [SmsController::class, 'send'], 'sms');
        $this->addRoute('POST', '/api/sms/otp', [SmsController::class, 'sendOtp'], 'sms');
        $this->addRoute('POST', '/api/sms/otp/verify', [SmsController::class, 'verifyOtp'], 'sms');
        $this->addRoute('POST', '/api/sms/whatsapp', [SmsController::class, 'sendWhatsapp'], 'sms');
        $this->addRoute('POST', '/api/sms/email', [SmsController::class, 'sendEmail'], 'sms');

        // eSIM
        $this->addRoute('GET', '/api/esim/plans', [EsimController::class, 'plans'], 'esim');
        $this->addRoute('GET', '/api/esim/profiles', [EsimController::class, 'profiles'], 'esim');
        $this->addRoute('POST', '/api/esim/purchase', [EsimController::class, 'purchase'], 'esim');
        $this->addRoute('GET', '/api/esim/:id/qrcode', [EsimController::class, 'qrCode'], 'esim');
        $this->addRoute('GET', '/api/esim/:id/usage', [EsimController::class, 'usage'], 'esim');
        $this->addRoute('POST', '/api/esim/:id/topup', [EsimController::class, 'topUp'], 'esim');

        // Usage & billing
        $this->addRoute('GET', '/api/usage', [UsageController::class, 'index'], 'usage');
        $this->addRoute('GET', '/api/usage/transactions', [UsageController::class, 'transactions'], 'usage');
        $this->addRoute('GET', '/api/usage/report', [UsageController::class, 'report'], 'usage');
    }

    /**
     * @param callable|array{0:string,1:string} $handler
     */
    public function addRoute(string $method, string $path, $handler, string $scope = ''): void
    {
        $this->routes[] = [
            'method'  => strtoupper($method),
            'path'    => $path,
            'handler' => $handler,
            'scope'   => $scope,
        ];
    }

    public function addMiddleware(string $middleware): void
    {
        $this->middleware[] = $middleware;
    }

    /**
     * Resolve and execute the current request.
     */
    public function dispatch(): void
    {
        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        $path = $this->requestPath();

        $route = $this->matchRoute($method, $path);

        if (!$route) {
            $this->jsonResponse(['success' => false, 'error' => 'Route not found', 'path' => $path], 404);
            return;
        }

        foreach ($this->middleware as $middleware) {
            if (!class_exists($middleware)) {
                continue;
            }

            $instance = new $middleware();
            if (method_exists($instance, 'handle')) {
                $instance->handle((string) $route['scope']);
            }
        }

        try {
            [$class, $action] = $route['handler'];
            $controller = new $class();
            $response = $controller->{$action}($route['params']);

            if (is_array($response)) {
                $status = isset($response['success']) && $response['success'] === false ? 400 : 200;
                $this->jsonResponse($response, (int) ($response['status_code'] ?? $status));
                return;
            }

            echo $response;
        } catch (\Throwable $e) {
            Logger::exception($e, 'API ' . $method . ' ' . $path);
            $this->jsonResponse([
                'success' => false,
                'error'   => Config::isSandbox() ? $e->getMessage() : 'Internal server error',
            ], 500);
        }
    }

    /**
     * Normalise the request path so the API works with or without URL
     * rewriting (PATH_INFO, direct script access, or a rewritten route).
     */
    public function requestPath(): string
    {
        $path = (string) ($_SERVER['PATH_INFO'] ?? '');

        if ($path === '') {
            $path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
            $path = preg_replace('#^.*/modules/addons/phoneservices(?:/api/rest\.php)?#', '', $path);
        }

        $path = '/' . trim((string) $path, '/');

        return $path === '/' ? '/api/health' : $path;
    }

    /**
     * @return array{handler:mixed,params:array<string,string>,scope:string}|null
     */
    private function matchRoute(string $method, string $path): ?array
    {
        foreach ($this->routes as $route) {
            if ($route['method'] !== $method) {
                continue;
            }

            $pattern = '#^' . preg_replace('/:([a-zA-Z0-9_]+)/', '([^/]+)', str_replace('#', '\#', $route['path'])) . '$#';

            if (!preg_match($pattern, $path, $matches)) {
                continue;
            }

            preg_match_all('/:([a-zA-Z0-9_]+)/', $route['path'], $keys);

            $params = [];
            foreach ($keys[1] as $index => $key) {
                $params[$key] = $matches[$index + 1] ?? '';
            }

            return ['handler' => $route['handler'], 'params' => $params, 'scope' => (string) $route['scope']];
        }

        return null;
    }

    /**
     * @param array<string,mixed> $data
     */
    public function jsonResponse(array $data, int $status = 200): void
    {
        unset($data['status_code']);

        http_response_code($status);
        header('Content-Type: application/json');
        echo json_encode($data);
        exit;
    }

    /**
     * Exposed for documentation/tests.
     *
     * @return array<int,array<string,string>>
     */
    public function listRoutes(): array
    {
        return array_map(static function (array $route) {
            return [
                'method' => $route['method'],
                'path'   => $route['path'],
                'scope'  => (string) $route['scope'],
            ];
        }, $this->routes);
    }
}
