<?php
/**
 * Admin view for CloudHost247 Cart Recovery.
 *
 * Plain PHP template rendered by cloudhost247_cart_recovery_output() with an
 * extracted $view array — the same pattern the other CloudHost247 admin
 * screens use. Bootstrap 3 markup keeps it visually native to the WHMCS
 * admin area; every value is escaped on output.
 */

if (!defined('WHMCS')) {
    die('Direct access denied');
}

/** @var array $view */
$e = function ($value) {
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
};
$link = $view['modulelink'];
$token = $view['token'];

foreach ($view['errors'] as $error) {
    echo '<div class="alert alert-danger">' . $e($error) . '</div>';
}
foreach ($view['notices'] as $notice) {
    echo '<div class="alert alert-success">' . $e($notice) . '</div>';
}
if (!$view['authorised']) {
    return;
}

$stats = $view['stats'];
$settings = $view['settings'];
$cards = array(
    'Total Abandoned Carts' => $stats['abandoned'],
    'Active Recovery Carts' => $stats['active'],
    'Reminders Sent' => $stats['reminders_sent'],
    'Recovered Carts' => $stats['recovered'],
    'Converted Carts' => $stats['converted'],
    'Expired Carts' => $stats['expired'],
    'Unsubscribed Customers' => $stats['unsubscribed'],
    'Recovery Rate' => number_format((float) $stats['recovery_rate'], 2) . '%',
    'Recovered Revenue' => number_format((float) $stats['recovered_revenue'], 2),
);
?>
<div class="cloudhost247-cart-recovery">
    <h2>CloudHost247 &rsaquo; Cart Recovery</h2>
    <p class="text-muted">
        All figures below are live counts from this installation. Recovery rate =
        (recovered + converted) &divide; (abandoned + recovered + converted + expired + unsubscribed) &times; 100.
        Recovered revenue is copied from the authoritative WHMCS order/invoice total, never from the cart snapshot.
    </p>

    <div class="row">
        <?php foreach ($cards as $label => $value) { ?>
            <div class="col-sm-4 col-md-3 col-lg-2">
                <div class="panel panel-default">
                    <div class="panel-heading"><small><?php echo $e($label); ?></small></div>
                    <div class="panel-body"><h4 style="margin:0"><?php echo $e($value); ?></h4></div>
                </div>
            </div>
        <?php } ?>
    </div>

    <div class="row">
        <div class="col-md-6">
            <h3>Settings</h3>
            <form method="post" action="<?php echo $e($link); ?>" class="form-horizontal">
                <input type="hidden" name="token" value="<?php echo $e($token); ?>">
                <input type="hidden" name="action" value="save_settings">
                <?php
                $toggles = array(
                    'enabled' => 'Enable Cart Recovery',
                    'enable_reminder_1' => 'Enable Reminder 1',
                    'enable_reminder_2' => 'Enable Reminder 2',
                    'enable_reminder_3' => 'Enable Reminder 3',
                    'guest_recovery' => 'Enable Guest Cart Recovery',
                    'unsubscribe' => 'Enable Unsubscribe',
                );
                foreach ($toggles as $key => $label) {
                    $checked = isset($settings[$key]) && $settings[$key] === '1' ? ' checked' : '';
                    echo '<div class="checkbox"><label><input type="checkbox" name="' . $e($key) . '" value="1"' . $checked . '> ' . $e($label) . '</label></div>';
                }
                $numbers = array(
                    'abandonment_threshold' => 'Abandonment Threshold (seconds)',
                    'reminder_1_delay' => 'Reminder 1 Delay after abandonment (seconds)',
                    'reminder_2_delay' => 'Reminder 2 Delay after abandonment (seconds)',
                    'reminder_3_delay' => 'Reminder 3 Delay after abandonment (seconds)',
                    'maximum_reminders' => 'Maximum Reminders (0-3)',
                    'token_lifetime' => 'Recovery Token Lifetime (seconds)',
                    'batch_size' => 'Cron Batch Size',
                    'retry_delay' => 'Retry Delay after a failed send (seconds)',
                    'max_retries' => 'Maximum Retries per reminder',
                    'lock_ttl' => 'Cron Lock Lease (seconds)',
                );
                foreach ($numbers as $key => $label) {
                    echo '<div class="form-group"><label class="col-sm-7 control-label" style="text-align:left">' . $e($label) . '</label>'
                        . '<div class="col-sm-5"><input class="form-control" type="number" min="0" name="' . $e($key) . '" value="'
                        . $e(isset($settings[$key]) ? $settings[$key] : '') . '"></div></div>';
                }
                ?>
                <button class="btn btn-primary" type="submit">Save Settings</button>
            </form>
        </div>
        <div class="col-md-6">
            <h3>Maintenance</h3>
            <form method="post" action="<?php echo $e($link); ?>" class="form-inline" style="margin-bottom:10px">
                <input type="hidden" name="token" value="<?php echo $e($token); ?>">
                <input type="hidden" name="action" value="process_due">
                <button class="btn btn-default" type="submit">Process Due Reminders</button>
            </form>
            <form method="post" action="<?php echo $e($link); ?>" class="form-inline">
                <input type="hidden" name="token" value="<?php echo $e($token); ?>">
                <input type="hidden" name="action" value="run_migrations">
                <button class="btn btn-default" type="submit">Verify / Apply Database Migrations</button>
            </form>
            <hr>
            <p class="text-muted">
                Reminders pending or in flight: <strong><?php echo $e($stats['reminders_pending']); ?></strong><br>
                Reminder delivery failures: <strong><?php echo $e($stats['reminders_failed']); ?></strong><br>
                Suppressed contacts: <strong><?php echo $e($stats['suppressed_contacts']); ?></strong><br>
                Carts closed (emptied or cancelled): <strong><?php echo $e($stats['closed']); ?></strong>
            </p>
            <p class="text-muted">
                Scheduled processing is driven by cron; see the addon README for the exact command.
                Manual processing here uses the same lock and the same validation rules, so it cannot
                produce duplicate emails.
            </p>
        </div>
    </div>

    <?php if (!empty($view['detail'])) {
        $record = $view['detail']['record']; ?>
        <hr>
        <h3>Recovery #<?php echo $e($record->id); ?></h3>
        <div class="row">
            <div class="col-md-6">
                <table class="table table-condensed">
                    <tr><th>Customer</th><td><?php echo $e(trim($record->first_name . ' ' . $record->last_name)); ?></td></tr>
                    <tr><th>Email</th><td><?php echo $e($record->email); ?></td></tr>
                    <tr><th>Client ID</th><td><?php echo $e($record->client_id ? $record->client_id : 'Guest'); ?></td></tr>
                    <tr><th>Status</th><td><?php echo $e($record->status); ?></td></tr>
                    <tr><th>Cart total (snapshot)</th><td><?php echo $e(trim($record->currency . ' ' . $record->cart_total)); ?></td></tr>
                    <tr><th>Created</th><td><?php echo $e($record->created_at); ?></td></tr>
                    <tr><th>Last activity</th><td><?php echo $e($record->last_activity_at); ?></td></tr>
                    <tr><th>Abandoned</th><td><?php echo $e($record->abandoned_at); ?></td></tr>
                    <tr><th>Recovered</th><td><?php echo $e($record->recovered_at); ?></td></tr>
                    <tr><th>Converted</th><td><?php echo $e($record->converted_at); ?></td></tr>
                    <tr><th>Order</th><td><?php echo $e($record->order_id); ?></td></tr>
                    <tr><th>Recovered revenue</th><td><?php echo $e($record->recovered_revenue); ?></td></tr>
                    <tr><th>Link expires</th><td><?php echo $e($record->token_expires_at); ?></td></tr>
                </table>
                <form method="post" action="<?php echo $e($link); ?>" class="form-inline">
                    <input type="hidden" name="token" value="<?php echo $e($token); ?>">
                    <input type="hidden" name="recovery_id" value="<?php echo $e($record->id); ?>">
                    <button class="btn btn-sm btn-primary" type="submit" name="action" value="send_reminder">Send Next Due Reminder</button>
                    <button class="btn btn-sm btn-default" type="submit" name="action" value="expire_recovery">Expire Recovery</button>
                    <button class="btn btn-sm btn-default" type="submit" name="action" value="cancel_recovery">Cancel Recovery</button>
                    <button class="btn btn-sm btn-warning" type="submit" name="action" value="unsubscribe_customer">Unsubscribe Customer</button>
                </form>
            </div>
            <div class="col-md-6">
                <h4>Cart contents</h4>
                <table class="table table-condensed table-striped">
                    <thead><tr><th>Item</th><th>Domain</th><th>Cycle</th><th>Qty</th></tr></thead>
                    <tbody>
                    <?php if (!$view['detail']['items']) { ?>
                        <tr><td colspan="4" class="text-muted">No items recorded.</td></tr>
                    <?php } foreach ($view['detail']['items'] as $item) { ?>
                        <tr>
                            <td><?php echo $e($item['name']); ?></td>
                            <td><?php echo $e($item['domain']); ?></td>
                            <td><?php echo $e($item['billingcycle']); ?></td>
                            <td><?php echo $e($item['quantity']); ?></td>
                        </tr>
                    <?php } ?>
                    </tbody>
                </table>
                <h4>Reminder history</h4>
                <table class="table table-condensed table-striped">
                    <thead><tr><th>#</th><th>Status</th><th>Sent</th><th>Scheduled</th><th>Attempts</th><th>Detail</th></tr></thead>
                    <tbody>
                    <?php foreach ($view['detail']['history'] as $entry) { ?>
                        <tr>
                            <td>Reminder #<?php echo $e($entry['number']); ?></td>
                            <td><?php echo $e(ucfirst($entry['status'])); ?></td>
                            <td><?php echo $e($entry['sent_at']); ?></td>
                            <td><?php echo $e($entry['scheduled']); ?></td>
                            <td><?php echo $e($entry['attempts']); ?></td>
                            <td>
                                <?php echo $e($entry['error']); ?>
                                <?php if ($entry['status'] === 'failed') { ?>
                                    <form method="post" action="<?php echo $e($link); ?>" style="display:inline">
                                        <input type="hidden" name="token" value="<?php echo $e($token); ?>">
                                        <input type="hidden" name="action" value="retry_reminder">
                                        <input type="hidden" name="recovery_id" value="<?php echo $e($record->id); ?>">
                                        <input type="hidden" name="reminder_number" value="<?php echo $e($entry['number']); ?>">
                                        <button class="btn btn-xs btn-default" type="submit">Retry</button>
                                    </form>
                                <?php } ?>
                            </td>
                        </tr>
                    <?php } ?>
                    </tbody>
                </table>
            </div>
        </div>
    <?php } ?>

    <hr>
    <h3>Recovery Records</h3>
    <form method="get" action="<?php echo $e($link); ?>" class="form-inline" style="margin-bottom:10px">
        <?php
        // Preserve the WHMCS addon routing parameters present in modulelink.
        $parts = array();
        $queryString = parse_url($link, PHP_URL_QUERY);
        if ($queryString) {
            parse_str($queryString, $parts);
        }
        foreach ($parts as $key => $value) {
            if (in_array($key, array('status', 'q', 'page', 'view'), true)) {
                continue;
            }
            echo '<input type="hidden" name="' . $e($key) . '" value="' . $e($value) . '">';
        }
        ?>
        <select name="status" class="form-control">
            <option value="">All</option>
            <?php foreach ($view['statuses'] as $status) { ?>
                <option value="<?php echo $e($status); ?>"<?php echo $view['filter']['status'] === $status ? ' selected' : ''; ?>>
                    <?php echo $e(ucfirst($status)); ?>
                </option>
            <?php } ?>
        </select>
        <input type="text" class="form-control" name="q" placeholder="Customer, email or order ID"
               value="<?php echo $e($view['filter']['q']); ?>">
        <button class="btn btn-default" type="submit">Search</button>
    </form>

    <div class="table-responsive">
        <table class="table table-striped table-condensed">
            <thead>
            <tr>
                <th>Customer</th><th>Email</th><th>Cart Contents</th><th>Cart Total</th><th>Status</th>
                <th>Created</th><th>Last Activity</th><th>Abandoned</th><th>Last Reminder</th>
                <th>Next Reminder</th><th>Recovered</th><th>Converted</th><th>Order</th><th></th>
            </tr>
            </thead>
            <tbody>
            <?php if (!$view['list']['rows']) { ?>
                <tr><td colspan="14" class="text-muted">No recovery records match this filter.</td></tr>
            <?php } foreach ($view['list']['rows'] as $row) {
                $separator = strpos($link, '?') === false ? '?' : '&'; ?>
                <tr>
                    <td><?php echo $e(trim($row->first_name . ' ' . $row->last_name)); ?></td>
                    <td><?php echo $e($row->email); ?></td>
                    <td><?php echo $e(\CloudHost247\CartRecovery\CartSnapshot::label($row->cart_snapshot, 4)); ?></td>
                    <td><?php echo $e(trim($row->currency . ' ' . $row->cart_total)); ?></td>
                    <td><?php echo $e(ucfirst($row->status)); ?></td>
                    <td><?php echo $e($row->created_at); ?></td>
                    <td><?php echo $e($row->last_activity_at); ?></td>
                    <td><?php echo $e($row->abandoned_at); ?></td>
                    <td><?php echo $e($row->last_reminder_number ? '#' . $row->last_reminder_number . ' ' . $row->last_reminder_at : ''); ?></td>
                    <td><?php echo $e($row->next_reminder_at); ?></td>
                    <td><?php echo $e($row->recovered_at); ?></td>
                    <td><?php echo $e($row->converted_at); ?></td>
                    <td><?php echo $e($row->order_id); ?></td>
                    <td><a class="btn btn-xs btn-default" href="<?php echo $e($link . $separator . 'view=' . (int) $row->id); ?>">View</a></td>
                </tr>
            <?php } ?>
            </tbody>
        </table>
    </div>

    <?php if ($view['list']['pages'] > 1) {
        $separator = strpos($link, '?') === false ? '?' : '&';
        $base = $link . $separator . 'status=' . rawurlencode($view['filter']['status']) . '&q=' . rawurlencode($view['filter']['q']) . '&page='; ?>
        <nav>
            <ul class="pagination pagination-sm">
                <?php for ($page = 1; $page <= $view['list']['pages']; $page++) { ?>
                    <li<?php echo $page === $view['list']['page'] ? ' class="active"' : ''; ?>>
                        <a href="<?php echo $e($base . $page); ?>"><?php echo $e($page); ?></a>
                    </li>
                <?php } ?>
            </ul>
        </nav>
    <?php } ?>
    <p class="text-muted">
        Showing <?php echo $e(count($view['list']['rows'])); ?> of <?php echo $e($view['list']['total']); ?> record(s).
        Recovery links are credentials and are never displayed here.
    </p>
</div>
