<?php
/**
 * Phone Number Services Platform - Main Module File
 *
 * @package    PhoneServices
 * @author     Telecom Team
 * @copyright  Copyright (c) 2024
 * @license    Proprietary
 * @version    1.0.0
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

use PhoneServices\Core\Module;
use PhoneServices\Core\Config;
use PhoneServices\Core\Logger;

require_once __DIR__ . '/vendor/autoload.php';

/**
 * Module Configuration
 */
function phoneservices_config()
{
    return [
        'name'        => 'Phone Number Services Platform',
        'description' => 'Virtual telecom services including phone numbers, VoIP, SMS, eSIM, and usage tracking.',
        'author'      => 'Telecom Team',
        'language'    => 'english',
        'version'     => '1.0.0',
        'link'        => 'https://example.com/phoneservices',
        'fields'      => [
            'api_mode' => [
                'FriendlyName' => 'API Mode',
                'Type'         => 'dropdown',
                'Options'      => 'sandbox,live',
                'Default'      => 'sandbox',
                'Description'  => 'Select API operating mode.',
            ],
            'default_provider' => [
                'FriendlyName' => 'Default Provider',
                'Type'         => 'dropdown',
                'Options'      => 'twilio,vonage,airalo,truphone',
                'Default'      => 'twilio',
                'Description'  => 'Default telecom provider for all services.',
            ],
            'twilio_account_sid' => [
                'FriendlyName' => 'Twilio Account SID',
                'Type'         => 'password',
                'Size'         => '50',
                'Default'      => '',
                'Description'  => 'Your Twilio Account SID.',
            ],
            'twilio_auth_token' => [
                'FriendlyName' => 'Twilio Auth Token',
                'Type'         => 'password',
                'Size'         => '50',
                'Default'      => '',
                'Description'  => 'Your Twilio Auth Token.',
            ],
            'vonage_api_key' => [
                'FriendlyName' => 'Vonage API Key',
                'Type'         => 'password',
                'Size'         => '50',
                'Default'      => '',
                'Description'  => 'Your Vonage API Key.',
            ],
            'vonage_api_secret' => [
                'FriendlyName' => 'Vonage API Secret',
                'Type'         => 'password',
                'Size'         => '50',
                'Default'      => '',
                'Description'  => 'Your Vonage API Secret.',
            ],
            'airalo_api_token' => [
                'FriendlyName' => 'Airalo API Token',
                'Type'         => 'password',
                'Size'         => '50',
                'Default'      => '',
                'Description'  => 'Your Airalo API Token.',
            ],
            'truphone_api_key' => [
                'FriendlyName' => 'Truphone API Key',
                'Type'         => 'password',
                'Size'         => '50',
                'Default'      => '',
                'Description'  => 'Your Truphone API Key.',
            ],
            'sendgrid_api_key' => [
                'FriendlyName' => 'SendGrid API Key',
                'Type'         => 'password',
                'Size'         => '50',
                'Default'      => '',
                'Description'  => 'SendGrid API Key for email services.',
            ],
            'whatsapp_business_token' => [
                'FriendlyName' => 'WhatsApp Business Token',
                'Type'         => 'password',
                'Size'         => '50',
                'Default'      => '',
                'Description'  => 'WhatsApp Business API token.',
            ],
            'enable_numbers' => [
                'FriendlyName' => 'Enable Virtual Numbers',
                'Type'         => 'yesno',
                'Default'      => 'on',
                'Description'  => 'Enable virtual phone number services.',
            ],
            'enable_voip' => [
                'FriendlyName' => 'Enable VoIP',
                'Type'         => 'yesno',
                'Default'      => 'on',
                'Description'  => 'Enable VoIP calling services.',
            ],
            'enable_sms' => [
                'FriendlyName' => 'Enable SMS',
                'Type'         => 'yesno',
                'Default'      => 'on',
                'Description'  => 'Enable SMS messaging services.',
            ],
            'enable_esim' => [
                'FriendlyName' => 'Enable eSIM',
                'Type'         => 'yesno',
                'Default'      => 'on',
                'Description'  => 'Enable eSIM data services.',
            ],
            'log_retention_days' => [
                'FriendlyName' => 'Log Retention (Days)',
                'Type'         => 'text',
                'Size'         => '10',
                'Default'      => '90',
                'Description'  => 'Number of days to retain system logs.',
            ],
        ],
    ];
}

/**
 * Module Activation
 */
function phoneservices_activate()
{
    try {
        $module = new Module();
        $module->activate();

        return [
            'status'  => 'success',
            'description' => 'Phone Number Services Platform activated successfully. Database tables created.',
        ];
    } catch (\Exception $e) {
        return [
            'status'  => 'error',
            'description' => 'Activation failed: ' . $e->getMessage(),
        ];
    }
}

/**
 * Module Deactivation
 */
function phoneservices_deactivate()
{
    try {
        $module = new Module();
        $module->deactivate();

        return [
            'status'  => 'success',
            'description' => 'Phone Number Services Platform deactivated.',
        ];
    } catch (\Exception $e) {
        return [
            'status'  => 'error',
            'description' => 'Deactivation failed: ' . $e->getMessage(),
        ];
    }
}

/**
 * Module Upgrade
 */
function phoneservices_upgrade($vars)
{
    try {
        $module = new Module();
        $module->upgrade($vars['version']);
    } catch (\Exception $e) {
        Logger::error('Upgrade failed: ' . $e->getMessage());
    }
}

/**
 * Admin Area Output
 */
function phoneservices_output($vars)
{
    $action = isset($_GET['action']) ? $_GET['action'] : 'dashboard';
    $module = new Module();
    
    echo '<div class="phoneservices-admin-wrapper">';
    
    switch ($action) {
        case 'dashboard':
            $module->renderAdminDashboard($vars);
            break;
        case 'api_config':
            $module->renderApiConfig($vars);
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
        default:
            $module->renderAdminDashboard($vars);
    }
    
    echo '</div>';
}

/**
 * Admin Area Sidebar
 */
function phoneservices_sidebar($vars)
{
    $sidebar = '
    <div class="sidebar-header">Phone Services</div>
    <ul class="menu">
        <li><a href="' . $vars['modulelink'] . '&action=dashboard"><i class="fas fa-tachometer-alt"></i> Dashboard</a></li>
        <li><a href="' . $vars['modulelink'] . '&action=api_config"><i class="fas fa-cogs"></i> API Configuration</a></li>
        <li><a href="' . $vars['modulelink'] . '&action=pricing"><i class="fas fa-dollar-sign"></i> Pricing Control</a></li>
        <li class="divider"></li>
        <li><a href="' . $vars['modulelink'] . '&action=numbers"><i class="fas fa-phone"></i> Numbers</a></li>
        <li><a href="' . $vars['modulelink'] . '&action=voip"><i class="fas fa-microphone"></i> VoIP</a></li>
        <li><a href="' . $vars['modulelink'] . '&action=sms"><i class="fas fa-envelope"></i> SMS</a></li>
        <li><a href="' . $vars['modulelink'] . '&action=esim"><i class="fas fa-sim-card"></i> eSIM</a></li>
        <li class="divider"></li>
        <li><a href="' . $vars['modulelink'] . '&action=usage"><i class="fas fa-chart-line"></i> Usage & Analytics</a></li>
        <li><a href="' . $vars['modulelink'] . '&action=transactions"><i class="fas fa-receipt"></i> Transactions</a></li>
        <li><a href="' . $vars['modulelink'] . '&action=users"><i class="fas fa-users"></i> Users</a></li>
        <li><a href="' . $vars['modulelink'] . '&action=logs"><i class="fas fa-file-alt"></i> System Logs</a></li>
    </ul>
    <style>
        .phoneservices-admin-wrapper { padding: 20px; }
        .sidebar-header { font-weight: bold; padding: 10px; background: #2d3a4a; color: #fff; }
        .menu { list-style: none; padding: 0; margin: 0; }
        .menu li a { display: block; padding: 10px 15px; color: #333; text-decoration: none; border-bottom: 1px solid #eee; }
        .menu li a:hover { background: #f5f5f5; }
        .menu li.divider { border-top: 1px solid #ddd; margin: 5px 0; }
    </style>';
    
    return $sidebar;
}

/**
 * Client Area Output
 */
function phoneservices_clientarea($vars)
{
    $action = isset($_GET['action']) ? $_GET['action'] : 'dashboard';
    $module = new Module();
    
    $allowedActions = ['dashboard', 'numbers', 'voip', 'sms', 'esim', 'usage', 'calls', 'messages'];
    if (!in_array($action, $allowedActions)) {
        $action = 'dashboard';
    }
    
    return $module->renderClientArea($vars, $action);
}
