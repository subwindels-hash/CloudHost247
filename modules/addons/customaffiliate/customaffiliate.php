<?php

/**
 * Custom Affiliate Commission Module for WHMCS
 *
 * Modifies default affiliate commission system with custom rules:
 * - 50% commission on first successful payment for Web Hosting products
 * - 20% commission on recurring payments for same client/service
 * - Excludes all other product types
 *
 * @package    WHMCS
 * @author     System Administrator
 * @copyright  Copyright (c) WHMCS Limited 2005-2023
 * @license    https://www.whmcs.com/license/ WHMCS Eula
 * @version    $1.0.0$
 * @link       https://www.whmcs.com/
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

use WHMCS\Database\Capsule;

/**
 * Module metadata and configuration
 *
 * @return array
 */
function customaffiliate_config()
{
    return [
        'name'        => 'Custom Affiliate Commission',
        'description' => 'Custom affiliate commission module with 50% first payment and 20% recurring commission for Web Hosting products only.',
        'author'      => 'WHMCS Developer',
        'language'    => 'english',
        'version'     => '1.0.0',
        'fields'      => [
            'product_group_id' => [
                'FriendlyName' => 'Web Hosting Product Group',
                'Type'         => 'dropdown',
                'Options'      => customaffiliate_get_product_groups(),
                'Description'  => 'Select the product group that represents Web Hosting services. Only products in this group will generate affiliate commissions.',
                'Default'      => '',
            ],
            'first_commission_percent' => [
                'FriendlyName' => 'First Commission Percentage',
                'Type'         => 'text',
                'Size'         => '10',
                'Default'      => '50',
                'Description'  => 'Commission percentage for the FIRST successful payment (default: 50).',
            ],
            'recurring_commission_percent' => [
                'FriendlyName' => 'Recurring Commission Percentage',
                'Type'         => 'text',
                'Size'         => '10',
                'Default'      => '20',
                'Description'  => 'Commission percentage for RECURRING payments (default: 20).',
            ],
            'enable_logging' => [
                'FriendlyName' => 'Enable Debug Logging',
                'Type'         => 'yesno',
                'Description'  => 'Enable debug logging to WHMCS Activity Log for troubleshooting.',
                'Default'      => 'on',
            ],
        ],
    ];
}

/**
 * Helper function to get product groups for dropdown
 *
 * @return array
 */
function customaffiliate_get_product_groups()
{
    $groups = [];
    try {
        $results = Capsule::table('tblproductgroups')
            ->orderBy('name')
            ->get();
        foreach ($results as $group) {
            $groups[$group->id] = $group->name;
        }
    } catch (\Exception $e) {
        // Return empty if query fails
    }
    return $groups;
}

/**
 * Module activation - create custom table
 *
 * @return array
 */
function customaffiliate_activate()
{
    try {
        // Create custom table to track first commission status per service/affiliate
        if (!Capsule::schema()->hasTable('mod_customaffiliate_commissions')) {
            Capsule::schema()->create('mod_customaffiliate_commissions', function ($table) {
                $table->increments('id');
                $table->integer('service_id')->unsigned()->default(0);
                $table->integer('affiliate_id')->unsigned()->default(0);
                $table->integer('client_id')->unsigned()->default(0);
                $table->integer('product_id')->unsigned()->default(0);
                $table->decimal('first_commission_amount', 16, 2)->default(0.00);
                $table->boolean('first_commission_paid')->default(false);
                $table->integer('first_commission_invoice_id')->unsigned()->nullable();
                $table->timestamp('first_commission_paid_at')->nullable();
                $table->decimal('total_recurring_commission', 16, 2)->default(0.00);
                $table->integer('recurring_count')->unsigned()->default(0);
                $table->timestamp('last_commission_at')->nullable();
                $table->text('notes')->nullable();
                $table->timestamps();

                // Indexes for performance
                $table->index('service_id');
                $table->index('affiliate_id');
                $table->index('client_id');
                $table->index('product_id');
                $table->index('first_commission_paid');
                $table->unique(['service_id', 'affiliate_id'], 'svc_aff_unique');
            });
        }

        // Create log table for audit trail
        if (!Capsule::schema()->hasTable('mod_customaffiliate_log')) {
            Capsule::schema()->create('mod_customaffiliate_log', function ($table) {
                $table->increments('id');
                $table->integer('service_id')->unsigned()->nullable();
                $table->integer('affiliate_id')->unsigned()->nullable();
                $table->integer('invoice_id')->unsigned()->nullable();
                $table->string('action', 50)->default('');
                $table->decimal('amount', 16, 2)->default(0.00);
                $table->decimal('percentage', 5, 2)->default(0.00);
                $table->text('description')->nullable();
                $table->text('debug_data')->nullable();
                $table->timestamp('created_at')->useCurrent();

                $table->index('service_id');
                $table->index('affiliate_id');
                $table->index('invoice_id');
                $table->index('action');
            });
        }

        return [
            'status'      => 'success',
            'description' => 'Custom Affiliate Commission module activated successfully. Custom tables created.',
        ];
    } catch (\Exception $e) {
        return [
            'status'      => 'error',
            'description' => 'Unable to activate module: ' . $e->getMessage(),
        ];
    }
}

/**
 * Module deactivation
 *
 * @return array
 */
function customaffiliate_deactivate()
{
    // We intentionally do NOT drop tables to preserve data
    return [
        'status'      => 'success',
        'description' => 'Custom Affiliate Commission module deactivated. Tables preserved for data integrity.',
    ];
}

/**
 * Module upgrade
 *
 * @param array $vars
 * @return void
 */
function customaffiliate_upgrade($vars)
{
    $version = $vars['version'];

    // Future upgrade paths can be handled here
    if ($version < '1.0.0') {
        // Any migration logic for future versions
    }
}

/**
 * Admin area output
 *
 * @param array $vars
 * @return string
 */
function customaffiliate_output($vars)
{
    $moduleLink = $vars['modulelink'];
    $version    = $vars['version'];
    $LANG       = $vars['_lang'];

    // Get statistics for admin dashboard
    try {
        $stats = [
            'total_tracked_services' => Capsule::table('mod_customaffiliate_commissions')->count(),
            'first_commissions_paid' => Capsule::table('mod_customaffiliate_commissions')
                ->where('first_commission_paid', 1)
                ->count(),
            'total_first_amount' => Capsule::table('mod_customaffiliate_commissions')
                ->where('first_commission_paid', 1)
                ->sum('first_commission_amount'),
            'total_recurring_amount' => Capsule::table('mod_customaffiliate_commissions')
                ->sum('total_recurring_commission'),
            'recent_activity' => Capsule::table('mod_customaffiliate_log')
                ->orderBy('created_at', 'desc')
                ->limit(25)
                ->get(),
        ];
    } catch (\Exception $e) {
        $stats = [
            'total_tracked_services' => 0,
            'first_commissions_paid' => 0,
            'total_first_amount' => 0,
            'total_recurring_amount' => 0,
            'recent_activity' => [],
        ];
    }

    $html = '
    <div class="panel panel-default">
        <div class="panel-heading">
            <h3 class="panel-title">Custom Affiliate Commission Dashboard</h3>
        </div>
        <div class="panel-body">
            <div class="row">
                <div class="col-sm-3">
                    <div class="alert alert-info text-center">
                        <h4>' . number_format($stats['total_tracked_services']) . '</h4>
                        <p>Tracked Services</p>
                    </div>
                </div>
                <div class="col-sm-3">
                    <div class="alert alert-success text-center">
                        <h4>' . number_format($stats['first_commissions_paid']) . '</h4>
                        <p>First Commissions Paid</p>
                    </div>
                </div>
                <div class="col-sm-3">
                    <div class="alert alert-warning text-center">
                        <h4>$' . number_format($stats['total_first_amount'], 2) . '</h4>
                        <p>Total First Commission</p>
                    </div>
                </div>
                <div class="col-sm-3">
                    <div class="alert alert-primary text-center" style="background-color:#337ab7;color:white;">
                        <h4>$' . number_format($stats['total_recurring_amount'], 2) . '</h4>
                        <p>Total Recurring Commission</p>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="panel panel-default">
        <div class="panel-heading">
            <h3 class="panel-title">Recent Commission Activity (Last 25)</h3>
        </div>
        <div class="panel-body">
            <div class="table-responsive">
                <table class="table table-striped table-bordered">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Action</th>
                            <th>Service ID</th>
                            <th>Affiliate ID</th>
                            <th>Invoice ID</th>
                            <th>Amount</th>
                            <th>%</th>
                            <th>Description</th>
                        </tr>
                    </thead>
                    <tbody>';

    if (count($stats['recent_activity']) > 0) {
        foreach ($stats['recent_activity'] as $log) {
            $html .= '
                        <tr>
                            <td>' . $log->created_at . '</td>
                            <td><span class="label label-default">' . $log->action . '</span></td>
                            <td>' . ($log->service_id ?: '-') . '</td>
                            <td>' . ($log->affiliate_id ?: '-') . '</td>
                            <td>' . ($log->invoice_id ?: '-') . '</td>
                            <td>$' . number_format($log->amount, 2) . '</td>
                            <td>' . number_format($log->percentage, 2) . '%</td>
                            <td>' . $log->description . '</td>
                        </tr>';
        }
    } else {
        $html .= '
                        <tr>
                            <td colspan="8" class="text-center">No activity recorded yet.</td>
                        </tr>';
    }

    $html .= '
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <div class="panel panel-default">
        <div class="panel-heading">
            <h3 class="panel-title">Module Configuration Summary</h3>
        </div>
        <div class="panel-body">
            <table class="table table-bordered">
                <tr>
                    <td width="30%"><strong>Web Hosting Product Group</strong></td>
                    <td>' . ($vars['product_group_id'] ? customaffiliate_get_group_name($vars['product_group_id']) : '<span class="text-danger">Not configured!</span>') . '</td>
                </tr>
                <tr>
                    <td><strong>First Commission Percentage</strong></td>
                    <td>' . ($vars['first_commission_percent'] ?: '50') . '%</td>
                </tr>
                <tr>
                    <td><strong>Recurring Commission Percentage</strong></td>
                    <td>' . ($vars['recurring_commission_percent'] ?: '20') . '%</td>
                </tr>
                <tr>
                    <td><strong>Debug Logging</strong></td>
                    <td>' . ($vars['enable_logging'] ? 'Enabled' : 'Disabled') . '</td>
                </tr>
            </table>
            <p><a href="configaddonmods.php" class="btn btn-default">Edit Settings</a></p>
        </div>
    </div>';

    return $html;
}

/**
 * Helper to get group name
 *
 * @param int $groupId
 * @return string
 */
function customaffiliate_get_group_name($groupId)
{
    try {
        $group = Capsule::table('tblproductgroups')
            ->where('id', $groupId)
            ->first();
        return $group ? $group->name . ' (ID: ' . $groupId . ')' : 'Unknown Group (ID: ' . $groupId . ')';
    } catch (\Exception $e) {
        return 'Group ID: ' . $groupId;
    }
}
