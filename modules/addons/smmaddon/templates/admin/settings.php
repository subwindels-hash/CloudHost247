<div class="smm-settings">
    <h2>SMM Panel Settings</h2>

    <?php if ($flash): ?>
    <div class="alert alert-<?php echo $flash['type'] === 'success' ? 'success' : 'danger'; ?>">
        <?php echo $flash['message']; ?>
    </div>
    <?php endif; ?>

    <div class="panel panel-default">
        <div class="panel-heading"><h4>API Configuration</h4></div>
        <div class="panel-body">
            <form method="post" action="<?php echo $modulelink; ?>&action=settings">
                <input type="hidden" name="action" value="settings">
                <div class="form-group">
                    <label>SMM Panel API URL</label>
                    <input type="url" name="api_url" class="form-control" value="<?php echo htmlspecialchars($config['api_url'] ?? ''); ?>" placeholder="https://panel.example.com/api/v2" required>
                    <small class="text-muted">Enter the full API endpoint URL for your SMM panel.</small>
                </div>
                <div class="form-group">
                    <label>SMM Panel API Key</label>
                    <input type="password" name="api_key" class="form-control" value="<?php echo htmlspecialchars($config['api_key'] ?? ''); ?>" placeholder="Your API Key" required>
                    <small class="text-muted">Keep this key secure. It is stored encrypted in the database.</small>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="auto_sync" value="1" <?php echo ($config['auto_sync'] ?? 'off') === 'on' ? 'checked' : ''; ?>>
                        Auto Sync Services Daily
                    </label>
                    <small class="text-muted">Automatically sync SMM services list during daily cron.</small>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="debug_mode" value="1" <?php echo ($config['debug_mode'] ?? 'off') === 'on' ? 'checked' : ''; ?>>
                        Debug Mode (Log API Calls)
                    </label>
                    <small class="text-muted">Enable only for troubleshooting. Logs may grow large.</small>
                </div>
                <button type="submit" class="btn btn-primary">Save Settings</button>
            </form>
        </div>
    </div>

    <div class="panel panel-info" style="margin-top:20px;">
        <div class="panel-heading"><h4>API Information</h4></div>
        <div class="panel-body">
            <p><strong>Supported API Format:</strong> Generic SMM Panel API (POST requests)</p>
            <ul>
                <li><code>action=balance</code> - Check balance</li>
                <li><code>action=services</code> - Get services list</li>
                <li><code>action=add&service=ID&link=URL&quantity=NUM</code> - Place order</li>
                <li><code>action=status&order=ID</code> - Check order status</li>
                <li><code>action=refill&order=ID</code> - Refill order</li>
                <li><code>action=cancel&order=ID</code> - Cancel order</li>
            </ul>
            <p><strong>Note:</strong> Most panels use <code>key</code> as the API key parameter name.</p>
        </div>
    </div>
</div>
