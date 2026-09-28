<?php
/**
 * Admin > Transaction monitoring
 *
 * @var array $vars
 * @var array $filters       ['user_id','status','service_type','from','to']
 * @var array $transactions
 * @var array $totals        ['count','total','completed','pending','refunded']
 */

$moduleLink = htmlspecialchars((string) ($vars['modulelink'] ?? ''), ENT_QUOTES, 'UTF-8');
$e = static function ($value): string {
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
};
$statusClass = [
    'completed' => 'success',
    'pending'   => 'warning',
    'failed'    => 'danger',
    'refunded'  => 'info',
];
$services = ['', 'number', 'call', 'sms', 'whatsapp', 'email', 'esim', 'topup'];
$statuses = ['', 'pending', 'completed', 'failed', 'refunded'];
?>
<div class="phoneservices-admin phoneservices-transactions">

    <div class="ps-page-head">
        <h2>Transactions</h2>
        <p class="ps-muted">Every billable event raised by the platform.</p>
    </div>

    <div class="row ps-stats">
        <div class="col-sm-3"><div class="stat-card"><div class="stat-value"><?php echo (int) $totals['count']; ?></div><div class="stat-label">Transactions</div></div></div>
        <div class="col-sm-3"><div class="stat-card"><div class="stat-value"><?php echo $e(number_format((float) $totals['completed'], 2)); ?></div><div class="stat-label">Completed</div></div></div>
        <div class="col-sm-3"><div class="stat-card"><div class="stat-value"><?php echo $e(number_format((float) $totals['pending'], 2)); ?></div><div class="stat-label">Pending</div></div></div>
        <div class="col-sm-3"><div class="stat-card"><div class="stat-value"><?php echo $e(number_format((float) $totals['refunded'], 2)); ?></div><div class="stat-label">Refunded</div></div></div>
    </div>

    <form method="get" action="<?php echo $moduleLink; ?>" class="form-inline ps-filter-bar">
        <input type="hidden" name="module" value="phoneservices">
        <input type="hidden" name="action" value="transactions">

        <div class="form-group">
            <label class="sr-only" for="ps-tx-user">Client ID</label>
            <input type="number" id="ps-tx-user" name="user_id" class="form-control" placeholder="Client ID"
                   value="<?php echo $filters['user_id'] ? (int) $filters['user_id'] : ''; ?>">
        </div>
        <div class="form-group">
            <select name="service_type" class="form-control">
                <?php foreach ($services as $service) : ?>
                    <option value="<?php echo $e($service); ?>" <?php echo ($filters['service_type'] ?? '') === $service ? 'selected' : ''; ?>>
                        <?php echo $service === '' ? 'All services' : $e(ucfirst($service)); ?>
                    </option>
                <?php endforeach; ?>
            </select>
        </div>
        <div class="form-group">
            <select name="status" class="form-control">
                <?php foreach ($statuses as $status) : ?>
                    <option value="<?php echo $e($status); ?>" <?php echo ($filters['status'] ?? '') === $status ? 'selected' : ''; ?>>
                        <?php echo $status === '' ? 'Any status' : $e(ucfirst($status)); ?>
                    </option>
                <?php endforeach; ?>
            </select>
        </div>
        <div class="form-group">
            <input type="date" name="from" class="form-control" value="<?php echo $e($filters['from'] ?? ''); ?>">
        </div>
        <div class="form-group">
            <input type="date" name="to" class="form-control" value="<?php echo $e($filters['to'] ?? ''); ?>">
        </div>
        <button type="submit" class="btn btn-default">Filter</button>
        <a href="<?php echo $moduleLink; ?>&amp;action=transactions" class="btn btn-link">Reset</a>
    </form>

    <div class="table-responsive">
        <table class="table table-striped table-condensed">
            <thead>
                <tr>
                    <th>Date</th>
                    <th>ID</th>
                    <th>Client</th>
                    <th>Service</th>
                    <th>Reference</th>
                    <th class="text-right">Amount</th>
                    <th>Currency</th>
                    <th>Status</th>
                    <th>Invoice</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($transactions as $transaction) : ?>
                <tr>
                    <td><?php echo $e($transaction['created_at']); ?></td>
                    <td>#<?php echo (int) $transaction['id']; ?></td>
                    <td><a href="clientssummary.php?userid=<?php echo (int) $transaction['user_id']; ?>">#<?php echo (int) $transaction['user_id']; ?></a></td>
                    <td><?php echo $e($transaction['service_type']); ?></td>
                    <td><code><?php echo $e($transaction['reference_id']); ?></code></td>
                    <td class="text-right"><?php echo $e(number_format((float) $transaction['amount'], 4)); ?></td>
                    <td><?php echo $e($transaction['currency']); ?></td>
                    <td>
                        <span class="label label-<?php echo $e($statusClass[$transaction['status']] ?? 'default'); ?>">
                            <?php echo $e($transaction['status']); ?>
                        </span>
                    </td>
                    <td>
                        <?php if (!empty($transaction['invoice_id'])) : ?>
                            <a href="invoices.php?action=edit&amp;id=<?php echo (int) $transaction['invoice_id']; ?>">
                                #<?php echo (int) $transaction['invoice_id']; ?>
                            </a>
                        <?php else : ?>
                            <span class="ps-muted">&mdash;</span>
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$transactions) : ?>
                <tr><td colspan="9" class="text-center ps-muted">No transactions match the current filters.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>
