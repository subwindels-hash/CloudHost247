<?php
/**
 * Admin view for CloudHost247 Passkey Authentication.
 *
 * Plain PHP template rendered by cloudhost247_passkey_output() with a $view
 * array — the same pattern the other CloudHost247 admin screens use.
 * Bootstrap 3 markup keeps it visually native to the WHMCS admin area; every
 * value is escaped on output.
 *
 * Nothing on this screen exposes a public key, a challenge, a signature or
 * any other cryptographic material: administrators see metadata only.
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

/**
 * WHMCS's modulelink already carries query parameters (module=...), which a
 * GET form would otherwise discard. This re-emits them as hidden inputs so
 * filter forms keep pointing at this addon.
 */
$linkPath = strtok($link, '?');
$linkHidden = function () use ($link, $e) {
    $query = parse_url($link, PHP_URL_QUERY);
    if (!$query) {
        return '';
    }
    parse_str($query, $params);
    $html = '';
    foreach ($params as $name => $value) {
        if (!is_scalar($value)) {
            continue;
        }
        $html .= '<input type="hidden" name="' . $e($name) . '" value="' . $e($value) . '">';
    }
    return $html;
};

foreach ($view['errors'] as $error) {
    echo '<div class="alert alert-danger">' . $e($error) . '</div>';
}
foreach ($view['notices'] as $notice) {
    echo '<div class="alert alert-success">' . $e($notice) . '</div>';
}
if (!$view['authorised']) {
    return;
}

$tab = $view['tab'];
$settings = $view['settings'];
$stats = $view['stats'];
$tabs = array(
    'overview' => 'Overview',
    'credentials' => 'Passkeys',
    'activity' => 'Activity',
    'settings' => 'Settings',
    'diagnostics' => 'Diagnostics',
);
?>
<ul class="nav nav-tabs" style="margin-bottom:18px">
    <?php foreach ($tabs as $key => $label): ?>
        <li<?php echo $tab === $key ? ' class="active"' : ''; ?>>
            <a href="<?php echo $e($link . '&tab=' . $key); ?>"><?php echo $e($label); ?></a>
        </li>
    <?php endforeach; ?>
</ul>

<?php if ($view['emergency_override']): ?>
    <div class="alert alert-warning">
        <strong>Emergency override is active.</strong> Passkey enforcement is suspended because an override file is
        present on the server. It expires automatically 24 hours after the file was created.
    </div>
<?php endif; ?>

<?php if ($tab === 'overview'): ?>
    <div class="row">
        <?php
        $cards = array(
            'Registered Passkeys' => $stats['credentials_total'],
            'Active Passkeys' => $stats['credentials_active'],
            'Clients Enrolled' => $stats['clients_enrolled'],
            'Admins Enrolled' => $stats['admins_enrolled'],
            'Sign-ins (24h)' => $stats['logins_24h'],
            'Failed Attempts (24h)' => $stats['failures_24h'],
            'Active Lockouts' => $stats['lockouts_active'],
        );
        foreach ($cards as $label => $value):
            ?>
            <div class="col-md-3" style="margin-bottom:14px">
                <div class="panel panel-default" style="margin-bottom:0">
                    <div class="panel-body">
                        <div style="font-size:24px;font-weight:600"><?php echo $e($value); ?></div>
                        <div class="text-muted"><?php echo $e($label); ?></div>
                    </div>
                </div>
            </div>
        <?php endforeach; ?>
    </div>

    <div class="panel panel-default">
        <div class="panel-heading"><strong>Maintenance</strong></div>
        <div class="panel-body">
            <p class="text-muted">
                Housekeeping normally runs from the cron entry
                <code>crons/cloudhost247_passkey.php</code>. These buttons run the same work on demand.
            </p>
            <form method="post" action="<?php echo $e($link); ?>" style="display:inline-block;margin-right:8px">
                <input type="hidden" name="token" value="<?php echo $e($token); ?>">
                <input type="hidden" name="action" value="prune_events">
                <button class="btn btn-default" type="submit">Run housekeeping</button>
            </form>
            <form method="post" action="<?php echo $e($link); ?>" style="display:inline-block;margin-right:8px">
                <input type="hidden" name="token" value="<?php echo $e($token); ?>">
                <input type="hidden" name="action" value="clear_lockouts">
                <button class="btn btn-default" type="submit">Clear all lockouts</button>
            </form>
            <form method="post" action="<?php echo $e($link); ?>" style="display:inline-block">
                <input type="hidden" name="token" value="<?php echo $e($token); ?>">
                <input type="hidden" name="action" value="run_migrations">
                <button class="btn btn-default" type="submit">Run database migrations</button>
            </form>
        </div>
    </div>

<?php elseif ($tab === 'credentials'): ?>
    <form class="form-inline" method="get" action="<?php echo $e($linkPath); ?>" style="margin-bottom:14px">
        <?php echo $linkHidden(); ?>
        <input type="hidden" name="tab" value="credentials">
        <select class="form-control" name="user_type">
            <option value="">All account types</option>
            <option value="client"<?php echo $view['filter']['user_type'] === 'client' ? ' selected' : ''; ?>>Clients</option>
            <option value="admin"<?php echo $view['filter']['user_type'] === 'admin' ? ' selected' : ''; ?>>Administrators</option>
        </select>
        <input class="form-control" type="text" name="user_id" placeholder="Account ID"
               value="<?php echo $e($view['filter']['user_id']); ?>">
        <button class="btn btn-default" type="submit">Filter</button>
    </form>

    <table class="table table-striped">
        <thead>
        <tr>
            <th>Account</th>
            <th>Device</th>
            <th>Status</th>
            <th>Policy</th>
            <th>Registered</th>
            <th>Last used</th>
            <th>Reference</th>
            <th class="text-right">Actions</th>
        </tr>
        </thead>
        <tbody>
        <?php if (empty($view['credentials']['items'])): ?>
            <tr><td colspan="8" class="text-muted">No passkeys have been registered yet.</td></tr>
        <?php else: foreach ($view['credentials']['items'] as $item): ?>
            <tr>
                <td>
                    <?php echo $e($item['user_label']); ?>
                    <div class="text-muted"><?php echo $e($item['user_type'] . ' #' . $item['user_id']); ?></div>
                </td>
                <td><?php echo $e($item['device_name']); ?></td>
                <td><span class="label label-<?php echo $item['status'] === 'active' ? 'success' : ($item['status'] === 'revoked' ? 'danger' : 'warning'); ?>">
                        <?php echo $e($item['status']); ?></span></td>
                <td><?php echo $e($item['account_policy']); ?></td>
                <td><?php echo $e($item['created_at']); ?></td>
                <td><?php echo $e($item['last_used_at'] !== '' ? $item['last_used_at'] : 'never'); ?></td>
                <td><code><?php echo $e($item['reference']); ?></code></td>
                <td class="text-right">
                    <?php
                    $actions = $item['status'] === 'active'
                        ? array('disable_credential' => 'Disable', 'revoke_credential' => 'Revoke')
                        : ($item['status'] === 'disabled'
                            ? array('enable_credential' => 'Enable', 'revoke_credential' => 'Revoke')
                            : array());
                    foreach ($actions as $formAction => $label):
                        ?>
                        <form method="post" action="<?php echo $e($link); ?>" style="display:inline-block">
                            <input type="hidden" name="token" value="<?php echo $e($token); ?>">
                            <input type="hidden" name="action" value="<?php echo $e($formAction); ?>">
                            <input type="hidden" name="credential_id" value="<?php echo (int) $item['id']; ?>">
                            <button class="btn btn-xs btn-default" type="submit"><?php echo $e($label); ?></button>
                        </form>
                    <?php endforeach; ?>
                </td>
            </tr>
        <?php endforeach; endif; ?>
        </tbody>
    </table>
    <p class="text-muted"><?php echo (int) $view['credentials']['total']; ?> passkey(s) total.</p>

    <div class="panel panel-default">
        <div class="panel-heading"><strong>Per-account policy</strong></div>
        <div class="panel-body">
            <p class="text-muted">
                An account set to <em>required</em> must sign in with a passkey. Enforcement is skipped automatically
                for accounts that have not enrolled one yet, so a policy change can never lock anybody out.
            </p>
            <form class="form-inline" method="post" action="<?php echo $e($link); ?>">
                <input type="hidden" name="token" value="<?php echo $e($token); ?>">
                <input type="hidden" name="action" value="set_account_policy">
                <select class="form-control" name="user_type">
                    <option value="client">Client</option>
                    <option value="admin">Administrator</option>
                </select>
                <input class="form-control" type="number" name="user_id" min="1" placeholder="Account ID" required>
                <select class="form-control" name="policy">
                    <?php foreach ($view['account_policies'] as $policy): ?>
                        <option value="<?php echo $e($policy); ?>"><?php echo $e($policy); ?></option>
                    <?php endforeach; ?>
                </select>
                <button class="btn btn-primary" type="submit">Apply policy</button>
            </form>
        </div>
    </div>

<?php elseif ($tab === 'activity'): ?>
    <form class="form-inline" method="get" action="<?php echo $e($linkPath); ?>" style="margin-bottom:14px">
        <?php echo $linkHidden(); ?>
        <input type="hidden" name="tab" value="activity">
        <select class="form-control" name="user_type">
            <option value="">All account types</option>
            <option value="client"<?php echo $view['filter']['user_type'] === 'client' ? ' selected' : ''; ?>>Clients</option>
            <option value="admin"<?php echo $view['filter']['user_type'] === 'admin' ? ' selected' : ''; ?>>Administrators</option>
        </select>
        <input class="form-control" type="text" name="user_id" placeholder="Account ID"
               value="<?php echo $e($view['filter']['user_id']); ?>">
        <input class="form-control" type="text" name="event_type" placeholder="Event type"
               value="<?php echo $e($view['filter']['event_type']); ?>">
        <select class="form-control" name="success">
            <option value="">Any outcome</option>
            <option value="1"<?php echo $view['filter']['success'] === '1' ? ' selected' : ''; ?>>Success</option>
            <option value="0"<?php echo $view['filter']['success'] === '0' ? ' selected' : ''; ?>>Failure</option>
        </select>
        <button class="btn btn-default" type="submit">Filter</button>
    </form>

    <table class="table table-striped table-condensed">
        <thead>
        <tr>
            <th>When</th><th>Event</th><th>Account</th><th>Outcome</th><th>Reason</th><th>IP</th>
        </tr>
        </thead>
        <tbody>
        <?php if (empty($view['activity']['items'])): ?>
            <tr><td colspan="6" class="text-muted">No activity recorded for this filter.</td></tr>
        <?php else: foreach ($view['activity']['items'] as $row): ?>
            <tr>
                <td><?php echo $e($row['created_at']); ?></td>
                <td><code><?php echo $e($row['event_type']); ?></code></td>
                <td><?php echo $e(($row['user_type'] ? $row['user_type'] : '-') . ' #' . (int) $row['user_id']); ?></td>
                <td><?php echo ((int) $row['success'] === 1)
                        ? '<span class="label label-success">ok</span>'
                        : '<span class="label label-danger">failed</span>'; ?></td>
                <td><?php echo $e($row['reason']); ?></td>
                <td><?php echo $e($row['ip_address']); ?></td>
            </tr>
        <?php endforeach; endif; ?>
        </tbody>
    </table>
    <p class="text-muted"><?php echo (int) $view['activity']['total']; ?> event(s) match this filter.</p>

<?php elseif ($tab === 'settings'): ?>
    <form method="post" action="<?php echo $e($link); ?>">
        <input type="hidden" name="token" value="<?php echo $e($token); ?>">
        <input type="hidden" name="action" value="save_settings">

        <?php
        $sections = array(
            'Relying party' => array(
                'rp_name' => array('text', 'Relying party name', 'Shown in the browser passkey prompt.'),
                'rp_id' => array('text', 'RP ID', 'The registrable domain, e.g. example.com. Passkeys are bound to it permanently — changing it invalidates every registered passkey.'),
                'allowed_origins' => array('textarea', 'Allowed origins', 'One absolute origin per line, e.g. https://www.example.com. Requests from anything else are refused.'),
                'environment' => array('enum', 'Environment', 'Production always requires HTTPS.'),
                'require_https' => array('bool', 'Require HTTPS', 'Leave enabled unless testing locally.'),
            ),
            'Policy' => array(
                'enabled' => array('bool', 'Enable passkey authentication', ''),
                'client_policy' => array('enum', 'Client enforcement', ''),
                'admin_policy' => array('enum', 'Administrator enforcement', ''),
                'password_fallback' => array('bool', 'Allow password fallback', 'Disabling this only affects accounts that already have a passkey.'),
                'user_verification' => array('enum', 'User verification (sign-in)', ''),
                'action_user_verification' => array('enum', 'User verification (sensitive actions)', ''),
                'resident_key' => array('enum', 'Discoverable credentials', ''),
                'max_credentials_client' => array('int', 'Max passkeys per client', ''),
                'max_credentials_admin' => array('int', 'Max passkeys per administrator', ''),
            ),
            'Hardening' => array(
                'challenge_ttl' => array('int', 'Challenge lifetime (seconds)', ''),
                'action_challenge_ttl' => array('int', 'Action challenge lifetime (seconds)', ''),
                'reset_authorization_ttl' => array('int', 'Reset authorization lifetime (seconds)', ''),
                'rate_limit_window' => array('int', 'Rate limit window (seconds)', ''),
                'rate_limit_attempts' => array('int', 'Failed attempts before lockout', ''),
                'lockout_seconds' => array('int', 'Lockout duration (seconds)', 'Lockouts are always temporary.'),
                'event_retention_days' => array('int', 'Activity log retention (days)', ''),
            ),
            'Features' => array(
                'sensitive_action_confirmation' => array('bool', 'Require passkey confirmation for sensitive actions', ''),
                'password_reset_enabled' => array('bool', 'Allow password reset with a passkey', ''),
                'reset_invalidates_sessions' => array('bool', 'Invalidate other sessions after a reset', ''),
                'login_notifications_client' => array('bool', 'Notify clients of passkey sign-ins', ''),
                'login_notifications_admin' => array('bool', 'Notify administrators of passkey sign-ins', ''),
                'security_notifications' => array('bool', 'Send security event notifications', ''),
            ),
            'Microsoft Entra ID (optional)' => array(
                'entra_enabled' => array('bool', 'Enable Microsoft Entra ID sign-in', ''),
                'entra_tenant_id' => array('text', 'Tenant ID', ''),
                'entra_client_id' => array('text', 'Application (client) ID', ''),
                'entra_client_secret' => array('secret', 'Client secret', 'Stored encrypted. Leave blank to keep the current value.'),
                'entra_redirect_uri' => array('text', 'Redirect URI', ''),
                'entra_allowed_domains' => array('textarea', 'Allowed email domains', 'One per line. Leave blank to allow any domain in the tenant.'),
            ),
        );
        $enums = \CloudHost247\Passkey\SettingsRepository::enumKeys();

        foreach ($sections as $section => $fields):
            ?>
            <div class="panel panel-default">
                <div class="panel-heading"><strong><?php echo $e($section); ?></strong></div>
                <div class="panel-body">
                    <?php foreach ($fields as $key => $meta):
                        list($type, $label, $hint) = $meta;
                        $value = isset($settings[$key]) ? $settings[$key] : '';
                        ?>
                        <div class="form-group">
                            <label for="<?php echo $e($key); ?>"><?php echo $e($label); ?></label>
                            <?php if ($type === 'bool'): ?>
                                <div class="checkbox">
                                    <label>
                                        <input type="checkbox" name="<?php echo $e($key); ?>" value="1"
                                            <?php echo $value === '1' ? ' checked' : ''; ?>> Enabled
                                    </label>
                                </div>
                            <?php elseif ($type === 'textarea'): ?>
                                <textarea class="form-control" rows="4" id="<?php echo $e($key); ?>"
                                          name="<?php echo $e($key); ?>"><?php echo $e($value); ?></textarea>
                            <?php elseif ($type === 'enum'): ?>
                                <select class="form-control" id="<?php echo $e($key); ?>" name="<?php echo $e($key); ?>">
                                    <?php foreach ((isset($enums[$key]) ? $enums[$key] : array()) as $option): ?>
                                        <option value="<?php echo $e($option); ?>"<?php echo $value === $option ? ' selected' : ''; ?>>
                                            <?php echo $e($option); ?>
                                        </option>
                                    <?php endforeach; ?>
                                </select>
                            <?php elseif ($type === 'secret'): ?>
                                <input class="form-control" type="password" autocomplete="new-password"
                                       id="<?php echo $e($key); ?>" name="<?php echo $e($key); ?>"
                                       placeholder="<?php echo $value === '' ? 'Not set' : 'Stored — leave blank to keep'; ?>">
                            <?php else: ?>
                                <input class="form-control" type="<?php echo $type === 'int' ? 'number' : 'text'; ?>"
                                       id="<?php echo $e($key); ?>" name="<?php echo $e($key); ?>"
                                       value="<?php echo $e($value); ?>">
                            <?php endif; ?>
                            <?php if ($hint !== ''): ?>
                                <p class="help-block"><?php echo $e($hint); ?></p>
                            <?php endif; ?>
                        </div>
                    <?php endforeach; ?>
                </div>
            </div>
        <?php endforeach; ?>

        <button class="btn btn-primary" type="submit">Save settings</button>
    </form>

<?php else: ?>
    <div class="panel panel-default">
        <div class="panel-heading"><strong>Diagnostics</strong></div>
        <table class="table">
            <tbody>
            <?php foreach ($view['diagnostics'] as $check): ?>
                <tr>
                    <td style="width:30%"><strong><?php echo $e($check['name']); ?></strong></td>
                    <td style="width:10%">
                        <?php echo $check['ok']
                            ? '<span class="label label-success">pass</span>'
                            : '<span class="label label-danger">attention</span>'; ?>
                    </td>
                    <td><?php echo $e($check['detail']); ?></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
    <p class="text-muted">
        Passkey ceremonies fail closed: if any relying-party check above is failing, the client area falls back to
        the standard password login rather than presenting a broken passkey prompt.
    </p>
<?php endif; ?>
