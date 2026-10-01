<?php
/**
 * CloudHost247 Payments — Blockonomics gateway administration.
 *
 * Super Admin control surface over the EXISTING Blockonomics WHMCS gateway: master switch,
 * per-currency availability (BTC / BCH / USDT), confirmation requirement, payment window,
 * USDT receiving address + network, server-side connection test, and full audit logging.
 *
 * Storage is the existing tblpaymentgateways configuration through
 * Blockonomics\GatewaySettings — the same resolver the gateway, payment page and callback
 * enforce at runtime, so what this page saves IS what the server enforces. Credentials are
 * NOT edited here: the API key lives in the CloudHost247 API & Integrations vault (encrypted)
 * or, for legacy installs, in the WHMCS gateway configuration; this page only ever shows a
 * masked status and where the credential comes from.
 */

namespace CloudHost247\Payments\Services;

use CloudHost247\Foundation\Security\AdminGuard;
use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Foundation\Support\SafeError;
use Blockonomics\GatewaySettings;

final class AdminController
{
    const MODULE = 'cloudhost247_payments';

    /** Settings this page may write, with validators. Secrets are deliberately absent. */
    private static function editableSettings()
    {
        return array(
            'GatewayEnabled' => array('label' => 'Blockonomics gateway', 'validate' => 'toggle'),
            'btcEnabled'     => array('label' => 'BTC payments', 'validate' => 'toggle'),
            'bchEnabled'     => array('label' => 'BCH payments', 'validate' => 'toggle'),
            'usdtEnabled'    => array('label' => 'USDT payments', 'validate' => 'toggle'),
            'Confirmations'  => array('label' => 'Required confirmations', 'validate' => 'confirmations'),
            'TimePeriod'     => array('label' => 'Payment expiration (minutes)', 'validate' => 'time_period'),
            'NetworkType'    => array('label' => 'USDT network', 'validate' => 'network'),
            'UsdtAddress'    => array('label' => 'USDT receiving address', 'validate' => 'usdt_address'),
        );
    }

    public function handle()
    {
        // Explicit authenticated-admin gate first (same as every other CloudHost247 admin
        // controller): requirePostToken()/requireCapability() also enforce it transitively,
        // but the file-local guard is what the security review test scans for.
        AdminGuard::requireAdmin();

        $notice = '';
        $error = '';

        if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET') === 'POST') {
            try {
                AdminGuard::requirePostToken();
                $operation = isset($_POST['operation']) ? (string) $_POST['operation'] : '';
                if ($operation === 'save_settings') {
                    AdminGuard::requireCapability(self::MODULE, 'payments.configure');
                    $notice = $this->saveSettings($_POST);
                } elseif ($operation === 'test_connection') {
                    AdminGuard::requireCapability(self::MODULE, 'payments.gateway.test');
                    $notice = $this->testConnection();
                } else {
                    $error = 'Unknown operation.';
                }
            } catch (\Throwable $failure) {
                $safe = SafeError::from($failure, self::MODULE, 'admin_operation', 'The operation could not be completed.');
                $error = $safe['display'];
            }
        }

        return $this->view($notice, $error);
    }

    /* ------------------------------------------------------------------------------- save */

    private function saveSettings(array $post)
    {
        $settings = GatewaySettings::loadSettings();
        $changed = array();

        foreach (self::editableSettings() as $key => $meta) {
            $submitted = $this->normalize($key, $meta['validate'], $post);
            if ($submitted === null) {
                continue; // absent or invalid-and-reported below
            }
            $previous = isset($settings[$key]) ? $settings[$key] : '';
            if ((string) $previous === (string) $submitted) {
                continue;
            }
            $changed[$key] = array('label' => $meta['label'], 'before' => $previous, 'after' => $submitted);
        }

        // Configuration validation BEFORE enabling a currency (spec §32–§34): compute the state
        // as it would be after this save and refuse enabling a non-functional method.
        $candidate = $settings;
        foreach ($changed as $key => $delta) {
            $candidate[$key] = $delta['after'];
        }
        if (isset($candidate['usdtEnabled']) && $candidate['usdtEnabled'] === 'on'
            && !GatewaySettings::usdtConfigValidFrom($candidate)) {
            throw new \RuntimeException(
                'USDT cannot be enabled because the required network/receiving configuration is incomplete. '
                . 'Configure a valid 0x… receiving address and a supported network first.'
            );
        }
        $apiKeyConfigured = GatewaySettings::apiKeyConfigured();
        foreach (array('btcEnabled', 'bchEnabled') as $coinFlag) {
            if (isset($candidate[$coinFlag]) && $candidate[$coinFlag] === 'on' && !$apiKeyConfigured) {
                throw new \RuntimeException(
                    strtoupper(substr($coinFlag, 0, 3)) . ' cannot be enabled because no Blockonomics API key is configured. '
                    . 'Add the credential in CloudHost247 API & Integrations (provider "Blockonomics") first.'
                );
            }
        }

        if (!$changed) {
            return 'No changes to save.';
        }

        // Persist and audit each change individually with before/after values (spec §28).
        foreach ($changed as $key => $delta) {
            GatewaySettings::saveSetting($key, $delta['after']);
            AuditLogger::record(
                self::MODULE,
                'blockonomics.setting_changed',
                'gateway_setting',
                'blockonomics:' . $key,
                array('setting' => $key, 'label' => $delta['label'], 'value' => $delta['before']),
                array('setting' => $key, 'label' => $delta['label'], 'value' => $delta['after'])
            );
        }

        return 'Settings saved. ' . count($changed) . ' change(s) recorded in the audit log.';
    }

    /** Returns the normalized stored value, or null when the field was not submitted. */
    private function normalize($key, $validator, array $post)
    {
        switch ($validator) {
            case 'toggle':
                if (!array_key_exists('submitted_toggles', $post)) {
                    return null; // settings form not submitted
                }
                return isset($post[$key]) && $post[$key] === 'on' ? 'on' : '';
            case 'confirmations':
                if (!isset($post[$key])) { return null; }
                $value = (string) (int) $post[$key];
                if (!in_array($value, array('0', '1', '2'), true)) {
                    throw new \RuntimeException('Required confirmations must be 0, 1 or 2.');
                }
                return $value;
            case 'time_period':
                if (!isset($post[$key])) { return null; }
                $value = (string) (int) $post[$key];
                if (!in_array($value, array('10', '15', '20', '25', '30'), true)) {
                    throw new \RuntimeException('Payment expiration must be 10, 15, 20, 25 or 30 minutes.');
                }
                return $value;
            case 'network':
                if (!isset($post[$key]) || $post[$key] === '') { return null; }
                $value = (string) $post[$key];
                if (!GatewaySettings::usdtNetworkValid($value)) {
                    throw new \RuntimeException('The selected USDT network is not supported by this integration.');
                }
                return $value;
            case 'usdt_address':
                if (!isset($post[$key])) { return null; }
                $value = trim((string) $post[$key]);
                if ($value !== '' && !GatewaySettings::usdtAddressValid($value)) {
                    throw new \RuntimeException('The USDT receiving address must be a valid 0x… address (42 characters).');
                }
                return $value;
        }
        return null;
    }

    /* ------------------------------------------------------------------------------- test */

    /**
     * Server-side connection test against Blockonomics using the resolved credential.
     * Returns ONLY a sanitized classification; the credential and the provider response body
     * are never echoed, logged or stored (spec §14).
     */
    private function testConnection()
    {
        $result = $this->classifyConnection();
        GatewaySettings::saveSetting('CH247LastTestResult', $result);
        GatewaySettings::saveSetting('CH247LastTestAt', (string) time());
        AuditLogger::record(
            self::MODULE,
            'blockonomics.connection_tested',
            'gateway_setting',
            'blockonomics:connection',
            array(),
            array('result' => $result)
        );
        return 'Connection test: ' . $result;
    }

    private function classifyConnection()
    {
        $apiKey = GatewaySettings::resolveApiKey();
        if (!is_string($apiKey) || $apiKey === '') {
            return 'Invalid configuration';
        }
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, 'https://www.blockonomics.co/api/address?&no_balance=true&only_xpub=true&get_callback=true');
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
        curl_setopt($ch, CURLOPT_TIMEOUT, 20);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
        curl_setopt($ch, CURLOPT_HTTPHEADER, array('Authorization: Bearer ' . $apiKey));
        curl_exec($ch); // body intentionally discarded — it is never surfaced anywhere
        $errno = curl_errno($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($errno === CURLE_OPERATION_TIMEOUTED) {
            return 'Connection timeout';
        }
        if ($errno !== 0) {
            return 'Provider unavailable';
        }
        if ($status === 200) {
            return 'Connected successfully';
        }
        if ($status === 401 || $status === 403) {
            return 'Authentication failed';
        }
        if ($status >= 500) {
            return 'Provider unavailable';
        }
        return 'Invalid configuration';
    }

    /* ------------------------------------------------------------------------------- view */

    private function view($notice, $error)
    {
        $e = function ($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); };
        $settings = GatewaySettings::loadSettings();
        $effective = GatewaySettings::effectiveCurrencies();
        $apiKeySource = GatewaySettings::apiKeySource();
        $gatewayActivated = isset($settings['type']) && $settings['type'] !== '';
        $token = function_exists('generate_token') ? generate_token('plain') : '';
        $canConfigure = $this->hasCapability('payments.configure');
        $canTest = $this->hasCapability('payments.gateway.test');

        $flag = function ($key) use ($settings) {
            return isset($settings[$key]) && $settings[$key] === 'on';
        };
        $masterOn = GatewaySettings::gatewayEnabledFrom($settings);
        $usdtValid = GatewaySettings::usdtConfigValidFrom($settings);
        $networks = GatewaySettings::supportedUsdtNetworks();
        $networkType = isset($settings['NetworkType']) ? $settings['NetworkType'] : '';
        $lastTest = isset($settings['CH247LastTestResult']) ? $settings['CH247LastTestResult'] : 'Not tested yet';
        $lastTestAt = isset($settings['CH247LastTestAt']) && $settings['CH247LastTestAt'] !== ''
            ? date('Y-m-d H:i:s', (int) $settings['CH247LastTestAt']) : '—';

        $keySourceText = array(
            'vault' => 'Configured in CloudHost247 API &amp; Integrations (encrypted vault) &#10003;',
            'gateway' => 'Configured in the WHMCS gateway settings (legacy). Recommended: move it to Admin &rarr; Addons &rarr; CloudHost247 API &amp; Integrations &rarr; Blockonomics, then clear the legacy field.',
            'missing' => '<span style="color:#a94442;">Not configured — BTC/BCH address generation is unavailable.</span>',
        );

        $badge = function ($ok, $yes = 'ON', $no = 'OFF') {
            return $ok
                ? '<span class="label label-success">' . $yes . '</span>'
                : '<span class="label label-default">' . $no . '</span>';
        };

        $html  = '<h2>Blockonomics — Cryptocurrency Payment Gateway</h2>';
        $html .= '<p class="text-muted">One authoritative gateway: these switches control the same server-side rules enforced by the payment page, the Pay Now link and the callback. '
               . '<a href="addonmodules.php?module=cloudhost247_payments&view=transactions">Cryptocurrency transactions &rarr;</a></p>';

        if (!$gatewayActivated) {
            $html .= '<div class="alert alert-warning">The Blockonomics gateway module is not activated in WHMCS (Setup &rarr; Payments &rarr; Payment Gateways). Activate it there first; these settings then govern its availability.</div>';
        }
        if ($notice) { $html .= '<div class="alert alert-success">' . $e($notice) . '</div>'; }
        if ($error) { $html .= '<div class="alert alert-danger">' . $e($error) . '</div>'; }

        // ----- effective state summary (what customers can actually use right now)
        $summaryParts = array();
        foreach (array('btc' => 'Bitcoin (BTC)', 'bch' => 'Bitcoin Cash (BCH)') as $code => $label) {
            if (in_array($code, $effective, true)) { $summaryParts[] = $label; }
        }
        if (in_array('usdt', $effective, true)) {
            $summaryParts[] = 'USDT &mdash; ' . $e(GatewaySettings::usdtNetworkLabelFrom($settings));
        }
        $html .= '<div class="panel panel-default"><div class="panel-heading"><strong>Customer-facing availability (effective state)</strong></div><div class="panel-body">'
               . ($summaryParts
                   ? implode(' &nbsp; ', array_map(function ($p) { return '<span class="label label-info" style="font-size:95%;">' . $p . '</span>'; }, $summaryParts))
                   : '<em>Cryptocurrency payment unavailable.</em>')
               . '</div></div>';

        // ----- settings form
        $html .= '<form method="post"><input type="hidden" name="token" value="' . $e($token) . '">'
               . '<input type="hidden" name="operation" value="save_settings">'
               . '<input type="hidden" name="submitted_toggles" value="1">';

        $html .= '<div class="panel panel-default"><div class="panel-heading"><strong>Gateway status</strong></div><table class="table">';
        $html .= '<tr><td style="width:45%;"><strong>Blockonomics gateway</strong><br><small>Master switch. OFF refuses every new Blockonomics payment server-side; historical transactions remain visible and are never reversed.</small></td>'
               . '<td>' . $badge($masterOn) . ' <label style="margin-left:12px;"><input type="checkbox" name="GatewayEnabled" value="on"' . ($masterOn ? ' checked' : '') . '> Enabled</label></td></tr>';
        $html .= '</table></div>';

        $html .= '<div class="panel panel-default"><div class="panel-heading"><strong>Payment methods</strong></div><table class="table">';
        $html .= '<tr><td style="width:45%;"><strong>Bitcoin (BTC)</strong><br><small>Requires the Blockonomics API key.</small></td>'
               . '<td>' . $badge($flag('btcEnabled')) . ' <label style="margin-left:12px;"><input type="checkbox" name="btcEnabled" value="on"' . ($flag('btcEnabled') ? ' checked' : '') . '> Enable BTC payments</label>'
               . (in_array('btc', $effective, true) || !$flag('btcEnabled') ? '' : ' <span class="text-danger">(enabled but not offered — check master switch / API key)</span>')
               . '</td></tr>';
        $html .= '<tr><td><strong>Bitcoin Cash (BCH)</strong><br><small>Requires the Blockonomics API key.</small></td>'
               . '<td>' . $badge($flag('bchEnabled')) . ' <label style="margin-left:12px;"><input type="checkbox" name="bchEnabled" value="on"' . ($flag('bchEnabled') ? ' checked' : '') . '> Enable BCH payments</label></td></tr>';
        $html .= '<tr><td><strong>Tether (USDT)</strong><br><small>Requires a valid receiving address and a supported network. Customers always see the network explicitly.</small></td>'
               . '<td>' . $badge($flag('usdtEnabled')) . ' <label style="margin-left:12px;"><input type="checkbox" name="usdtEnabled" value="on"' . ($flag('usdtEnabled') ? ' checked' : '') . '> Enable USDT payments</label>'
               . ($usdtValid ? '' : '<br><span class="text-danger">USDT configuration incomplete — it cannot be enabled until the address and network below are valid.</span>')
               . '</td></tr>';
        $html .= '<tr><td><strong>USDT network</strong><br><small>Only networks supported by the existing integration are listed. Test networks are labelled explicitly.</small></td><td><select class="form-control" style="max-width:360px;" name="NetworkType">';
        foreach ($networks as $key => $network) {
            $html .= '<option value="' . $e($key) . '"' . ($networkType === $key ? ' selected' : '') . '>USDT &mdash; ' . $e($network['label']) . '</option>';
        }
        $html .= '</select></td></tr>';
        $html .= '<tr><td><strong>USDT receiving address</strong><br><small>The 0x&hellip; address that receives USDT on the configured network.</small></td>'
               . '<td><input class="form-control" style="max-width:480px;" name="UsdtAddress" maxlength="42" placeholder="0x&hellip;" value="' . $e(isset($settings['UsdtAddress']) ? $settings['UsdtAddress'] : '') . '"></td></tr>';
        $html .= '</table></div>';

        $html .= '<div class="panel panel-default"><div class="panel-heading"><strong>Payment verification</strong></div><table class="table">';
        $html .= '<tr><td style="width:45%;"><strong>Required confirmations</strong><br><small>A blockchain payment is never final before this many confirmations.</small></td><td><select class="form-control" style="max-width:120px;" name="Confirmations">';
        $currentConf = isset($settings['Confirmations']) && $settings['Confirmations'] !== '' ? (string) $settings['Confirmations'] : '2';
        foreach (array('2' => '2 (recommended)', '1' => '1', '0' => '0') as $value => $label) {
            $html .= '<option value="' . $value . '"' . ($currentConf === $value ? ' selected' : '') . '>' . $label . '</option>';
        }
        $html .= '</select></td></tr>';
        $html .= '<tr><td><strong>Payment expiration</strong><br><small>Minutes a generated payment request stays valid; expired requests are shown as Expired and a retry gets a fresh reference.</small></td><td><select class="form-control" style="max-width:120px;" name="TimePeriod">';
        $currentPeriod = isset($settings['TimePeriod']) && $settings['TimePeriod'] !== '' ? (string) $settings['TimePeriod'] : '10';
        foreach (array('10', '15', '20', '25', '30') as $value) {
            $html .= '<option value="' . $value . '"' . ($currentPeriod === $value ? ' selected' : '') . '>' . $value . ' minutes</option>';
        }
        $html .= '</select></td></tr>';
        $html .= '</table></div>';

        if ($canConfigure) {
            $html .= '<p><button class="btn btn-primary" type="submit">Save Settings</button></p>';
        } else {
            $html .= '<p class="text-muted">Your administrator role lacks the payments.configure capability; settings are read-only.</p>';
        }
        $html .= '</form>';

        // ----- connection panel (credential is displayed as a masked status only, spec §12–§13)
        $html .= '<div class="panel panel-default"><div class="panel-heading"><strong>Connection</strong></div><table class="table">';
        $html .= '<tr><td style="width:45%;"><strong>API key</strong></td><td><code>&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;</code><br><small>'
               . $keySourceText[$apiKeySource]
               . '</small><br><a class="btn btn-default btn-sm" style="margin-top:6px;" href="addonmodules.php?module=cloudhost247_integrations">Replace API Key (API &amp; Integrations)</a></td></tr>';
        $html .= '<tr><td><strong>Connection status</strong></td><td>' . $e($lastTest) . ' <small class="text-muted">(last tested: ' . $e($lastTestAt) . ')</small></td></tr>';
        $html .= '<tr><td><strong>Callback</strong></td><td><small>The hardened callback endpoint remains <code>modules/gateways/callback/blockonomics.php</code>; its secret is managed by the gateway and is never displayed here.</small></td></tr>';
        $html .= '</table>';
        if ($canTest) {
            $html .= '<div class="panel-body"><form method="post" style="display:inline;"><input type="hidden" name="token" value="' . $e($token) . '">'
                   . '<input type="hidden" name="operation" value="test_connection">'
                   . '<button class="btn btn-default" type="submit">Test Connection</button></form> '
                   . '<small class="text-muted">Runs server-side against Blockonomics; only a sanitized classification is shown or stored.</small></div>';
        }
        $html .= '</div>';

        return $html;
    }

    private function hasCapability($capability)
    {
        try {
            AdminGuard::requireCapability(self::MODULE, $capability);
            return true;
        } catch (\Throwable $denied) {
            return false;
        }
    }
}
