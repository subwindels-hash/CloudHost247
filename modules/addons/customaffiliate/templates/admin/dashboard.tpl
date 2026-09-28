<?php
/**
 * Admin > Dashboard
 *
 * @var array $vars
 * @var array $totals
 * @var array $warnings
 * @var array $groupNames
 * @var float $firstRate
 * @var float $recurringRate
 * @var int   $delayDays
 * @var bool  $exclusive
 * @var bool  $enabled
 * @var array $recentPayouts
 * @var array $tables
 */

require __DIR__ . '/_helpers.php';
?>
<div class="customaffiliate-dashboard">

    <?php foreach ($warnings as $warning) : ?>
        <div class="alert alert-warning"><?php echo $e($warning); ?></div>
    <?php endforeach; ?>

    <div class="row">
        <div class="col-sm-3">
            <div class="panel panel-default"><div class="panel-body text-center">
                <h3 style="margin:0;"><?php echo $money($totals['first']); ?></h3>
                <small class="text-muted">FIRST PAYMENT COMMISSION</small>
            </div></div>
        </div>
        <div class="col-sm-3">
            <div class="panel panel-default"><div class="panel-body text-center">
                <h3 style="margin:0;"><?php echo $money($totals['recurring']); ?></h3>
                <small class="text-muted">RENEWAL COMMISSION</small>
            </div></div>
        </div>
        <div class="col-sm-3">
            <div class="panel panel-default"><div class="panel-body text-center">
                <h3 style="margin:0;"><?php echo $money($totals['pending']); ?></h3>
                <small class="text-muted">AWAITING CLEARANCE</small>
            </div></div>
        </div>
        <div class="col-sm-3">
            <div class="panel panel-default"><div class="panel-body text-center">
                <h3 style="margin:0;" class="text-danger">-<?php echo $money($totals['reversed']); ?></h3>
                <small class="text-muted">REVERSED</small>
            </div></div>
        </div>
    </div>

    <div class="row">
        <div class="col-md-5">
            <div class="panel panel-default">
                <div class="panel-heading"><strong>Active rules</strong></div>
                <table class="table table-condensed" style="margin-bottom:0;">
                    <tbody>
                        <tr>
                            <td>Module</td>
                            <td class="text-right">
                                <?php if ($enabled) : ?>
                                    <span class="label label-success">Enabled</span>
                                <?php else : ?>
                                    <span class="label label-default">Disabled</span>
                                <?php endif; ?>
                            </td>
                        </tr>
                        <tr>
                            <td>Commissionable groups</td>
                            <td class="text-right">
                                <?php echo $groupNames ? $e(implode(', ', $groupNames)) : '<span class="text-danger">none selected</span>'; ?>
                            </td>
                        </tr>
                        <tr><td>First payment rate</td><td class="text-right"><strong><?php echo $money($firstRate); ?>%</strong></td></tr>
                        <tr><td>Recurring rate</td><td class="text-right"><strong><?php echo $money($recurringRate); ?>%</strong></td></tr>
                        <tr><td>Clearing delay</td><td class="text-right"><?php echo (int) $delayDays; ?> day(s)</td></tr>
                        <tr>
                            <td>WHMCS default commission</td>
                            <td class="text-right">
                                <?php if ($exclusive) : ?>
                                    <span class="label label-success">suppressed</span>
                                <?php else : ?>
                                    <span class="label label-warning">also applies</span>
                                <?php endif; ?>
                            </td>
                        </tr>
                    </tbody>
                </table>
                <div class="panel-footer">
                    <a href="<?php echo $moduleLink; ?>&amp;action=settings" class="btn btn-primary btn-sm">Edit settings</a>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><strong>Database</strong></div>
                <table class="table table-condensed" style="margin-bottom:0;">
                    <tbody>
                    <?php foreach ($tables as $table => $present) : ?>
                        <tr>
                            <td><code><?php echo $e($table); ?></code></td>
                            <td class="text-right">
                                <?php if ($present) : ?>
                                    <span class="label label-success">ok</span>
                                <?php else : ?>
                                    <span class="label label-danger">missing</span>
                                <?php endif; ?>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        </div>

        <div class="col-md-7">
            <div class="panel panel-default">
                <div class="panel-heading"><strong>Latest commission</strong></div>
                <div class="table-responsive">
                    <table class="table table-condensed table-striped" style="margin-bottom:0;">
                        <thead>
                            <tr>
                                <th>Date</th><th>Affiliate</th><th>Service</th><th>Invoice</th>
                                <th>Type</th><th class="text-right">Base</th><th class="text-right">Rate</th>
                                <th class="text-right">Commission</th><th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                        <?php foreach ($recentPayouts as $payout) : ?>
                            <tr>
                                <td><?php echo $e(substr((string) $payout->created_at, 0, 16)); ?></td>
                                <td>#<?php echo (int) $payout->affiliate_id; ?></td>
                                <td>#<?php echo (int) $payout->service_id; ?></td>
                                <td><a href="invoices.php?action=edit&amp;id=<?php echo (int) $payout->invoice_id; ?>">#<?php echo (int) $payout->invoice_id; ?></a></td>
                                <td>
                                    <span class="label label-<?php echo $payout->commission_type === 'first' ? 'primary' : 'info'; ?>">
                                        <?php echo $e($payout->commission_type); ?>
                                    </span>
                                </td>
                                <td class="text-right"><?php echo $money($payout->base_amount); ?></td>
                                <td class="text-right"><?php echo $money($payout->rate); ?>%</td>
                                <td class="text-right"><strong><?php echo $money($payout->amount); ?></strong></td>
                                <td><span class="label label-<?php echo $e($statusLabel((string) $payout->status)); ?>"><?php echo $e($payout->status); ?></span></td>
                            </tr>
                        <?php endforeach; ?>
                        <?php if (!$recentPayouts) : ?>
                            <tr><td colspan="9" class="text-center text-muted">No commission has been paid yet.</td></tr>
                        <?php endif; ?>
                        </tbody>
                    </table>
                </div>
                <div class="panel-footer">
                    <a href="<?php echo $moduleLink; ?>&amp;action=commissions" class="btn btn-default btn-sm">All commissions</a>
                    <a href="<?php echo $moduleLink; ?>&amp;action=ledger" class="btn btn-default btn-sm">Service ledger</a>
                </div>
            </div>
        </div>
    </div>
</div>
