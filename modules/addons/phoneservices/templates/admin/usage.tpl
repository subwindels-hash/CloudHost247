<?php
/**
 * Admin > Usage & analytics
 *
 * @var array $vars
 * @var array $reports [['date','service_type','count','total_used'], ...]
 * @var array $stats   system counters from UsageService::getSystemStats()
 */

$e = static function ($value): string {
    return htmlspecialchars((string) ($value ?? ''), ENT_QUOTES, 'UTF-8');
};
?>
<div class="phoneservices-admin phoneservices-usage">

    <div class="ps-page-head">
        <h2>Usage &amp; analytics</h2>
        <p class="ps-muted">System-wide consumption, grouped by day and service.</p>
    </div>

    <div class="row ps-stats">
        <div class="col-sm-3"><div class="stat-card"><div class="stat-value"><?php echo (int) $stats['total_calls']; ?></div><div class="stat-label">Calls</div></div></div>
        <div class="col-sm-3"><div class="stat-card"><div class="stat-value"><?php echo (int) $stats['total_messages']; ?></div><div class="stat-label">Messages</div></div></div>
        <div class="col-sm-3"><div class="stat-card"><div class="stat-value"><?php echo (int) $stats['total_esims']; ?></div><div class="stat-label">eSIMs</div></div></div>
        <div class="col-sm-3"><div class="stat-card"><div class="stat-value"><?php echo $e(number_format((float) $stats['total_revenue'], 2)); ?></div><div class="stat-label">Revenue</div></div></div>
    </div>

    <?php if (!empty($stats['revenue_by_service'])) : ?>
        <div class="panel panel-default">
            <div class="panel-heading"><strong>Revenue by service</strong></div>
            <table class="table table-condensed" style="margin-bottom:0;">
                <tbody>
                <?php foreach ($stats['revenue_by_service'] as $service => $row) : ?>
                    <tr>
                        <td><?php echo $e(ucfirst((string) $service)); ?></td>
                        <td class="text-right ps-muted"><?php echo $e(number_format((float) ($row['count'] ?? 0))); ?> txn</td>
                        <td class="text-right"><?php echo $e(number_format((float) ($row['revenue'] ?? 0), 2)); ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    <?php endif; ?>

    <div class="table-responsive">
        <table class="table table-striped table-condensed">
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Service</th>
                    <th class="text-right">Events</th>
                    <th class="text-right">Total used</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($reports as $report) : ?>
                <tr>
                    <td><?php echo $e($report['date']); ?></td>
                    <td><?php echo $e(ucfirst((string) $report['service_type'])); ?></td>
                    <td class="text-right"><?php echo $e(number_format((float) $report['count'])); ?></td>
                    <td class="text-right"><?php echo $e(number_format((float) $report['total_used'], 2)); ?></td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$reports) : ?>
                <tr><td colspan="4" class="text-center ps-muted">No usage recorded yet.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>
