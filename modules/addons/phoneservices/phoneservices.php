<?php
/**
 * Phone Number Services Platform - WHMCS addon module entry point.
 *
 * The addon is the platform core: it owns the schema, the Super Admin panel
 * and the client area. Per-service provisioning is handled by the companion
 * server modules (modules/servers/phoneservices_*), which delegate to the same
 * service layer.
 *
 * Provider credentials are NOT stored as addon settings: they are managed in
 * the module's API Configuration screen and encrypted at rest (AES-256-GCM).
 *
 * @package    PhoneServices
 * @author     CloudHost247
 * @license    Proprietary
 * @version    1.1.0
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

require_once __DIR__ . '/bootstrap.php';

use PhoneServices\Core\Config;
use PhoneServices\Core\Logger;
use PhoneServices\Core\Module;
use PhoneServices\Core\Security;

/**
 * Addon metadata and configuration fields.
 *
 * @return array<string,mixed>
 */
function phoneservices_config()
{
    return [
        'name'        => 'Phone Number Services Platform',
        'description' => 'Virtual phone numbers, WebRTC VoIP, SMS/WhatsApp/email messaging, eSIM data plans and usage analytics with a provider-agnostic API layer.',
        'author'      => 'CloudHost247',
        'language'    => 'english',
        'version'     => PHONESERVICES_VERSION,
        'fields'      => [
            'api_mode' => [
                'FriendlyName' => 'API Mode',
                'Type'         => 'dropdown',
                'Options'      => 'sandbox,live',
                'Default'      => 'sandbox',
                'Description'  => 'Sandbox uses provider test endpoints and enables verbose logging.',
            ],
            'webhook_base_url' => [
                'FriendlyName' => 'Webhook Base URL',
                'Type'         => 'text',
                'Size'         => '60',
                'Default'      => '',
                'Description'  => 'Optional override, e.g. https://billing.example.com/modules/addons/phoneservices/api/webhooks. Defaults to the WHMCS system URL.',
            ],
            'show_navbar_link' => [
                'FriendlyName' => 'Client Navigation Link',
                'Type'         => 'yesno',
                'Default'      => 'on',
                'Description'  => 'Show "Phone Services" under the client area Services menu.',
            ],
            'credentials_notice' => [
                'FriendlyName' => 'Provider Credentials',
                'Type'         => 'textarea',
                'Rows'         => '2',
                'Default'      => '',
                'Description'  => 'Configure Twilio / Vonage / Airalo / Truphone / WhatsApp / SendGrid credentials inside the module (Addons > Phone Number Services Platform > API Configuration). They are encrypted at rest and never stored here.',
            ],
        ],
    ];
}

/**
 * Create the schema, apply migrations and seed defaults.
 *
 * @return array<string,string>
 */
function phoneservices_activate()
{
    try {
        $module = new Module();
        $result = $module->activate();

        return [
            'status'      => 'success',
            'description' => sprintf(
                'Phone Number Services Platform activated. %d schema statements executed, %d migration(s) applied.',
                $result['tables'],
                $result['migrations']
            ),
        ];
    } catch (\Throwable $e) {
        return [
            'status'      => 'error',
            'description' => 'Activation failed: ' . $e->getMessage(),
        ];
    }
}

/**
 * @return array<string,string>
 */
function phoneservices_deactivate()
{
    try {
        (new Module())->deactivate();

        return [
            'status'      => 'success',
            'description' => 'Phone Number Services Platform deactivated. Telecom records were retained for billing evidence.',
        ];
    } catch (\Throwable $e) {
        return [
            'status'      => 'error',
            'description' => 'Deactivation failed: ' . $e->getMessage(),
        ];
    }
}

/**
 * @param array<string,mixed> $vars
 */
function phoneservices_upgrade($vars)
{
    try {
        (new Module())->upgrade((string) ($vars['version'] ?? ''));
    } catch (\Throwable $e) {
        Logger::exception($e, 'Module upgrade');
    }
}

/**
 * Super Admin panel.
 *
 * @param array<string,mixed> $vars
 */
function phoneservices_output($vars)
{
    $action = isset($_GET['action']) ? (string) $_GET['action'] : 'dashboard';

    if (!array_key_exists($action, Module::ADMIN_PAGES)) {
        $action = 'dashboard';
    }

    $module = new Module();

    echo '<div class="phoneservices-admin-wrapper">';

    try {
        switch ($action) {
            case 'api_config':
                $module->renderApiConfig($vars);
                break;
            case 'providers':
                $module->renderProviders($vars);
                break;
            case 'pricing':
                $module->renderPricing($vars);
                break;
            case 'numbers':
                $module->renderNumbersAdmin($vars);
                break;
            case 'voip':
                $module->renderVoipAdmin($vars);
                break;
            case 'sms':
                $module->renderSmsAdmin($vars);
                break;
            case 'esim':
                $module->renderEsimAdmin($vars);
                break;
            case 'usage':
                $module->renderUsageAdmin($vars);
                break;
            case 'transactions':
                $module->renderTransactionsAdmin($vars);
                break;
            case 'users':
                $module->renderUsersAdmin($vars);
                break;
            case 'logs':
                $module->renderLogsAdmin($vars);
                break;
            case 'dashboard':
            default:
                $module->renderAdminDashboard($vars);
        }
    } catch (\Throwable $e) {
        Logger::exception($e, 'Admin page ' . $action);
        echo '<div class="alert alert-danger">The page could not be rendered: '
            . Security::escape($e->getMessage())
            . '. See Phone Services > System Logs for details.</div>';
    }

    echo '</div>';
}

/**
 * Admin sidebar navigation.
 *
 * @param array<string,mixed> $vars
 */
function phoneservices_sidebar($vars)
{
    $link = $vars['modulelink'] ?? '';
    $current = (string) ($_GET['action'] ?? 'dashboard');
    $toggles = Config::getFeatureToggles();

    $groups = [
        'Platform' => [
            'dashboard'  => ['Dashboard', 'fa-tachometer-alt', true],
            'api_config' => ['API Configuration', 'fa-cogs', true],
            'providers'  => ['Provider Health', 'fa-plug', true],
            'pricing'    => ['Pricing Control', 'fa-dollar-sign', true],
        ],
        'Services' => [
            'numbers' => ['Numbers', 'fa-phone', $toggles['numbers']],
            'voip'    => ['VoIP & Calls', 'fa-microphone', $toggles['voip']],
            'sms'     => ['Messaging', 'fa-comment-dots', $toggles['sms']],
            'esim'    => ['eSIM & Data', 'fa-sim-card', $toggles['esim']],
        ],
        'Operations' => [
            'usage'        => ['Usage & Analytics', 'fa-chart-line', $toggles['analytics']],
            'transactions' => ['Transactions', 'fa-receipt', true],
            'users'        => ['Users & Subscriptions', 'fa-users', true],
            'logs'         => ['System Logs', 'fa-file-alt', true],
        ],
    ];

    $html = '<div class="phoneservices-sidebar">';

    foreach ($groups as $groupLabel => $items) {
        $html .= '<div class="ps-sidebar-header">' . htmlspecialchars($groupLabel, ENT_QUOTES, 'UTF-8') . '</div><ul class="ps-menu">';

        foreach ($items as $action => [$label, $icon, $enabled]) {
            $classes = 'ps-menu-item' . ($current === $action ? ' active' : '') . ($enabled ? '' : ' disabled');
            $html .= '<li class="' . $classes . '"><a href="' . htmlspecialchars($link . '&action=' . $action, ENT_QUOTES, 'UTF-8') . '">'
                . '<i class="fas ' . $icon . '"></i> ' . htmlspecialchars($label, ENT_QUOTES, 'UTF-8')
                . ($enabled ? '' : ' <span class="ps-pill">off</span>')
                . '</a></li>';
        }

        $html .= '</ul>';
    }

    $html .= '<div class="ps-sidebar-footer">v' . htmlspecialchars(PHONESERVICES_VERSION, ENT_QUOTES, 'UTF-8')
        . ' &middot; ' . (Config::isSandbox() ? 'sandbox' : 'live') . ' mode</div></div>';

    return $html;
}

/**
 * Client area controller.
 *
 * @param array<string,mixed> $vars
 * @return array<string,mixed>
 */
function phoneservices_clientarea($vars)
{
    $action = isset($_GET['action']) ? (string) $_GET['action'] : 'dashboard';

    return (new Module())->renderClientArea($vars, $action);
}
