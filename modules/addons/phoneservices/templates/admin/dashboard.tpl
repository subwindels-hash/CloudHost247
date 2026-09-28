<?php
/**
 * Admin > Dashboard
 *
 * @var array $vars
 * @var array $stats     UsageService::getSystemStats()
 * @var array $providers ProviderFactory::healthCheck()
 * @var array $toggles   [service => bool]
 * @var array $tables    Installer::tableStatus()
 * @var array $recent    recent error log entries
 */

$moduleLink = htmlspecialchars((string) ($vars['modulelink'] ?? ''), ENT_QUOTES, 'UTF-8');
$e = static function ($value): string {
    return htmlspecialchars((string) ($value ?? ''), ENT_QUOTES, 'UTF-8');
};

$cards = [
    ['label' => 'Numbers',      'value' => (int) $stats['total_numbers'],  'sub' => (int) $stats['active_numbers'] . ' active', 'page' => 'numbers'],
    ['label' => 'Calls',        'value' => (int) $stats['total_calls'],    'sub' => 'all time',                                  'page' => 'voip'],
    ['label' => 'Messages',     'value' => (int) $stats['total_messages'], 'sub' => 'all time',                                  'page' => 'sms'],
    ['label' => 'eSIMs',        'value' => (int) $stats['total_esims'],    'sub' => (int) $stats['active_esims'] . ' active',    'page' => 'esim'],
    ['label' => 'Transactions', 'value' => (int) $stats['total_transactions'], 'sub' => 'recorded',                              'page' => 'transactions'],
    ['label' => 'Revenue',      'value' => number_format((float) $stats['total_revenue'], 2), 'sub' => 'completed',              'page' => 'transactions'],
];
?>
<div class="phoneservices-admin phoneservices-dashboard">

    <div class="ps-page-head">
        <h2>Phone Services</h2>
        <p class="ps-muted">Platform health and activity at a glance.</p>
    </div>

    <div class="row ps-stats">
        <?php foreach ($cards as $card) : ?>
            <div class="col-sm-2">
                <a class="stat-card" style="display:block;text-decoration:none;color:inherit;"
                   href="<?php echo $moduleLink; ?>&amp;action=<?php echo $e($card['page']); ?>">
                    <div class="stat-value"><?php echo $e($card['value']); ?></div>
                    <div class="stat-label"><?php echo $e($card['label']); ?></div>
                    <div class="ps-muted small"><?php echo $e($card['sub']); ?></div>
                </a>
            </div>
        <?php endforeach; ?>
    </div>

    <div class="row">
        <div class="col-md-5">
            <div class="panel panel-default">
                <div class="panel-heading"><strong>Services</strong></div>
                <div class="panel-body">
                    <?php foreach ($toggles as $service => $enabled) : ?>
                        <span class="label label-<?php echo $enabled ? 'success' : 'default'; ?>" style="margin-right:6px;">
                            <?php echo $e(ucfirst((string) $service)); ?>: <?php echo $enabled ? 'on' : 'off'; ?>
                        </span>
                    <?php endforeach; ?>
                    <p style="margin-top:10px;margin-bottom:0;">
                        <a href="<?php echo $moduleLink; ?>&amp;action=api_config">Configure services &rarr;</a>
                    </p>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><strong>Providers</strong></div>
                <table class="table table-condensed" style="margin-bottom:0;">
                    <tbody>
                    <?php foreach ($providers as $provider) : ?>
                        <tr>
                            <td><?php echo $e($provider['label']); ?></td>
                            <td class="text-right">
                                <?php if (!empty($provider['reachable'])) : ?>
                                    <span class="label label-success">reachable</span>
                                <?php elseif (!empty($provider['configured'])) : ?>
                                    <span class="label label-danger">unreachable</span>
                                <?php else : ?>
                                    <span class="label label-default">not configured</span>
                                <?php endif; ?>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><strong>Database</strong></div>
                <div class="panel-body">
                    <?php $missing = array_keys(array_filter($tables, static function ($ok) { return !$ok; })); ?>
                    <?php if ($missing) : ?>
                        <div class="alert alert-danger" style="margin-bottom:0;">
                            Missing tables: <?php echo $e(implode(', ', $missing)); ?>.
                            Deactivate and reactivate the module to repair the schema.
                        </div>
                    <?php else : ?>
                        <span class="label label-success">All <?php echo (int) count($tables); ?> tables present</span>
                    <?php endif; ?>
                </div>
            </div>
        </div>

        <div class="col-md-7">
            <div class="panel panel-default">
                <div class="panel-heading"><strong>Recent calls</strong></div>
                <table class="table table-condensed" style="margin-bottom:0;">
                    <thead>
                        <tr><th>From</th><th>To</th><th>Status</th><th class="text-right">Duration</th></tr>
                    </thead>
                    <tbody>
                    <?php foreach ($stats['recent_calls'] as $call) : ?>
                        <tr>
                            <td><?php echo $e($call['from_number']); ?></td>
                            <td><?php echo $e($call['to_number']); ?></td>
                            <td><span class="label label-default"><?php echo $e($call['status']); ?></span></td>
                            <td class="text-right"><?php echo (int) $call['duration']; ?>s</td>
                        </tr>
                    <?php endforeach; ?>
                    <?php if (!$stats['recent_calls']) : ?>
                        <tr><td colspan="4" class="text-center ps-muted">No calls yet.</td></tr>
                    <?php endif; ?>
                    </tbody>
                </table>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading"><strong>Recent transactions</strong></div>
                <table class="table table-condensed" style="margin-bottom:0;">
                    <thead>
                        <tr><th>ID</th><th>Client</th><th>Service</th><th class="text-right">Amount</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                    <?php foreach ($stats['recent_transactions'] as $transaction) : ?>
                        <tr>
                            <td>#<?php echo (int) $transaction['id']; ?></td>
                            <td>#<?php echo (int) $transaction['user_id']; ?></td>
                            <td><?php echo $e($transaction['service_type']); ?></td>
                            <td class="text-right"><?php echo $e(number_format((float) $transaction['amount'], 2)); ?></td>
                            <td><?php echo $e($transaction['status']); ?></td>
                        </tr>
                    <?php endforeach; ?>
                    <?php if (!$stats['recent_transactions']) : ?>
                        <tr><td colspan="5" class="text-center ps-muted">No transactions yet.</td></tr>
                    <?php endif; ?>
                    </tbody>
                </table>
            </div>

            <div class="panel panel-<?php echo $recent ? 'danger' : 'default'; ?>">
                <div class="panel-heading"><strong>Recent errors</strong></div>
                <table class="table table-condensed" style="margin-bottom:0;">
                    <tbody>
                    <?php foreach ($recent as $log) : ?>
                        <tr>
                            <td class="ps-muted" style="white-space:nowrap;"><?php echo $e($log['created_at']); ?></td>
                            <td><?php echo $e($log['message']); ?></td>
                        </tr>
                    <?php endforeach; ?>
                    <?php if (!$recent) : ?>
                        <tr><td class="text-center ps-muted">No errors logged.</td></tr>
                    <?php endif; ?>
                    </tbody>
                </table>
                <div class="panel-footer text-right">
                    <a href="<?php echo $moduleLink; ?>&amp;action=logs">View all logs &rarr;</a>
                </div>
            </div>
        </div>
    </div>
</div>
