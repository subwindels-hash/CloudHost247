{* CloudHost247 LTE Proxy Admin Settings *}

<div class="ch247-admin-dashboard">
    <div class="ch247-admin-header">
        <h2><i class="fas fa-cog"></i> Module Settings</h2>
    </div>

    <div class="ch247-admin-section">
        <div class="ch247-section-header">
            <h3>API Configuration</h3>
        </div>
        <form method="post" action="{htmlspecialchars($PHP_SELF)}?module=cloudhost247_lteproxy&action=settings" class="ch247-form">
            <div class="ch247-form-row">
                <div class="ch247-form-group">
                    <label>API Base URL</label>
                    <input type="url" name="api_base_url" class="ch247-input" value="{$settings.api_base_url}" placeholder="https://api.cloudhost247.com">
                </div>
                <div class="ch247-form-group">
                    <label>API Key</label>
                    <input type="text" name="api_key" class="ch247-input" value="{$settings.api_key}" placeholder="Your API Key">
                </div>
            </div>
            <div class="ch247-form-row">
                <div class="ch247-form-group">
                    <label>API Secret</label>
                    <input type="password" name="api_secret" class="ch247-input" value="{$settings.api_secret}" placeholder="Your API Secret">
                </div>
                <div class="ch247-form-group">
                    <label>API Timeout (seconds)</label>
                    <input type="number" name="api_timeout" class="ch247-input" value="{$settings.api_timeout}" min="5" max="120">
                </div>
            </div>
            <button type="submit" class="ch247-btn ch247-btn-primary">
                <i class="fas fa-save"></i> Save API Settings
            </button>
        </form>
    </div>

    <div class="ch247-admin-section">
        <div class="ch247-section-header">
            <h3>Logging & Cache</h3>
        </div>
        <div class="ch247-settings-grid">
            <div class="ch247-setting-card">
                <h4>Log Status</h4>
                <p>Logging is {if $settings.logging_enabled}enabled{else}disabled{/if}</p>
                <p>Level: {$settings.log_level}</p>
                <p>File size: {$logFileSize}</p>
                <a href="?module=cloudhost247_lteproxy&action=logs" class="ch247-btn ch247-btn-sm ch247-btn-secondary">View Logs</a>
            </div>
            <div class="ch247-setting-card">
                <h4>Cache Status</h4>
                <p>Caching is {if $settings.cache_enabled}enabled{else}disabled{/if}</p>
                <p>Cache files: {$cacheStats.file_count}</p>
                <p>Cache size: {$cacheStats.total_size_formatted}</p>
                <button class="ch247-btn ch247-btn-sm ch247-btn-secondary" onclick="clearCache()">Clear Cache</button>
            </div>
        </div>
    </div>
</div>
