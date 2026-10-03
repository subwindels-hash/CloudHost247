<?php
/**
 * CloudHost247 Blockonomics gateway settings resolver.
 *
 * ONE authoritative source for every "may this payment method be used right now?" decision.
 * The WHMCS gateway (blockonomics.php / payment.php), the callback, the checkout templates and
 * the CloudHost247 Payments admin pages all resolve availability through this class, so hiding
 * a button can never diverge from what the server actually enforces.
 *
 * Storage remains the EXISTING WHMCS gateway configuration (tblpaymentgateways rows for the
 * `blockonomics` module) — no duplicate settings store. The only new setting introduced is the
 * CloudHost247 master switch (`GatewayEnabled`), which is additive and defaults to ON for
 * existing installations so nothing breaks on upgrade.
 *
 * API key resolution is bridged to the CloudHost247 API & Integrations vault
 * (modules/addons/cloudhost247_integrations, provider key `blockonomics`, AES-256-GCM at rest).
 * When a central credential exists it wins; otherwise the legacy WHMCS gateway `ApiKey` field
 * keeps working — full backwards compatibility, no forced migration, no duplicated secret.
 *
 * All pure decision logic is static and side-effect free on injected arrays, so it is unit
 * testable without WHMCS (tests/payments/run.php).
 */

namespace Blockonomics;

use WHMCS\Database\Capsule;

require_once __DIR__ . '/Keccak256.php';

class GatewaySettings
{
    const GATEWAY_MODULE = 'blockonomics';

    /** Currencies the bundled Blockonomics implementation actually supports. Never invented. */
    public static function supportedCurrencyCodes()
    {
        return array('btc', 'bch', 'usdt');
    }

    /**
     * USDT token networks actually supported by the existing implementation
     * (Blockonomics::getTokenNetworkDetails). Do NOT add networks here that the
     * payment/verification code cannot handle.
     */
    public static function supportedUsdtNetworks()
    {
        return array(
            'ethereum' => array('label' => 'Ethereum', 'test' => false),
            'sepolia'  => array('label' => 'Sepolia (TEST NETWORK — not for production funds)', 'test' => true),
        );
    }

    /* ------------------------------------------------------------------ pure decision logic */

    /**
     * Master switch. Additive setting; ABSENT means ON so existing installations keep working
     * until an administrator makes the state explicit (spec §6, §31).
     */
    public static function gatewayEnabledFrom(array $settings)
    {
        if (!array_key_exists('GatewayEnabled', $settings) || $settings['GatewayEnabled'] === '') {
            return true;
        }
        return $settings['GatewayEnabled'] === 'on';
    }

    /** Per-currency flag as stored by the existing WHMCS yesno fields ('on' or ''). */
    public static function currencyFlagFrom(array $settings, $code)
    {
        $key = strtolower($code) . 'Enabled';
        return isset($settings[$key]) && $settings[$key] === 'on';
    }

    /**
     * A valid EVM receiving address is required before USDT can be offered.
     *
     * Syntax alone is not enough: an address written in mixed case carries an EIP-55
     * checksum, and accepting one whose capitalisation does not match would send funds
     * to the mistyped address it decodes to. All-lowercase and all-uppercase addresses
     * carry no checksum information and stay valid, which is also how every wallet
     * renders them. The keccak-256 digest behind the checksum is implemented in
     * Keccak256.php because no supported PHP build ships keccak-256 in ext-hash
     * (`sha3-256` is a different algorithm and would silently mis-verify).
     */
    public static function usdtAddressValid($address)
    {
        if (!is_string($address) || preg_match('/^0x[0-9a-fA-F]{40}$/', $address) !== 1) {
            return false;
        }
        return Keccak256::checksumValid($address);
    }

    /** The configured network must be one the implementation actually supports (spec §9). */
    public static function usdtNetworkValid($network)
    {
        $networks = self::supportedUsdtNetworks();
        return is_string($network) && isset($networks[$network]);
    }

    /** Full USDT configuration validity (spec §33–§34). */
    public static function usdtConfigValidFrom(array $settings)
    {
        $address = isset($settings['UsdtAddress']) ? $settings['UsdtAddress'] : '';
        $network = isset($settings['NetworkType']) ? $settings['NetworkType'] : '';
        return self::usdtAddressValid($address) && self::usdtNetworkValid($network);
    }

    /**
     * THE effective-availability rule (spec §15, §32–§33):
     *   gateway master switch ON
     *   AND the currency's own flag ON
     *   AND an API credential is configured (BTC/BCH address generation needs it)
     *   AND, for USDT, the receiving address + network configuration is valid.
     *
     * Returns the effective list of currency codes; an empty array means the
     * "Cryptocurrency payment unavailable" state.
     */
    public static function effectiveCurrenciesFrom(array $settings, $apiKeyConfigured)
    {
        if (!self::gatewayEnabledFrom($settings)) {
            return array();
        }
        $effective = array();
        foreach (self::supportedCurrencyCodes() as $code) {
            if (!self::currencyFlagFrom($settings, $code)) {
                continue;
            }
            if ($code === 'usdt') {
                if (!self::usdtConfigValidFrom($settings)) {
                    continue;
                }
            } else {
                // BTC/BCH require the Blockonomics API credential for address generation.
                if (!$apiKeyConfigured) {
                    continue;
                }
            }
            $effective[] = $code;
        }
        return $effective;
    }

    /** Human label for the configured USDT network — never a bare "USDT" (spec §9). */
    public static function usdtNetworkLabelFrom(array $settings)
    {
        $network = isset($settings['NetworkType']) ? $settings['NetworkType'] : '';
        $networks = self::supportedUsdtNetworks();
        return isset($networks[$network]) ? $networks[$network]['label'] : 'network not configured';
    }

    /* ----------------------------------------------------------------------- DB-backed API */

    /**
     * Raw setting rows for the blockonomics gateway module. Read via Capsule so this also works
     * on the admin pages where getGatewayVariables() may activate other side effects.
     */
    public static function loadSettings()
    {
        $settings = array();
        try {
            $rows = Capsule::table('tblpaymentgateways')
                ->where('gateway', self::GATEWAY_MODULE)
                ->get();
            foreach ($rows as $row) {
                $settings[$row->setting] = $row->value;
            }
        } catch (\Throwable $error) {
            // Fail closed: unreadable configuration means no payment methods are offered.
            return array();
        }
        return $settings;
    }

    /**
     * Upserts one gateway setting row, preserving the existing WHMCS storage model.
     * Returns the previous value (null when the setting did not exist).
     */
    public static function saveSetting($setting, $value)
    {
        $existing = Capsule::table('tblpaymentgateways')
            ->where('gateway', self::GATEWAY_MODULE)
            ->where('setting', $setting)
            ->first();
        if ($existing) {
            Capsule::table('tblpaymentgateways')
                ->where('gateway', self::GATEWAY_MODULE)
                ->where('setting', $setting)
                ->update(array('value' => $value));
            return $existing->value;
        }
        Capsule::table('tblpaymentgateways')->insert(array(
            'gateway' => self::GATEWAY_MODULE,
            'setting' => $setting,
            'value'   => $value,
            'order'   => 0,
        ));
        return null;
    }

    /** True when the gateway module itself is activated in WHMCS (has a `type` row). */
    public static function gatewayActivated()
    {
        $settings = self::loadSettings();
        return isset($settings['type']) && $settings['type'] !== '';
    }

    /* ----------------------------------------------------------- credential vault bridging */

    /**
     * Resolves the Blockonomics API key: CloudHost247 API & Integrations vault first
     * (encrypted at rest, provider key `blockonomics`), then the legacy WHMCS gateway field.
     * Never logs, never echoes — callers must treat the return value as a secret.
     */
    public static function resolveApiKey()
    {
        $vaultKey = self::vaultApiKey();
        if ($vaultKey !== null && $vaultKey !== '') {
            return $vaultKey;
        }
        $settings = self::loadSettings();
        return isset($settings['ApiKey']) ? $settings['ApiKey'] : '';
    }

    /**
     * Where the effective credential comes from: 'vault' | 'gateway' | 'missing'.
     * Safe for admin display — it never includes the credential itself.
     */
    public static function apiKeySource()
    {
        if (self::vaultApiKey() !== null) {
            return 'vault';
        }
        $settings = self::loadSettings();
        if (isset($settings['ApiKey']) && $settings['ApiKey'] !== '') {
            return 'gateway';
        }
        return 'missing';
    }

    public static function apiKeyConfigured()
    {
        return self::apiKeySource() !== 'missing';
    }

    /**
     * Central-vault lookup. Null when the integrations addon is absent, the provider is not
     * configured, or the stored secret cannot be used — the legacy path then applies. This is
     * the "secure configuration resolver" bridge required by spec §30–§31.
     */
    private static function vaultApiKey()
    {
        $bootstrap = __DIR__ . '/../../../addons/cloudhost247_integrations/bootstrap.php';
        if (!class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager')) {
            if (!is_file($bootstrap)) {
                return null;
            }
            try {
                require_once $bootstrap;
            } catch (\Throwable $error) {
                return null;
            }
        }
        if (!class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager')) {
            return null;
        }
        try {
            $credentials = \CloudHost247\Integrations\Services\IntegrationManager::optionalCredentials('blockonomics');
        } catch (\Throwable $error) {
            return null;
        }
        if (!is_array($credentials) || !isset($credentials['secrets']['api_key'])) {
            return null;
        }
        $key = (string) $credentials['secrets']['api_key'];
        return $key === '' ? null : $key;
    }

    /* -------------------------------------------------------------------- effective state */

    /** Effective currency codes, resolved from live configuration. */
    public static function effectiveCurrencies()
    {
        return self::effectiveCurrenciesFrom(self::loadSettings(), self::apiKeyConfigured());
    }

    public static function gatewayEnabled()
    {
        return self::gatewayEnabledFrom(self::loadSettings());
    }

    public static function currencyAvailable($code)
    {
        return in_array(strtolower((string) $code), self::effectiveCurrencies(), true);
    }

    public static function usdtNetworkLabel()
    {
        return self::usdtNetworkLabelFrom(self::loadSettings());
    }

    /** Safe, secret-free message used everywhere a disabled method is refused (spec §16). */
    public static function unavailableMessage()
    {
        return 'This payment method is currently unavailable.';
    }
}
