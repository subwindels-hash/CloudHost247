<?php
/**
 * Admin > Users & subscriptions
 *
 * @var array  $vars
 * @var array  $users          client rows with per-service counters
 * @var string $search
 * @var array  $subscriptions  latest subscription rows
 */

$moduleLink = htmlspecialchars((string) ($vars['modulelink'] ?? ''), ENT_QUOTES, 'UTF-8');
$e = static function ($value): string {
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
};
$subStatusClass = [
    'active'    => 'success',
    'pending'   => 'warning',
    'suspended' => 'warning',
    'cancelled' => 'danger',
    'expired'   => 'default',
];
?>
<div class="phoneservices-admin phoneservices-users">

    <div class="ps-page-head">
        <h2>Users &amp; subscriptions</h2>
        <p class="ps-muted">Clients using the platform, with their service footprint and lifetime spend.</p>
    </div>

    <form method="get" action="<?php echo $moduleLink; ?>" class="form-inline ps-filter-bar">
        <input type="hidden" name="module" value="phoneservices">
        <input type="hidden" name="action" value="users">
        <div class="form-group">
            <label class="sr-only" for="ps-user-search">Search</label>
            <input type="text" id="ps-user-search" name="q" class="form-control"
                   placeholder="Name or email" value="<?php echo $e($search); ?>">
        </div>
        <button type="submit" class="btn btn-default">Search</button>
        <?php if ($search !== '') : ?>
            <a href="<?php echo $moduleLink; ?>&amp;action=users" class="btn btn-link">Clear</a>
        <?php endif; ?>
    </form>

    <div class="table-responsive">
        <table class="table table-striped table-condensed">
            <thead>
                <tr>
                    <th>Client</th>
                    <th>Email</th>
                    <th class="text-right">Numbers</th>
                    <th class="text-right">eSIMs</th>
                    <th class="text-right">Calls</th>
                    <th class="text-right">Messages</th>
                    <th class="text-right">Spend</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($users as $user) : ?>
                <tr>
                    <td>
                        <a href="clientssummary.php?userid=<?php echo (int) $user['id']; ?>">
                            <?php echo $e(trim($user['firstname'] . ' ' . $user['lastname'])); ?>
                        </a>
                        <span class="ps-muted">#<?php echo (int) $user['id']; ?></span>
                    </td>
                    <td><?php echo $e($user['email']); ?></td>
                    <td class="text-right"><?php echo (int) $user['numbers']; ?></td>
                    <td class="text-right"><?php echo (int) $user['esims']; ?></td>
                    <td class="text-right"><?php echo (int) $user['calls']; ?></td>
                    <td class="text-right"><?php echo (int) $user['messages']; ?></td>
                    <td class="text-right"><?php echo $e(number_format((float) $user['spend'], 2)); ?></td>
                    <td><?php echo $e($user['status']); ?></td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$users) : ?>
                <tr><td colspan="8" class="text-center ps-muted">No matching clients.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>

    <h3>Recent subscriptions</h3>
    <div class="table-responsive">
        <table class="table table-striped table-condensed">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Client</th>
                    <th>Service</th>
                    <th>Resource</th>
                    <th class="text-right">Amount</th>
                    <th>Cycle</th>
                    <th>Next due</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($subscriptions as $subscription) : ?>
                <tr>
                    <td>#<?php echo (int) $subscription['id']; ?></td>
                    <td><a href="clientssummary.php?userid=<?php echo (int) $subscription['user_id']; ?>">#<?php echo (int) $subscription['user_id']; ?></a></td>
                    <td><?php echo $e($subscription['service_type']); ?><?php echo !empty($subscription['plan_code']) ? ' <span class="ps-muted small">' . $e($subscription['plan_code']) . '</span>' : ''; ?></td>
                    <td><code><?php echo $e($subscription['resource_id']); ?></code></td>
                    <td class="text-right"><?php echo $e(number_format((float) ($subscription['amount'] ?? 0), 2)); ?></td>
                    <td><?php echo $e($subscription['billing_cycle'] ?? '—'); ?></td>
                    <td><?php echo $e($subscription['next_due_date'] ?? '—'); ?></td>
                    <td>
                        <span class="label label-<?php echo $e($subStatusClass[$subscription['status']] ?? 'default'); ?>">
                            <?php echo $e($subscription['status']); ?>
                        </span>
                    </td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$subscriptions) : ?>
                <tr><td colspan="8" class="text-center ps-muted">No subscriptions yet.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>
