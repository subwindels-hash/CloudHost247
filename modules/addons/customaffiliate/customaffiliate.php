<?php
/**
 * Custom Affiliate Commission Module for WHMCS.
 *
 * Replaces the default affiliate commission behaviour with a two-tier structure
 * that only applies to web hosting products:
 *
 *   - 50% of the FIRST successful payment for a referred hosting service
 *   - 20% of every RECURRING payment for that same client and service
 *   - 0%  for everything else (domains, RDP, SSL, email hosting, add-ons, ...)
 *
 * All rates, the product group scope and the edge-case behaviour are
 * configurable from Addons > Custom Affiliate Commission > Settings.
 *
 * @package    WHMCS
 * @subpackage CustomAffiliate
 * @author     CloudHost247
 * @license    https://www.whmcs.com/license/ WHMCS Eula
 * @version    2.0.0
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

require_once __DIR__ . '/bootstrap.php';

use CustomAffiliate\Admin;
use CustomAffiliate\Installer;
use CustomAffiliate\Logger;
use CustomAffiliate\Settings;

/**
 * Module metadata.
 *
 * Operational settings deliberately live in the module's own Settings page
 * rather than here: that allows a real multi-select product group picker,
 * validation, and changes without the addon configuration screen.
 *
 * @return array<string,mixed>
 */
function customaffiliate_config()
{
    return [
        'name'        => 'Custom Affiliate Commission',
        'description' => 'Pays affiliates 50% on the first payment and 20% on renewals, for web hosting products only. '
            . 'Configure everything under the module\'s Settings tab.',
        'author'      => 'CloudHost247',
        'language'    => 'english',
        'version'     => CUSTOMAFFILIATE_VERSION,
        'fields'      => [
            'setup_notice' => [
                'FriendlyName' => 'Configuration',
                'Type'         => 'System',
                'Description'  => 'Open the module (Addons &gt; Custom Affiliate Commission) and use the '
                    . '<strong>Settings</strong> tab to choose the commissionable product group and the '
                    . 'first/recurring commission rates.',
            ],
        ],
    ];
}

/**
 * Activation: create the schema, apply migrations, seed defaults and import any
 * 1.x configuration.
 *
 * @return array{status:string,description:string}
 */
function customaffiliate_activate()
{
    return Installer::install();
}

/**
 * Deactivation: keep every table. Commission records are financial history.
 *
 * @return array{status:string,description:string}
 */
function customaffiliate_deactivate()
{
    return Installer::uninstall();
}

/**
 * Upgrade: the installer is idempotent, so re-running it performs the upgrade.
 *
 * @param array<string,mixed> $vars
 */
function customaffiliate_upgrade($vars)
{
    $from = (string) ($vars['version'] ?? '');

    Logger::info('Upgrading module', [
        'action' => 'upgrade',
        'from'   => $from,
        'to'     => CUSTOMAFFILIATE_VERSION,
    ]);

    Installer::install();
}

/**
 * Admin area output.
 *
 * @param array<string,mixed> $vars
 */
function customaffiliate_output($vars)
{
    try {
        echo (new Admin($vars))->render();
    } catch (\Throwable $e) {
        Logger::error('Admin render failed', ['error' => $e->getMessage()]);

        echo '<div class="alert alert-danger">The module could not render this page: '
            . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8')
            . '</div>';
    }
}

/**
 * Sidebar shown alongside the module output.
 *
 * @param array<string,mixed> $vars
 * @return string
 */
function customaffiliate_sidebar($vars)
{
    $link = htmlspecialchars((string) ($vars['modulelink'] ?? ''), ENT_QUOTES, 'UTF-8');
    $enabled = Settings::isEnabled();
    $groups = Settings::productGroupIds();

    $status = $enabled
        ? ($groups ? '<span class="label label-success">Active</span>' : '<span class="label label-warning">Not configured</span>')
        : '<span class="label label-default">Disabled</span>';

    $html = '<div class="sidebar-header"><h3>Custom Affiliate Commission</h3></div>'
        . '<div class="sidebar-body">'
        . '<p>Status: ' . $status . '</p>'
        . '<p>First payment: <strong>' . number_format(Settings::firstRate(), 2) . '%</strong><br>'
        . 'Renewals: <strong>' . number_format(Settings::recurringRate(), 2) . '%</strong></p>'
        . '<ul class="nav nav-pills nav-stacked">';

    foreach (Admin::PAGES as $page => $label) {
        $html .= '<li><a href="' . $link . '&amp;action=' . $page . '">'
            . htmlspecialchars($label, ENT_QUOTES, 'UTF-8') . '</a></li>';
    }

    return $html . '</ul></div>';
}
