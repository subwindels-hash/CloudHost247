<?php
/**
 * Admin > Messaging log (SMS / WhatsApp / Email)
 *
 * @var array $vars
 * @var array $messages
 * @var array $stats
 * @var string $csrf
 */

$e = static function ($value): string {
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
};
$statusClass = [
    'delivered' => 'success',
    'sent'      => 'info',
    'queued'    => 'warning',
    'received'  => 'primary',
    'failed'    => 'danger',
];
?>
<div class="phoneservices-admin phoneservices-sms">

    <div class="ps-page-head">
        <h2>Messaging</h2>
        <p class="ps-muted">SMS, WhatsApp and email traffic (latest 200).</p>
    </div>

    <div class="row ps-stats">
        <div class="col-sm-2"><div class="stat-card"><div class="stat-value"><?php echo (int) $stats['total']; ?></div><div class="stat-label">Messages</div></div></div>
        <div class="col-sm-2"><div class="stat-card"><div class="stat-value"><?php echo $e($stats['delivery_rate']); ?>%</div><div class="stat-label">Delivered</div></div></div>
        <div class="col-sm-2"><div class="stat-card"><div class="stat-value"><?php echo (int) $stats['inbound']; ?></div><div class="stat-label">Inbound</div></div></div>
        <div class="col-sm-2"><div class="stat-card"><div class="stat-value"><?php echo (int) $stats['whatsapp']; ?></div><div class="stat-label">WhatsApp</div></div></div>
        <div class="col-sm-2"><div class="stat-card"><div class="stat-value"><?php echo (int) $stats['email']; ?></div><div class="stat-label">Email</div></div></div>
        <div class="col-sm-2"><div class="stat-card"><div class="stat-value text-danger"><?php echo (int) $stats['failed']; ?></div><div class="stat-label">Failed</div></div></div>
    </div>

    <div class="table-responsive">
        <table class="table table-striped table-condensed">
            <thead>
                <tr>
                    <th>Sent</th>
                    <th>Client</th>
                    <th>Channel</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Body</th>
                    <th>Status</th>
                    <th class="text-right">Cost</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($messages as $message) : ?>
                <tr>
                    <td><?php echo $e($message['created_at']); ?></td>
                    <td>
                        <?php if (!empty($message['user_id'])) : ?>
                            <a href="clientssummary.php?userid=<?php echo (int) $message['user_id']; ?>">#<?php echo (int) $message['user_id']; ?></a>
                        <?php else : ?>
                            <span class="ps-muted">&mdash;</span>
                        <?php endif; ?>
                    </td>
                    <td><span class="label label-default"><?php echo $e($message['channel']); ?></span></td>
                    <td><?php echo $e($message['from_number']); ?></td>
                    <td><?php echo $e($message['to_number']); ?></td>
                    <td class="ps-truncate" title="<?php echo $e($message['body']); ?>">
                        <?php echo $e(mb_substr((string) $message['body'], 0, 60)); ?><?php echo mb_strlen((string) $message['body']) > 60 ? '&hellip;' : ''; ?>
                    </td>
                    <td>
                        <span class="label label-<?php echo $e($statusClass[$message['status']] ?? 'default'); ?>">
                            <?php echo $e($message['status']); ?>
                        </span>
                        <?php if (!empty($message['error_message'])) : ?>
                            <div class="ps-muted small"><?php echo $e($message['error_message']); ?></div>
                        <?php endif; ?>
                    </td>
                    <td class="text-right"><?php echo $e(number_format((float) ($message['cost'] ?? 0), 4)); ?></td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$messages) : ?>
                <tr><td colspan="8" class="text-center ps-muted">No messages recorded yet.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>
