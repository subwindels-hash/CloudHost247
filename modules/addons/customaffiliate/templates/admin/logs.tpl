<?php
/**
 * Admin > Audit log
 *
 * @var array  $vars
 * @var string $level
 * @var array  $logs
 */

require __DIR__ . '/_helpers.php';

$levelClass = ['error' => 'danger', 'warning' => 'warning', 'info' => 'info', 'debug' => 'default'];
?>
<div class="customaffiliate-logs">

    <div class="btn-group" style="margin-bottom:15px;">
        <?php foreach (['' => 'All', 'error' => 'Errors', 'warning' => 'Warnings', 'info' => 'Info', 'debug' => 'Debug'] as $value => $label) : ?>
            <a class="btn btn-default <?php echo $level === $value ? 'active' : ''; ?>"
               href="<?php echo $moduleLink; ?>&amp;action=logs<?php echo $value !== '' ? '&amp;level=' . $e($value) : ''; ?>">
                <?php echo $e($label); ?>
            </a>
        <?php endforeach; ?>
    </div>

    <div class="table-responsive">
        <table class="table table-striped table-condensed">
            <thead>
                <tr>
                    <th>Date</th><th>Level</th><th>Action</th><th>Service</th><th>Affiliate</th>
                    <th>Invoice</th><th class="text-right">Amount</th><th class="text-right">Rate</th><th>Description</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($logs as $log) : ?>
                <tr>
                    <td style="white-space:nowrap;"><?php echo $e(substr((string) $log->created_at, 0, 16)); ?></td>
                    <td><span class="label label-<?php echo $e($levelClass[$log->level] ?? 'default'); ?>"><?php echo $e($log->level); ?></span></td>
                    <td><code><?php echo $e($log->action); ?></code></td>
                    <td><?php echo $log->service_id ? '#' . (int) $log->service_id : '—'; ?></td>
                    <td><?php echo $log->affiliate_id ? '#' . (int) $log->affiliate_id : '—'; ?></td>
                    <td><?php echo $log->invoice_id ? '#' . (int) $log->invoice_id : '—'; ?></td>
                    <td class="text-right"><?php echo $money($log->amount); ?></td>
                    <td class="text-right"><?php echo $money($log->percentage); ?>%</td>
                    <td><?php echo $e($log->description); ?></td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$logs) : ?>
                <tr><td colspan="9" class="text-center text-muted">Nothing logged yet.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>
