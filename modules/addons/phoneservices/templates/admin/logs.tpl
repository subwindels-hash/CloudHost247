<?php
/**
 * Admin > System logs
 *
 * @var array  $vars
 * @var array  $logs
 * @var string $level active level filter ('' = all)
 */

$moduleLink = htmlspecialchars((string) ($vars['modulelink'] ?? ''), ENT_QUOTES, 'UTF-8');
$e = static function ($value): string {
    return htmlspecialchars((string) ($value ?? ''), ENT_QUOTES, 'UTF-8');
};
$levelClass = ['error' => 'danger', 'warning' => 'warning', 'debug' => 'info', 'info' => 'success'];
?>
<div class="phoneservices-admin phoneservices-logs">

    <div class="ps-page-head">
        <h2>System logs</h2>
        <p class="ps-muted">The 200 most recent entries. Credentials are redacted before anything is written.</p>
    </div>

    <div class="ps-filter-bar">
        <div class="btn-group">
            <?php foreach (['' => 'All', 'error' => 'Errors', 'warning' => 'Warnings', 'info' => 'Info', 'debug' => 'Debug'] as $value => $label) : ?>
                <a class="btn btn-default <?php echo $level === $value ? 'active' : ''; ?>"
                   href="<?php echo $moduleLink; ?>&amp;action=logs<?php echo $value !== '' ? '&amp;level=' . $e($value) : ''; ?>">
                    <?php echo $e($label); ?>
                </a>
            <?php endforeach; ?>
        </div>
    </div>

    <div class="table-responsive">
        <table class="table table-striped table-condensed">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Level</th>
                    <th>Message</th>
                    <th>Context</th>
                    <th>Source</th>
                    <th>IP</th>
                    <th>Time</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($logs as $log) : ?>
                <tr class="<?php echo $log['level'] === 'error' ? 'danger' : ($log['level'] === 'warning' ? 'warning' : ''); ?>">
                    <td>#<?php echo (int) $log['id']; ?></td>
                    <td>
                        <span class="label label-<?php echo $e($levelClass[$log['level']] ?? 'default'); ?>">
                            <?php echo $e(ucfirst((string) $log['level'])); ?>
                        </span>
                    </td>
                    <td><?php echo $e($log['message']); ?></td>
                    <td class="ps-truncate" title="<?php echo $e($log['context']); ?>">
                        <code><?php echo $e(mb_substr((string) $log['context'], 0, 80)); ?></code>
                    </td>
                    <td><?php echo $e($log['source']); ?></td>
                    <td><?php echo $e($log['ip_address']); ?></td>
                    <td><?php echo $e($log['created_at']); ?></td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$logs) : ?>
                <tr><td colspan="7" class="text-center ps-muted">Nothing logged yet.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>
