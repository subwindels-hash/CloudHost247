<?php
/**
 * Admin > VoIP call logs
 *
 * @var array $vars
 * @var array $calls  call rows
 * @var array $stats  ['total','total_minutes','total_cost','avg_seconds','failed','inbound','outbound']
 * @var string $csrf
 */

$e = static function ($value): string {
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
};
$statusClass = [
    'connected' => 'success',
    'ringing'   => 'info',
    'ended'     => 'default',
    'failed'    => 'danger',
];
$fmtDuration = static function (int $seconds): string {
    return sprintf('%02d:%02d', intdiv($seconds, 60), $seconds % 60);
};
?>
<div class="phoneservices-admin phoneservices-voip">

    <div class="ps-page-head">
        <h2>VoIP</h2>
        <p class="ps-muted">Call detail records across all clients (latest 200).</p>
    </div>

    <div class="row ps-stats">
        <div class="col-sm-2"><div class="stat-card"><div class="stat-value"><?php echo (int) $stats['total']; ?></div><div class="stat-label">Calls</div></div></div>
        <div class="col-sm-2"><div class="stat-card"><div class="stat-value"><?php echo $e($stats['total_minutes']); ?></div><div class="stat-label">Minutes</div></div></div>
        <div class="col-sm-2"><div class="stat-card"><div class="stat-value"><?php echo $e(number_format((float) $stats['total_cost'], 2)); ?></div><div class="stat-label">Cost</div></div></div>
        <div class="col-sm-2"><div class="stat-card"><div class="stat-value"><?php echo (int) $stats['inbound']; ?></div><div class="stat-label">Inbound</div></div></div>
        <div class="col-sm-2"><div class="stat-card"><div class="stat-value"><?php echo (int) $stats['outbound']; ?></div><div class="stat-label">Outbound</div></div></div>
        <div class="col-sm-2"><div class="stat-card"><div class="stat-value text-danger"><?php echo (int) $stats['failed']; ?></div><div class="stat-label">Failed</div></div></div>
    </div>

    <div class="table-responsive">
        <table class="table table-striped table-condensed">
            <thead>
                <tr>
                    <th>Started</th>
                    <th>Client</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Dir</th>
                    <th>Status</th>
                    <th class="text-right">Duration</th>
                    <th class="text-right">Cost</th>
                    <th>Provider</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($calls as $call) : ?>
                <tr>
                    <td><?php echo $e($call['started_at']); ?></td>
                    <td>
                        <?php if (!empty($call['user_id'])) : ?>
                            <a href="clientssummary.php?userid=<?php echo (int) $call['user_id']; ?>">#<?php echo (int) $call['user_id']; ?></a>
                        <?php else : ?>
                            <span class="ps-muted">&mdash;</span>
                        <?php endif; ?>
                    </td>
                    <td><?php echo $e($call['from_number']); ?></td>
                    <td><?php echo $e($call['to_number']); ?></td>
                    <td><?php echo $e($call['direction']); ?></td>
                    <td>
                        <span class="label label-<?php echo $e($statusClass[$call['status']] ?? 'default'); ?>">
                            <?php echo $e($call['status']); ?>
                        </span>
                    </td>
                    <td class="text-right"><?php echo $e($fmtDuration((int) ($call['duration'] ?? 0))); ?></td>
                    <td class="text-right"><?php echo $e(number_format((float) ($call['cost'] ?? 0), 4)); ?></td>
                    <td><?php echo $e($call['provider']); ?></td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$calls) : ?>
                <tr><td colspan="9" class="text-center ps-muted">No calls recorded yet.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>
