<?php
/**
 * REST API authentication.
 *
 * Three authentication modes, checked in order:
 *   1. WHMCS client session  - used by the client-area SPA (same-origin).
 *   2. `Authorization: ApiKey <key_id>.<secret>` - per-client credentials,
 *      stored as SHA-256 hashes with scopes, expiry and revocation.
 *   3. `Authorization: Bearer <jwt>` - short-lived HS256 tokens minted by the
 *      platform itself (no third-party JWT library required).
 *
 * The authenticated principal is exposed through getContext() so controllers
 * can enforce per-client ownership.
 *
 * @package PhoneServices
 */

namespace PhoneServices\API\Middleware;

use PhoneServices\Core\Config;
use PhoneServices\Core\Crypto;
use PhoneServices\Core\Database;
use PhoneServices\Core\Logger;
use PhoneServices\Core\Security;

class AuthMiddleware
{
    const API_KEY_TABLE = 'mod_phoneservices_api_keys';

    /** @var array<string,mixed> */
    private static $context = ['authenticated' => false, 'user_id' => 0, 'scopes' => [], 'method' => null];

    /**
     * Authenticate the current request or terminate with 401/403.
     *
     * @param string $requiredScope Scope the endpoint needs (numbers, voip...)
     */
    public function handle(string $requiredScope = ''): array
    {
        $path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);

        // Provider webhooks authenticate themselves by signature.
        if (strpos($path, 'webhooks') !== false) {
            return self::$context = ['authenticated' => true, 'user_id' => 0, 'scopes' => ['*'], 'method' => 'webhook'];
        }

        $clientId = Security::currentClientId();
        if ($clientId > 0) {
            return $this->grant($clientId, ['*'], 'session', $requiredScope);
        }

        $authHeader = $this->authorizationHeader();

        if ($authHeader !== '') {
            if (stripos($authHeader, 'ApiKey ') === 0) {
                $context = $this->authenticateApiKey(trim(substr($authHeader, 7)));
                if ($context) {
                    return $this->grant($context['user_id'], $context['scopes'], 'apikey', $requiredScope);
                }
            }

            if (stripos($authHeader, 'Bearer ') === 0) {
                $context = $this->authenticateBearer(trim(substr($authHeader, 7)));
                if ($context) {
                    return $this->grant($context['user_id'], $context['scopes'], 'jwt', $requiredScope);
                }
            }
        }

        $this->deny(401, 'Unauthorized');

        return self::$context; // unreachable (deny exits)
    }

    /**
     * Authenticated principal for the current request.
     *
     * @return array<string,mixed>
     */
    public static function getContext(): array
    {
        return self::$context;
    }

    public static function userId(): int
    {
        return (int) (self::$context['user_id'] ?? 0);
    }

    /* ------------------------------------------------------------------
     | API keys
     * ----------------------------------------------------------------- */

    /**
     * Issue a new API key. The plaintext secret is returned exactly once.
     *
     * @return array{key_id:string,secret:string,api_key:string}
     */
    public static function issueApiKey(int $userId, string $label = 'default', array $scopes = [], ?string $expiresAt = null): array
    {
        $keyId = 'ps_' . bin2hex(random_bytes(8));
        $secret = Crypto::randomToken(32);

        Database::insert(self::API_KEY_TABLE, [
            'user_id'    => $userId,
            'label'      => Security::text($label, 100),
            'key_id'     => $keyId,
            'key_hash'   => hash('sha256', $secret),
            'scopes'     => $scopes ? implode(',', $scopes) : 'numbers,voip,sms,esim,usage',
            'status'     => 'active',
            'expires_at' => $expiresAt,
            'created_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        ]);

        Logger::info('API key issued', ['user' => $userId, 'key_id' => $keyId]);

        return ['key_id' => $keyId, 'secret' => $secret, 'api_key' => $keyId . '.' . $secret];
    }

    public static function revokeApiKey(string $keyId): bool
    {
        $updated = Database::update(self::API_KEY_TABLE, [
            'status'     => 'revoked',
            'updated_at' => date('Y-m-d H:i:s'),
        ], ['key_id' => $keyId]);

        if ($updated) {
            Logger::info('API key revoked', ['key_id' => $keyId]);
        }

        return $updated > 0;
    }

    /**
     * @return array{user_id:int,scopes:string[]}|null
     */
    private function authenticateApiKey(string $presented): ?array
    {
        if (strpos($presented, '.') === false) {
            return null;
        }

        [$keyId, $secret] = explode('.', $presented, 2);

        $record = Database::row(self::API_KEY_TABLE, '*', ['key_id' => $keyId, 'status' => 'active']);

        if (!$record) {
            Logger::warning('API authentication failed: unknown key', ['key_id' => $keyId]);
            return null;
        }

        if (!empty($record['expires_at']) && strtotime((string) $record['expires_at']) < time()) {
            Logger::warning('API authentication failed: key expired', ['key_id' => $keyId]);
            return null;
        }

        if (!Crypto::secureCompare((string) $record['key_hash'], hash('sha256', $secret))) {
            Logger::warning('API authentication failed: bad secret', ['key_id' => $keyId]);
            return null;
        }

        Database::update(self::API_KEY_TABLE, [
            'last_used_at' => date('Y-m-d H:i:s'),
            'last_used_ip' => substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45),
        ], ['id' => (int) $record['id']]);

        return [
            'user_id' => (int) $record['user_id'],
            'scopes'  => array_filter(array_map('trim', explode(',', (string) $record['scopes']))),
        ];
    }

    /* ------------------------------------------------------------------
     | Bearer tokens (self-issued HS256 JWT)
     * ----------------------------------------------------------------- */

    /**
     * Mint a short-lived bearer token for a client (used by the client-area
     * JavaScript so browser calls never carry a long-lived API key).
     */
    public static function issueBearerToken(int $userId, int $ttl = 3600, array $scopes = ['*']): string
    {
        $secret = self::jwtSecret();
        $now = time();

        $header = ['typ' => 'JWT', 'alg' => 'HS256'];
        $payload = [
            'iss'    => 'phoneservices',
            'sub'    => $userId,
            'scopes' => $scopes,
            'iat'    => $now,
            'exp'    => $now + max(60, min($ttl, 86400)),
            'jti'    => bin2hex(random_bytes(8)),
        ];

        $segments = [
            self::b64(json_encode($header)),
            self::b64(json_encode($payload)),
        ];
        $segments[] = self::b64(hash_hmac('sha256', implode('.', $segments), $secret, true));

        return implode('.', $segments);
    }

    /**
     * @return array{user_id:int,scopes:string[]}|null
     */
    private function authenticateBearer(string $token): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }

        [$header, $payload, $signature] = $parts;
        $expected = self::b64(hash_hmac('sha256', $header . '.' . $payload, self::jwtSecret(), true));

        if (!Crypto::secureCompare($expected, $signature)) {
            Logger::warning('API authentication failed: bad token signature');
            return null;
        }

        $claims = json_decode(self::b64decode($payload), true);

        if (!is_array($claims) || empty($claims['sub'])) {
            return null;
        }

        if (isset($claims['exp']) && (int) $claims['exp'] < time()) {
            Logger::warning('API authentication failed: token expired');
            return null;
        }

        return [
            'user_id' => (int) $claims['sub'],
            'scopes'  => (array) ($claims['scopes'] ?? ['*']),
        ];
    }

    /**
     * HMAC secret for self-issued tokens; generated on first use.
     */
    private static function jwtSecret(): string
    {
        $secret = (string) Config::get('jwt_secret', '');

        if ($secret === '') {
            $secret = Crypto::randomToken(48);
            Config::set('jwt_secret', $secret);
        }

        return $secret;
    }

    /* ------------------------------------------------------------------ */

    /**
     * @param string[] $scopes
     * @return array<string,mixed>
     */
    private function grant(int $userId, array $scopes, string $method, string $requiredScope): array
    {
        if ($requiredScope !== '' && !in_array('*', $scopes, true) && !in_array($requiredScope, $scopes, true)) {
            $this->deny(403, 'Insufficient scope for ' . $requiredScope);
        }

        return self::$context = [
            'authenticated' => true,
            'user_id'       => $userId,
            'scopes'        => $scopes,
            'method'        => $method,
        ];
    }

    private function deny(int $status, string $message): void
    {
        http_response_code($status);
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'error' => $message]);
        exit;
    }

    private function authorizationHeader(): string
    {
        if (function_exists('getallheaders')) {
            $headers = array_change_key_case((array) getallheaders(), CASE_LOWER);
            if (!empty($headers['authorization'])) {
                return (string) $headers['authorization'];
            }
        }

        return (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? ''));
    }

    private static function b64(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function b64decode(string $data): string
    {
        return (string) base64_decode(strtr($data, '-_', '+/'), true);
    }
}
