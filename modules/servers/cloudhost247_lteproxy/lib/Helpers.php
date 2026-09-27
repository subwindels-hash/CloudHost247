<?php

declare(strict_types=1);

namespace CloudHost247\LTEProxy;

/**
 * CloudHost247 LTE Proxy Helper Functions
 *
 * Utility functions used throughout the module.
 *
 * @package CloudHost247\LTEProxy
 * @version 1.0.0
 */
class Helpers
{
    /** @var array Valid proxy types */
    private const VALID_PROXY_TYPES = ['SOCKS5', 'HTTPS', 'HTTP'];

    /** @var array Valid rotation types */
    private const VALID_ROTATION_TYPES = ['manual', 'timed', 'per_request', 'off'];

    /** @var array Valid auth types */
    private const VALID_AUTH_TYPES = ['ip_whitelist', 'username_password', 'both'];

    /** @var array Valid connection types */
    private const VALID_CONNECTION_TYPES = ['WIFI', 'CELLULAR', 'WIFI_AND_CELLULAR'];

    /** @var array US carriers */
    private const US_CARRIERS = [
        'verizon' => 'Verizon',
        'att' => 'AT&T',
        'tmobile' => 'T-Mobile',
        'sprint' => 'Sprint',
        'us_cellular' => 'US Cellular',
    ];

    /** @var array Available regions */
    private const REGIONS = [
        'us' => 'United States',
        'us_east' => 'US East Coast',
        'us_west' => 'US West Coast',
        'us_central' => 'US Central',
        'ca' => 'Canada',
        'uk' => 'United Kingdom',
        'de' => 'Germany',
        'fr' => 'France',
        'nl' => 'Netherlands',
    ];

    /**
     * Sanitize string input
     *
     * @param string $input Raw input
     * @return string Sanitized string
     */
    public static function sanitizeString(string $input): string
    {
        $input = trim($input);
        $input = strip_tags($input);
        $input = htmlspecialchars($input, ENT_QUOTES, 'UTF-8');

        return $input;
    }

    /**
     * Validate IP address
     *
     * @param string $ip IP address to validate
     * @return bool
     */
    public static function isValidIp(string $ip): bool
    {
        return filter_var($ip, FILTER_VALIDATE_IP) !== false;
    }

    /**
     * Validate CIDR range
     *
     * @param string $cidr CIDR notation
     * @return bool
     */
    public static function isValidCidr(string $cidr): bool
    {
        $parts = explode('/', $cidr);

        if (count($parts) !== 2) {
            return false;
        }

        if (!self::isValidIp($parts[0])) {
            return false;
        }

        $prefix = (int) $parts[1];

        return $prefix >= 0 && $prefix <= 32;
    }

    /**
     * Validate proxy type
     *
     * @param string $type Proxy type
     * @return bool
     */
    public static function isValidProxyType(string $type): bool
    {
        return in_array(strtoupper($type), self::VALID_PROXY_TYPES, true);
    }

    /**
     * Validate rotation type
     *
     * @param string $type Rotation type
     * @return bool
     */
    public static function isValidRotationType(string $type): bool
    {
        return in_array(strtolower($type), self::VALID_ROTATION_TYPES, true);
    }

    /**
     * Validate auth type
     *
     * @param string $type Auth type
     * @return bool
     */
    public static function isValidAuthType(string $type): bool
    {
        return in_array(strtolower($type), self::VALID_AUTH_TYPES, true);
    }

    /**
     * Validate connection type
     *
     * @param string $type Connection type
     * @return bool
     */
    public static function isValidConnectionType(string $type): bool
    {
        return in_array(strtoupper($type), self::VALID_CONNECTION_TYPES, true);
    }

    /**
     * Validate region
     *
     * @param string $region Region code
     * @return bool
     */
    public static function isValidRegion(string $region): bool
    {
        return array_key_exists(strtolower($region), self::REGIONS);
    }

    /**
     * Validate carrier
     *
     * @param string $carrier Carrier code
     * @return bool
     */
    public static function isValidCarrier(string $carrier): bool
    {
        return array_key_exists(strtolower($carrier), self::US_CARRIERS);
    }

    /**
     * Get list of valid proxy types
     *
     * @return array
     */
    public static function getProxyTypes(): array
    {
        return self::VALID_PROXY_TYPES;
    }

    /**
     * Get list of rotation types
     *
     * @return array
     */
    public static function getRotationTypes(): array
    {
        return self::VALID_ROTATION_TYPES;
    }

    /**
     * Get list of auth types
     *
     * @return array
     */
    public static function getAuthTypes(): array
    {
        return self::VALID_AUTH_TYPES;
    }

    /**
     * Get list of connection types
     *
     * @return array
     */
    public static function getConnectionTypes(): array
    {
        return self::VALID_CONNECTION_TYPES;
    }

    /**
     * Get regions list
     *
     * @return array
     */
    public static function getRegions(): array
    {
        return self::REGIONS;
    }

    /**
     * Get US carriers list
     *
     * @return array
     */
    public static function getUsCarriers(): array
    {
        return self::US_CARRIERS;
    }

    /**
     * Get all carriers (including international)
     *
     * @return array
     */
    public static function getAllCarriers(): array
    {
        return array_merge(self::US_CARRIERS, [
            'rogers' => 'Rogers (CA)',
            'bell' => 'Bell (CA)',
            'telus' => 'Telus (CA)',
            'ee' => 'EE (UK)',
            'vodafone_uk' => 'Vodafone (UK)',
            'o2' => 'O2 (UK)',
            'telekom_de' => 'Telekom (DE)',
            'vodafone_de' => 'Vodafone (DE)',
            'orange_fr' => 'Orange (FR)',
            'sfr' => 'SFR (FR)',
            'kpn' => 'KPN (NL)',
            'vodafone_nl' => 'Vodafone (NL)',
        ]);
    }

    /**
     * Format proxy for display
     *
     * @param array $proxy Proxy data
     * @return string Formatted proxy string
     */
    public static function formatProxy(array $proxy): string
    {
        $type = strtoupper($proxy['proxy_type'] ?? 'SOCKS5');
        $host = $proxy['host'] ?? $proxy['ip'] ?? '';
        $port = $proxy['port'] ?? '';
        $username = $proxy['username'] ?? '';
        $password = $proxy['password'] ?? '';

        if (!empty($username) && !empty($password)) {
            return sprintf('%s://%s:%s@%s:%s', $type, $username, $password, $host, $port);
        }

        return sprintf('%s://%s:%s', $type, $host, $port);
    }

    /**
     * Format proxy for copy (without protocol)
     *
     * @param array $proxy Proxy data
     * @return string
     */
    public static function formatProxyForCopy(array $proxy): string
    {
        $host = $proxy['host'] ?? $proxy['ip'] ?? '';
        $port = $proxy['port'] ?? '';
        $username = $proxy['username'] ?? '';
        $password = $proxy['password'] ?? '';

        if (!empty($username) && !empty($password)) {
            return sprintf('%s:%s:%s:%s', $host, $port, $username, $password);
        }

        return sprintf('%s:%s', $host, $port);
    }

    /**
     * Format duration in human readable format
     *
     * @param int $days Number of days
     * @return string
     */
    public static function formatDuration(int $days): string
    {
        if ($days < 1) {
            return 'Invalid';
        }

        if ($days === 1) {
            return '1 day';
        }

        if ($days < 7) {
            return $days . ' days';
        }

        if ($days < 30) {
            $weeks = floor($days / 7);
            $remaining = $days % 7;

            if ($remaining === 0) {
                return $weeks === 1 ? '1 week' : $weeks . ' weeks';
            }

            return $weeks . ' week' . ($weeks > 1 ? 's' : '') . ' ' . $remaining . ' day' . ($remaining > 1 ? 's' : '');
        }

        $months = floor($days / 30);
        $remaining = $days % 30;

        if ($remaining === 0) {
            return $months === 1 ? '1 month' : $months . ' months';
        }

        return $months . ' month' . ($months > 1 ? 's' : '') . ' ' . $remaining . ' day' . ($remaining > 1 ? 's' : '');
    }

    /**
     * Format bytes to human readable
     *
     * @param int $bytes Bytes
     * @return string
     */
    public static function formatBytes(int $bytes): string
    {
        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $unitIndex = 0;

        while ($bytes >= 1024 && $unitIndex < count($units) - 1) {
            $bytes /= 1024;
            $unitIndex++;
        }

        return round($bytes, 2) . ' ' . $units[$unitIndex];
    }

    /**
     * Format speed in Mbps
     *
     * @param float $bytesPerSecond Bytes per second
     * @return string
     */
    public static function formatSpeed(float $bytesPerSecond): string
    {
        $mbps = ($bytesPerSecond * 8) / 1000000;

        if ($mbps >= 1000) {
            return round($mbps / 1000, 2) . ' Gbps';
        }

        return round($mbps, 2) . ' Mbps';
    }

    /**
     * Format date to human readable
     *
     * @param string $date Date string
     * @return string
     */
    public static function formatDate(string $date): string
    {
        $timestamp = strtotime($date);

        if ($timestamp === false) {
            return $date;
        }

        return date('M j, Y g:i A', $timestamp);
    }

    /**
     * Get relative time string
     *
     * @param string $date Date string
     * @return string
     */
    public static function getRelativeTime(string $date): string
    {
        $timestamp = strtotime($date);

        if ($timestamp === false) {
            return $date;
        }

        $diff = time() - $timestamp;

        if ($diff < 60) {
            return 'Just now';
        }

        if ($diff < 3600) {
            $mins = floor($diff / 60);
            return $mins . ' minute' . ($mins > 1 ? 's' : '') . ' ago';
        }

        if ($diff < 86400) {
            $hours = floor($diff / 3600);
            return $hours . ' hour' . ($hours > 1 ? 's' : '') . ' ago';
        }

        if ($diff < 604800) {
            $days = floor($diff / 86400);
            return $days . ' day' . ($days > 1 ? 's' : '') . ' ago';
        }

        return self::formatDate($date);
    }

    /**
     * Get time remaining until expiration
     *
     * @param string $expiresAt Expiration date
     * @return string
     */
    public static function getTimeRemaining(string $expiresAt): string
    {
        $expires = strtotime($expiresAt);

        if ($expires === false) {
            return 'Unknown';
        }

        $diff = $expires - time();

        if ($diff <= 0) {
            return 'Expired';
        }

        $days = floor($diff / 86400);
        $hours = floor(($diff % 86400) / 3600);
        $minutes = floor(($diff % 3600) / 60);

        if ($days > 0) {
            return $days . 'd ' . $hours . 'h ' . $minutes . 'm';
        }

        if ($hours > 0) {
            return $hours . 'h ' . $minutes . 'm';
        }

        return $minutes . 'm';
    }

    /**
     * Generate secure random string
     *
     * @param int $length String length
     * @return string
     */
    public static function generateRandomString(int $length = 16): string
    {
        return bin2hex(random_bytes(ceil($length / 2)));
    }

    /**
     * Hash sensitive data
     *
     * @param string $data Data to hash
     * @return string
     */
    public static function hash(string $data): string
    {
        return hash('sha256', $data);
    }

    /**
     * Mask sensitive string
     *
     * @param string $string String to mask
     * @param int $visibleChars Number of visible characters at start/end
     * @return string
     */
    public static function maskString(string $string, int $visibleChars = 4): string
    {
        $length = strlen($string);

        if ($length <= $visibleChars * 2) {
            return str_repeat('*', $length);
        }

        return substr($string, 0, $visibleChars) . str_repeat('*', $length - $visibleChars * 2) . substr($string, -$visibleChars);
    }

    /**
     * Get client IP address
     *
     * @return string
     */
    public static function getClientIp(): string
    {
        $headers = [
            'HTTP_CF_CONNECTING_IP',
            'HTTP_CLIENT_IP',
            'HTTP_X_FORWARDED_FOR',
            'HTTP_X_FORWARDED',
            'HTTP_X_CLUSTER_CLIENT_IP',
            'HTTP_FORWARDED_FOR',
            'HTTP_FORWARDED',
            'REMOTE_ADDR',
        ];

        foreach ($headers as $header) {
            if (!empty($_SERVER[$header])) {
                $ips = explode(',', $_SERVER[$header]);
                $ip = trim($ips[0]);

                if (self::isValidIp($ip) && !self::isPrivateIp($ip)) {
                    return $ip;
                }
            }
        }

        return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    }

    /**
     * Check if IP is private/reserved
     *
     * @param string $ip IP address
     * @return bool
     */
    public static function isPrivateIp(string $ip): bool
    {
        return !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
    }

    /**
     * Validate and sanitize proxy order parameters
     *
     * @param array $params Raw parameters
     * @return array Sanitized parameters
     * @throws \InvalidArgumentException
     */
    public static function sanitizeOrderParams(array $params): array
    {
        $sanitized = [];

        // Quantity
        $sanitized['quantity'] = max(1, min(1000, (int) ($params['quantity'] ?? 1)));

        // Region
        $region = strtolower($params['region'] ?? 'us');
        if (!self::isValidRegion($region)) {
            throw new \InvalidArgumentException('Invalid region selected');
        }
        $sanitized['region'] = $region;

        // Carrier
        $carrier = strtolower($params['carrier'] ?? 'verizon');
        if (!self::isValidCarrier($carrier)) {
            throw new \InvalidArgumentException('Invalid carrier selected');
        }
        $sanitized['carrier'] = $carrier;

        // Proxy type
        $proxyType = strtoupper($params['proxy_type'] ?? 'SOCKS5');
        if (!self::isValidProxyType($proxyType)) {
            throw new \InvalidArgumentException('Invalid proxy type');
        }
        $sanitized['proxy_type'] = $proxyType;

        // Duration
        $sanitized['duration'] = max(1, min(365, (int) ($params['duration'] ?? 30)));

        // Connection type
        $connectionType = strtoupper($params['connection_type'] ?? 'WIFI_AND_CELLULAR');
        if (!self::isValidConnectionType($connectionType)) {
            $connectionType = 'WIFI_AND_CELLULAR';
        }
        $sanitized['connection_type'] = $connectionType;

        // Rotation
        $rotation = strtolower($params['rotation'] ?? 'manual');
        if (!self::isValidRotationType($rotation)) {
            $rotation = 'manual';
        }
        $sanitized['rotation'] = $rotation;

        // Auth type
        $authType = strtolower($params['auth_type'] ?? 'username_password');
        if (!self::isValidAuthType($authType)) {
            $authType = 'username_password';
        }
        $sanitized['auth_type'] = $authType;

        // IP whitelist (if applicable)
        if (in_array($authType, ['ip_whitelist', 'both'], true)) {
            $clientIp = $params['client_ip'] ?? self::getClientIp();
            if (!self::isValidIp($clientIp)) {
                throw new \InvalidArgumentException('Invalid client IP address');
            }
            $sanitized['client_ip'] = $clientIp;
        }

        // Optional notes
        if (!empty($params['notes'])) {
            $sanitized['notes'] = self::sanitizeString($params['notes']);
        }

        return $sanitized;
    }

    /**
     * Build CSRF token
     *
     * @return string
     */
    public static function generateCsrfToken(): string
    {
        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = self::generateRandomString(32);
        }

        return $_SESSION['csrf_token'];
    }

    /**
     * Validate CSRF token
     *
     * @param string $token Token to validate
     * @return bool
     */
    public static function validateCsrfToken(string $token): bool
    {
        return isset($_SESSION['csrf_token']) && hash_equals($_SESSION['csrf_token'], $token);
    }

    /**
     * Send JSON response
     *
     * @param array $data Response data
     * @param int $status HTTP status code
     * @return void
     */
    public static function jsonResponse(array $data, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');

        echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        exit;
    }

    /**
     * Send error JSON response
     *
     * @param string $message Error message
     * @param int $status HTTP status code
     * @param array $extra Additional data
     * @return void
     */
    public static function jsonError(string $message, int $status = 400, array $extra = []): void
    {
        $response = array_merge([
            'success' => false,
            'error' => $message,
            'timestamp' => date('c'),
        ], $extra);

        self::jsonResponse($response, $status);
    }

    /**
     * Send success JSON response
     *
     * @param array $data Response data
     * @return void
     */
    public static function jsonSuccess(array $data = []): void
    {
        $response = array_merge([
            'success' => true,
            'timestamp' => date('c'),
        ], $data);

        self::jsonResponse($response, 200);
    }
}
