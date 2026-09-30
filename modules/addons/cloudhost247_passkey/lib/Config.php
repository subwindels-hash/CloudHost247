<?php
/**
 * WebAuthn relying-party configuration resolution (spec §16, §17, §36).
 *
 * The relying-party configuration is explicit: RP ID, RP name and the list of
 * allowed origins all come from the addon settings. Nothing is guessed from
 * the request, because trusting the Host header would let an attacker who can
 * reach the endpoint through another hostname mint credentials for it.
 *
 * Every failure path here is fail-closed: the ceremony is refused with
 * CONFIGURATION_REQUIRED, never downgraded.
 */

namespace CloudHost247\Passkey;

final class Config
{
    /**
     * @return array{rpId:string,rpName:string,origins:string[],environment:string}
     * @throws ConfigurationException when the deployment cannot run WebAuthn safely
     */
    public static function relyingParty()
    {
        $rpId = (string) SettingsRepository::get('rp_id', '');
        $origins = self::origins();
        $environment = (string) SettingsRepository::get('environment', 'production');

        if ($rpId === '') {
            throw new ConfigurationException('The WebAuthn RP ID has not been configured.');
        }
        if (self::normaliseRpId($rpId) !== $rpId) {
            throw new ConfigurationException('The configured WebAuthn RP ID is not a valid domain.');
        }
        if (!$origins) {
            throw new ConfigurationException('No allowed WebAuthn origin has been configured.');
        }

        $requireHttps = SettingsRepository::bool('require_https') || $environment === 'production';
        foreach ($origins as $origin) {
            $parts = parse_url($origin);
            if (!$parts || empty($parts['scheme']) || empty($parts['host'])) {
                throw new ConfigurationException('An allowed WebAuthn origin is not a valid absolute URL.');
            }
            $isLocal = in_array($parts['host'], array('localhost', '127.0.0.1'), true);
            if ($requireHttps && $parts['scheme'] !== 'https' && !($isLocal && $environment !== 'production')) {
                throw new ConfigurationException('WebAuthn origins must use HTTPS in this environment.');
            }
            // The RP ID must be the origin's host or a registrable suffix of it.
            $host = strtolower($parts['host']);
            if ($host !== $rpId && substr($host, -strlen('.' . $rpId)) !== '.' . $rpId) {
                throw new ConfigurationException('An allowed origin does not belong to the configured RP ID.');
            }
        }

        return array(
            'rpId' => $rpId,
            'rpName' => (string) (SettingsRepository::get('rp_name', '') ?: 'CloudHost247'),
            'origins' => $origins,
            'environment' => $environment,
        );
    }

    /** True when WebAuthn is enabled *and* correctly configured. */
    public static function isOperational()
    {
        if (!SettingsRepository::bool('enabled')) {
            return false;
        }
        try {
            self::relyingParty();
            return true;
        } catch (ConfigurationException $e) {
            return false;
        }
    }

    /**
     * Human-readable diagnostics for the admin "Diagnostics" tab. Never throws
     * so the page always renders, even on a broken deployment.
     */
    public static function diagnostics()
    {
        $checks = array();
        $checks[] = array(
            'name' => 'Addon enabled',
            'ok' => SettingsRepository::bool('enabled'),
            'detail' => SettingsRepository::bool('enabled') ? 'Passkey authentication is enabled.' : 'The addon is disabled in settings.',
        );
        try {
            $rp = self::relyingParty();
            $checks[] = array('name' => 'Relying party', 'ok' => true, 'detail' => 'RP ID ' . $rp['rpId'] . ' with ' . count($rp['origins']) . ' allowed origin(s).');
        } catch (ConfigurationException $e) {
            $checks[] = array('name' => 'Relying party', 'ok' => false, 'detail' => 'CONFIGURATION_REQUIRED — ' . $e->getMessage());
        }
        $checks[] = array(
            'name' => 'OpenSSL signature verification',
            'ok' => function_exists('openssl_verify'),
            'detail' => function_exists('openssl_verify') ? 'PHP OpenSSL extension available.' : 'SERVICE_UNAVAILABLE — the OpenSSL extension is required.',
        );
        $checks[] = array(
            'name' => 'CSPRNG',
            'ok' => function_exists('random_bytes'),
            'detail' => function_exists('random_bytes') ? 'random_bytes() available.' : 'SERVICE_UNAVAILABLE — no cryptographic RNG.',
        );
        $secure = self::requestIsSecure();
        $checks[] = array(
            'name' => 'Current request is a secure context',
            'ok' => $secure,
            'detail' => $secure ? 'HTTPS (or an approved local origin).' : 'Browsers refuse WebAuthn outside a secure context.',
        );
        $entra = array('name' => 'Microsoft Entra ID', 'ok' => true, 'detail' => 'Disabled (optional).');
        if (SettingsRepository::bool('entra_enabled')) {
            $ready = SettingsRepository::get('entra_tenant_id') !== '' && SettingsRepository::get('entra_client_id') !== ''
                && SettingsRepository::secret('entra_client_secret') !== '' && SettingsRepository::get('entra_redirect_uri') !== '';
            $entra = array(
                'name' => 'Microsoft Entra ID',
                'ok' => $ready,
                'detail' => $ready ? 'Configured.' : 'CONFIGURATION_REQUIRED — tenant, client id, secret and redirect URI are all required.',
            );
        }
        $checks[] = $entra;
        return $checks;
    }

    /** Is the *current* PHP request running in a browser-secure context? */
    public static function requestIsSecure()
    {
        if (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') {
            return true;
        }
        if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower((string) $_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https') {
            return true;
        }
        if (isset($_SERVER['SERVER_PORT']) && (int) $_SERVER['SERVER_PORT'] === 443) {
            return true;
        }
        $host = isset($_SERVER['HTTP_HOST']) ? strtolower((string) $_SERVER['HTTP_HOST']) : '';
        $localhost = (strpos($host, 'localhost') === 0 || strpos($host, '127.0.0.1') === 0);
        return $localhost && SettingsRepository::get('environment', 'production') !== 'production';
    }

    /** Normalises an RP ID: lower-case registrable domain, no scheme or path. */
    public static function normaliseRpId($value)
    {
        $value = strtolower(trim((string) $value));
        $value = preg_replace('#^https?://#', '', $value);
        $value = preg_replace('#[/:].*$#', '', $value);
        if ($value === '' || !preg_match('/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/', $value)) {
            return '';
        }
        return $value;
    }

    /**
     * Normalises a newline/comma separated list. For origins each entry must be
     * an absolute scheme://host[:port] with no path.
     */
    public static function normaliseList($value, $asOrigins)
    {
        $items = preg_split('/[\s,]+/', (string) $value, -1, PREG_SPLIT_NO_EMPTY);
        $clean = array();
        foreach ((array) $items as $item) {
            $item = strtolower(trim($item));
            if ($asOrigins) {
                $parts = parse_url($item);
                if (!$parts || empty($parts['scheme']) || empty($parts['host'])) {
                    continue;
                }
                $item = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . (int) $parts['port'] : '');
            } elseif (!preg_match('/^[a-z0-9.-]+$/', $item)) {
                continue;
            }
            if (!in_array($item, $clean, true)) {
                $clean[] = $item;
            }
        }
        return implode("\n", $clean);
    }

    public static function origins()
    {
        $raw = (string) SettingsRepository::get('allowed_origins', '');
        $list = preg_split('/[\s,]+/', $raw, -1, PREG_SPLIT_NO_EMPTY);
        return array_values(array_unique(array_map('strtolower', (array) $list)));
    }
}
