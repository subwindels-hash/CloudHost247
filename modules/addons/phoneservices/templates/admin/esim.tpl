<?php
/**
 * Admin > eSIM profiles
 *
 * @var array $vars
 * @var array $esims
 * @var string $csrf
 */

$e = static function ($value): string {
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
};
$statusClass = [
    'active'    => 'success',
    'pending'   => 'warning',
    'suspended' => 'warning',
    'expired'   => 'default',
    'cancelled' => 'danger',
];
?>
<div class="phoneservices-admin phoneservices-esim">

    <div class="ps-page-head">
        <h2>eSIM profiles</h2>
        <p class="ps-muted">Provisioned data profiles and their consumption.</p>
    </div>

    <div class="table-responsive">
        <table class="table table-striped table-condensed">
            <thead>
                <tr>
                    <th>Client</th>
                    <th>Plan</th>
                    <th>ICCID</th>
                    <th>Provider</th>
                    <th>Status</th>
                    <th>Data used</th>
                    <th>Activated</th>
                    <th>Expires</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($esims as $esim) : ?>
                <?php
                $total = (int) ($esim['data_total_mb'] ?? 0);
                $used = (int) ($esim['data_used_mb'] ?? 0);
                $pct = $total > 0 ? min(100, (int) round(($used / $total) * 100)) : 0;
                ?>
                <tr>
                    <td>
                        <?php if (!empty($esim['user_id'])) : ?>
                            <a href="clientssummary.php?userid=<?php echo (int) $esim['user_id']; ?>">#<?php echo (int) $esim['user_id']; ?></a>
                        <?php else : ?>
                            <span class="ps-muted">&mdash;</span>
                        <?php endif; ?>
                    </td>
                    <td>
                        <?php echo $e($esim['friendly_name'] ?: $esim['plan_id']); ?>
                        <div class="ps-muted small"><code><?php echo $e($esim['plan_id']); ?></code></div>
                    </td>
                    <td><code><?php echo $e($esim['iccid'] ?: '—'); ?></code></td>
                    <td><?php echo $e($esim['provider']); ?></td>
                    <td><span class="label label-<?php echo $e($statusClass[$esim['status']] ?? 'default'); ?>"><?php echo $e($esim['status']); ?></span></td>
                    <td style="min-width:160px;">
                        <div class="progress ps-progress">
                            <div class="progress-bar <?php echo $pct >= 90 ? 'progress-bar-danger' : 'progress-bar-success'; ?>"
                                 style="width: <?php echo $pct; ?>%"></div>
                        </div>
                        <span class="ps-muted small">
                            <?php echo $e($used); ?> MB<?php echo $total > 0 ? ' / ' . $e($total) . ' MB' : ''; ?>
                        </span>
                    </td>
                    <td><?php echo $e($esim['activated_at'] ?: '—'); ?></td>
                    <td><?php echo $e($esim['expires_at'] ?: '—'); ?></td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$esims) : ?>
                <tr><td colspan="8" class="text-center ps-muted">No eSIM profiles provisioned yet.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>
