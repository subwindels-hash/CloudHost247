<?php
/**
 * Admin > Commissions (payout log)
 *
 * @var array $vars
 * @var array $notice
 * @var array $filters
 * @var array $payouts
 * @var array $totals
 */

require __DIR__ . '/_helpers.php';
?>
<div class="customaffiliate-commissions">

    <?php if (!empty($notice)) : ?>
        <div class="alert alert-<?php echo $e($notice['type']); ?>"><?php echo $e($notice['message']); ?></div>
    <?php endif; ?>

    <div class="row">
        <div class="col-sm-3"><div class="panel panel-default"><div class="panel-body text-center">
            <h4 style="margin:0;"><?php echo (int) $totals['payouts']; ?></h4><small class="text-muted">PAYOUTS</small>
        </div></div></div>
        <div class="col-sm-3"><div class="panel panel-default"><div class="panel-body text-center">
            <h4 style="margin:0;"><?php echo $money($totals['first']); ?></h4><small class="text-muted">FIRST PAYMENT</small>
        </div></div></div>
        <div class="col-sm-3"><div class="panel panel-default"><div class="panel-body text-center">
            <h4 style="margin:0;"><?php echo $money($totals['recurring']); ?></h4><small class="text-muted">RENEWALS</small>
        </div></div></div>
        <div class="col-sm-3"><div class="panel panel-default"><div class="panel-body text-center">
            <h4 style="margin:0;" class="text-danger">-<?php echo $money($totals['reversed']); ?></h4><small class="text-muted">REVERSED</small>
        </div></div></div>
    </div>

    <form method="get" action="<?php echo $moduleLink; ?>" class="form-inline" style="margin-bottom:15px;">
        <input type="hidden" name="module" value="customaffiliate">
        <input type="hidden" name="action" value="commissions">
        <div class="form-group">
            <input type="number" name="affiliate_id" class="form-control" placeholder="Affiliate ID"
                   value="<?php echo $filters['affiliate_id'] ?: ''; ?>">
        </div>
        <div class="form-group">
            <input type="number" name="service_id" class="form-control" placeholder="Service ID"
                   value="<?php echo $filters['service_id'] ?: ''; ?>">
        </div>
        <div class="form-group">
            <input type="number" name="invoice_id" class="form-control" placeholder="Invoice ID"
                   value="<?php echo $filters['invoice_id'] ?: ''; ?>">
        </div>
        <div class="form-group">
            <select name="commission_type" class="form-control">
                <option value="">Any type</option>
                <option value="first" <?php echo $filters['commission_type'] === 'first' ? 'selected' : ''; ?>>First payment</option>
                <option value="recurring" <?php echo $filters['commission_type'] === 'recurring' ? 'selected' : ''; ?>>Recurring</option>
            </select>
        </div>
        <div class="form-group">
            <select name="status" class="form-control">
                <option value="">Any status</option>
                <?php foreach (['pending' => 'Pending', 'credited' => 'Credited', 'reversed' => 'Reversed'] as $value => $label) : ?>
                    <option value="<?php echo $e($value); ?>" <?php echo $filters['status'] === $value ? 'selected' : ''; ?>>
                        <?php echo $e($label); ?>
                    </option>
                <?php endforeach; ?>
            </select>
        </div>
        <div class="form-group">
            <input type="date" name="from" class="form-control" value="<?php echo $e($filters['from']); ?>">
        </div>
        <div class="form-group">
            <input type="date" name="to" class="form-control" value="<?php echo $e($filters['to']); ?>">
        </div>
        <button type="submit" class="btn btn-default">Filter</button>
        <a href="<?php echo $moduleLink; ?>&amp;action=commissions" class="btn btn-link">Reset</a>
    </form>

    <div class="table-responsive">
        <table class="table table-striped table-condensed">
            <thead>
                <tr>
                    <th>Date</th><th>Affiliate</th><th>Client</th><th>Service</th><th>Invoice</th>
                    <th>Type</th><th class="text-right">Base</th><th class="text-right">Rate</th>
                    <th class="text-right">Commission</th><th>Status</th><th></th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($payouts as $payout) : ?>
                <tr>
                    <td><?php echo $e(substr((string) $payout->created_at, 0, 16)); ?></td>
                    <td>#<?php echo (int) $payout->affiliate_id; ?></td>
                    <td><a href="clientssummary.php?userid=<?php echo (int) $payout->client_id; ?>">#<?php echo (int) $payout->client_id; ?></a></td>
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
                    <td>
                        <span class="label label-<?php echo $e($statusLabel((string) $payout->status)); ?>">
                            <?php echo $e($payout->status); ?>
                        </span>
                        <?php if (!empty($payout->reason)) : ?>
                            <div class="text-muted small"><?php echo $e($payout->reason); ?></div>
                        <?php endif; ?>
                    </td>
                    <td class="text-right">
                        <?php if ($payout->status !== 'reversed') : ?>
                            <form method="post" action="<?php echo $moduleLink; ?>&amp;action=commissions" style="display:inline;"
                                  onsubmit="return confirm('Reverse this commission? The affiliate will be debited.');">
                                <?php echo \CustomAffiliate\Admin::tokenField(); ?>
                                <input type="hidden" name="operation" value="reverse">
                                <input type="hidden" name="payout_id" value="<?php echo (int) $payout->id; ?>">
                                <button type="submit" class="btn btn-xs btn-danger">Reverse</button>
                            </form>
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$payouts) : ?>
                <tr><td colspan="11" class="text-center text-muted">No commission records match these filters.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>
