<?php
/**
 * Shared bootstrap for the public HTTP entry points (REST API + webhooks).
 *
 * Boots WHMCS (for the database connection and session) and the module
 * autoloader, then exposes small helpers used by every endpoint.
 *
 * @package PhoneServices
 */

if (!defined('PHONESERVICES_API_BOOTSTRAPPED')) {
    define('PHONESERVICES_API_BOOTSTRAPPED', true);

    $whmcsRoot = null;
    $directory = __DIR__;

    // Walk up to locate the WHMCS installation root (init.php).
    for ($i = 0; $i < 6; $i++) {
        $directory = dirname($directory);
        if (is_file($directory . '/init.php')) {
            $whmcsRoot = $directory;
            break;
        }
    }

    if ($whmcsRoot === null) {
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'error' => 'WHMCS bootstrap not found']);
        exit;
    }

    require_once $whmcsRoot . '/init.php';
    require_once dirname(__DIR__) . '/bootstrap.php';
}

if (!function_exists('phoneservices_api_raw_body')) {
    /**
     * Raw request body (cached so it can be read more than once).
     */
    function phoneservices_api_raw_body(): string
    {
        static $body;

        if ($body === null) {
            $body = (string) file_get_contents('php://input');
        }

        return $body;
    }
}

if (!function_exists('phoneservices_api_headers')) {
    /**
     * Request headers, lower-cased keys.
     *
     * @return array<string,string>
     */
    function phoneservices_api_headers(): array
    {
        if (function_exists('getallheaders')) {
            return array_change_key_case((array) getallheaders(), CASE_LOWER);
        }

        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (strpos($key, 'HTTP_') === 0) {
                $name = strtolower(str_replace('_', '-', substr($key, 5)));
                $headers[$name] = (string) $value;
            }
        }

        return $headers;
    }
}

if (!function_exists('phoneservices_api_current_url')) {
    /**
     * Absolute URL of the current request - required to verify Twilio
     * signatures, which are computed over the full callback URL.
     */
    function phoneservices_api_current_url(): string
    {
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');

        $host = (string) ($_SERVER['HTTP_X_FORWARDED_HOST'] ?? ($_SERVER['HTTP_HOST'] ?? 'localhost'));

        return ($https ? 'https://' : 'http://') . $host . (string) ($_SERVER['REQUEST_URI'] ?? '');
    }
}

if (!function_exists('phoneservices_api_json')) {
    /**
     * Emit a JSON response and stop.
     *
     * @param array<string,mixed> $payload
     */
    function phoneservices_api_json(array $payload, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json');
        echo json_encode($payload);
        exit;
    }
}

if (!function_exists('phoneservices_api_record_event')) {
    /**
     * Persist a provider webhook payload for audit/replay.
     *
     * @param array<string,mixed> $payload
     */
    function phoneservices_api_record_event(string $provider, string $eventType, array $payload, ?string $externalId = null): int
    {
        return \PhoneServices\Core\Database::insert('mod_phoneservices_provider_events', [
            'provider'    => $provider,
            'event_type'  => $eventType,
            'external_id' => $externalId,
            'payload'     => json_encode($payload),
            'processed'   => 1,
            'processed_at' => date('Y-m-d H:i:s'),
            'created_at'  => date('Y-m-d H:i:s'),
        ]);
    }
}
