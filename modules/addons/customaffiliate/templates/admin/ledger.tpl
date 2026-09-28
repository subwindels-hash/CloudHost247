<?php
/**
 * Admin > Service ledger
 *
 * One row per referred service: this is the table that decides whether the next
 * paid invoice earns the first-payment rate or the recurring rate.
 *
 * @var array $vars
 * @var array $notice
 * @var array $filters
 * @var array $rows
 */

require __DIR__ . '/_helpers.php';
?>
<div class="customaffiliate-ledger">

    <?php if (!empty($notice)) : ?>
        <div class="alert alert-<?php echo $e($notice['type']); ?>"><?php echo $e($notice['message']); ?></div>
    <?php endif; ?>

    <p class="text-muted">
        <code>first_commission_paid</code> is the flag the engine checks before every payout.
        Clearing it makes the next successful payment for that service earn the first-payment rate again.
    </p>

    <form method="get" action="<?php echo $moduleLink; ?>" class="form-inline" style="margin-bottom:15px;">
        <input type="hidden" name="module" value="customaffiliate">
        <input type="hidden" name="action" value="ledger">
        <div class="form-group">
            <input type="number" name="affiliate_id" class="form-control" placeholder="Affiliate ID"
                   value="<?php echo $filters['affiliate_id'] ?: ''; ?>">
        </div>
        <div class="form-group">
            <input type="number" name="service_id" class="form-control" placeholder="Service ID"
                   value="<?php echo $filters['service_id'] ?: ''; ?>">
        </div>
        <div class="form-group">
            <select name="first_paid" class="form-control">
                <option value="">Any state</option>
                <option value="1" <?php echo $filters['first_paid'] === '1' ? 'selected' : ''; ?>>First commission paid</option>
                <option value="0" <?php echo $filters['first_paid'] === '0' ? 'selected' : ''; ?>>Awaiting first commission</option>
            </select>
        </div>
        <button type="submit" class="btn btn-default">Filter</button>
        <a href="<?php echo $moduleLink; ?>&amp;action=ledger" class="btn btn-link">Reset</a>
    </form>

    <div class="table-responsive">
        <table class="table table-striped table-condensed">
            <thead>
                <tr>
                    <th>Service</th><th>Affiliate</th><th>Client</th><th>Product</th><th>Group</th>
                    <th>New client</th><th>First paid</th><th class="text-right">First</th>
                    <th class="text-right">Renewals</th><th class="text-right">Total</th><th>Last</th><th></th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($rows as $row) : ?>
                <tr>
                    <td>#<?php echo (int) $row->service_id; ?></td>
                    <td>#<?php echo (int) $row->affiliate_id; ?></td>
                    <td><a href="clientssummary.php?userid=<?php echo (int) $row->client_id; ?>">#<?php echo (int) $row->client_id; ?></a></td>
                    <td>#<?php echo (int) $row->product_id; ?></td>
                    <td>#<?php echo (int) $row->product_group_id; ?></td>
                    <td><?php echo $row->client_was_new ? 'yes' : 'no'; ?></td>
                    <td>
                        <?php if ($row->first_commission_paid) : ?>
                            <span class="label label-success">yes</span>
                        <?php else : ?>
                            <span class="label label-default">no</span>
                        <?php endif; ?>
                    </td>
                    <td class="text-right"><?php echo $money($row->first_commission_amount); ?></td>
                    <td class="text-right">
                        <?php echo $money($row->total_recurring_commission); ?>
                        <span class="text-muted">(<?php echo (int) $row->recurring_count; ?>)</span>
                    </td>
                    <td class="text-right"><strong><?php echo $money($row->total_commission); ?></strong></td>
                    <td><?php echo $e(substr((string) $row->last_commission_at, 0, 16) ?: '—'); ?></td>
                    <td class="text-right">
                        <?php if ($row->first_commission_paid) : ?>
                            <form method="post" action="<?php echo $moduleLink; ?>&amp;action=ledger" style="display:inline;"
                                  onsubmit="return confirm('Clear the first-payment flag for service #<?php echo (int) $row->service_id; ?>?');">
                                <?php echo \CustomAffiliate\Admin::tokenField(); ?>
                                <input type="hidden" name="operation" value="reset_first">
                                <input type="hidden" name="ledger_id" value="<?php echo (int) $row->id; ?>">
                                <button type="submit" class="btn btn-xs btn-warning">Reset first</button>
                            </form>
                        <?php endif; ?>
                    </td>
                </tr>
                <?php if (!empty($row->notes)) : ?>
                    <tr class="active">
                        <td colspan="12" class="small text-muted"><?php echo nl2br($e($row->notes)); ?></td>
                    </tr>
                <?php endif; ?>
            <?php endforeach; ?>
            <?php if (!$rows) : ?>
                <tr><td colspan="12" class="text-center text-muted">No referred services have been tracked yet.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>
