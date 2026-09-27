{* CloudHost247 Isc LTE Proxy Client Dashboard *}
{* Version: 1.0.0 *}

<div class="ch247-lteproxy-dashboard" data-service-id="{$serviceId}" data-csrf-token="{$csrfToken}">
    {* Module Header *}
    <div class="ch247-header">
        <div class="ch247-header-content">
            <div class="ch247-brand">
                <i class="fas fa-wifi"></i>
                <h2>CloudHost247 LTE Proxy Dashboard</h2>
            </div>
            <div class="ch247-header-meta">
                <span class="ch247-version">v{$moduleVersion}</span>
                {if $orderId}
                    <span class="ch247-badge ch247-badge-success">Active</span>
                {else}
                    <span class="ch247-badge ch247-badge-warning">Pending</span>
                {/if}
            </div>
        </div>
    </div>

    {* Quick Stats Row *}
    {if $orderId}
    <div class="ch247-stats-grid">
        <div class="ch247-stat-card">
            <div class="ch247-stat-icon ch247-stat-blue">
                <i class="fas fa-network-wired"></i>
            </div>
            <div class="ch247-stat-info">
                <span class="ch247-stat-value" id="proxy-count">-</span>
                <span class="ch247-stat-label">Active Proxies</span>
            </div>
        </div>
        <div class="ch247-stat-card">
            <div class="ch247-stat-icon ch247-stat-green">
                <i class="fas fa-wallet"></i>
            </div>
            <div class="ch247-stat-info">
                <span class="ch247-stat-value" id="balance-display">${$balance|number_format:2}</span>
                <span class="ch247-stat-label">API Balance</span>
            </div>
        </div>
        <div class="ch247-stat-card">
            <div class="ch247-stat-icon ch247-stat-orange">
                <i class="fas fa-clock"></i>
            </div>
            <div class="ch247-stat-info">
                <span class="ch247-stat-value" id="time-remaining">-</span>
                <span class="ch247-stat-label">Time Remaining</span>
            </div>
        </div>
        <div class="ch247-stat-card">
            <div class="ch247-stat-icon ch247-stat-purple">
                <i class="fas fa-shield-alt"></i>
            </div>
            <div class="ch247-stat-info">
                <span class="ch247-stat-value" id="order-status">-</span>
                <span class="ch247-stat-label">Order Status</span>
            </div>
        </div>
    </div>
    {/if}

    {* Navigation Tabs *}
    {if $orderId}
    <div class="ch247-tabs">
        <button class="ch247-tab active" data-tab="proxies">
            <i class="fas fa-list"></i> My Proxies
        </button>
        <button class="ch247-tab" data-tab="management">
            <i class="fas fa-cogs"></i> Management
        </button>
        <button class="ch247-tab" data-tab="testing">
            <i class="fas fa-tachometer-alt"></i> Speed Test
        </button>
        <button class="ch247-tab" data-tab="rotation">
            <i class="fas fa-sync-alt"></i> Rotation
        </button>
        <button class="ch247-tab" data-tab="history">
            <i class="fas fa-history"></i> History
        </button>
    </div>

    {* Tab Content: My Proxies *}
    <div class="ch247-tab-content active" id="tab-proxies">
        <div class="ch247-section">
            <div class="ch247-section-header">
                <h3><i class="fas fa-network-wired"></i> Your Proxies</h3>
                <div class="ch247-actions">
                    <button class="ch247-btn ch247-btn-secondary" id="refresh-proxies">
                        <i class="fas fa-sync-alt"></i> Refresh
                    </button>
                    <button class="ch247-btn ch247-btn-primary" id="batch-test-btn">
                        <i class="fas fa-vial"></i> Test All
                    </button>
                </div>
            </div>
            <div class="ch247-proxy-table-wrapper">
                <table class="ch247-proxy-table" id="proxy-table">
                    <thead>
                        <tr>
                            <th>Proxy</th>
                            <th>Type</th>
                            <th>Region</th>
                            <th>Carrier</th>
                            <th>Status</th>
                            <th>Expires</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="proxy-table-body">
                        <tr>
                            <td colspan="7" class="ch247-loading">
                                <i class="fas fa-spinner fa-spin"></i> Loading proxies...
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    {* Tab Content: Management *}
    <div class="ch247-tab-content" id="tab-management">
        <div class="ch247-grid-2">
            <div class="ch247-section">
                <div class="ch247-section-header">
                    <h3><i class="fas fa-map-marker-alt"></i> Change Region</h3>
                </div>
                <div class="ch247-form">
                    <div class="ch247-form-group">
                        <label>Select Proxy</label>
                        <select class="ch247-select" id="manage-proxy-select"></select>
                    </div>
                    <div class="ch247-form-group">
                        <label>New Region</label>
                        <select class="ch247-select" id="region-select">
                            {foreach from=$regions key=key item=name}
                                <option value="{$key}">{$name}</option>
                            {/foreach}
                        </select>
                    </div>
                    <button class="ch247-btn ch247-btn-primary" id="update-region-btn">
                        <i class="fas fa-save"></i> Update Region
                    </button>
                </div>
            </div>

            <div class="ch247-section">
                <div class="ch247-section-header">
                    <h3><i class="fas fa-signal"></i> Change Carrier</h3>
                </div>
                <div class="ch247-form">
                    <div class="ch247-form-group">
                        <label>Select Proxy</label>
                        <select class="ch247-select" id="carrier-proxy-select"></select>
                    </div>
                    <div class="ch247-form-group">
                        <label>New Carrier</label>
                        <select class="ch247-select" id="carrier-select">
                            {foreach from=$carriers key=key item=name}
                                <option value="{$key}">{$name}</option>
                            {/foreach}
                        </select>
                    </div>
                    <button class="ch247-btn ch247-btn-primary" id="update-carrier-btn">
                        <i class="fas fa-save"></i> Update Carrier
                    </button>
                </div>
            </div>

            <div class="ch247-section">
                <div class="ch247-section-header">
                    <h3><i class="fas fa-exchange-alt"></i> Change Proxy Type</h3>
                </div>
                <div class="ch247-form">
                    <div class="ch247-form-group">
                        <label>Select Proxy</label>
                        <select class="ch247-select" id="type-proxy-select"></select>
                    </div>
                    <div class="ch247-form-group">
                        <label>Protocol</label>
                        <select class="ch247-select" id="proxy-type-select">
                            {foreach from=$proxyTypes item=type}
                                <option value="{$type}">{$type}</option>
                            {/foreach}
                        </select>
                    </div>
                    <button class="ch247-btn ch247-btn-primary" id="update-type-btn">
                        <i class="fas fa-save"></i> Update Type
                    </button>
                </div>
            </div>

            <div class="ch247-section">
                <div class="ch247-section-header">
                    <h3><i class="fas fa-lock"></i> Authentication</h3>
                </div>
                <div class="ch247-form">
                    <div class="ch247-form-group">
                        <label>Select Proxy</label>
                        <select class="ch247-select" id="auth-proxy-select"></select>
                    </div>
                    <div class="ch247-form-group">
                        <label>Auth Method</label>
                        <select class="ch247-select" id="auth-type-select">
                            {foreach from=$authTypes key=key item=name}
                                <option value="{$key}">{$name|replace:'_':' '|capitalize}</option>
                            {/foreach}
                        </select>
                    </div>
                    <div class="ch247-form-group" id="auth-ip-group" style="display:none;">
                        <label>IP Whitelist</label>
                        <input type="text" class="ch247-input" id="auth-client-ip" value="" placeholder="Your IP address">
                    </div>
                    <div class="ch247-form-group" id="auth-password-group" style="display:none;">
                        <label>New Password</label>
                        <input type="password" class="ch247-input" id="auth-password" placeholder="Leave blank to keep current">
                    </div>
                    <button class="ch247-btn ch247-btn-primary" id="update-auth-btn">
                        <i class="fas fa-save"></i> Update Auth
                    </button>
                </div>
            </div>
        </div>
    </div>

    {* Tab Content: Speed Test *}
    <div class="ch247-tab-content" id="tab-testing">
        <div class="ch247-section">
            <div class="ch247-section-header">
                <h3><i class="fas fa-tachometer-alt"></i> Proxy Speed Testing</h3>
                <button class="ch247-btn ch247-btn-primary" id="run-speed-test">
                    <i class="fas fa-play"></i> Run Speed Test
                </button>
            </div>
            <div class="ch247-test-results" id="speed-test-results">
                <div class="ch247-empty-state">
                    <i class="fas fa-tachometer-alt"></i>
                    <p>Select a proxy and run a speed test to see results</p>
                </div>
            </div>
        </div>
    </div>

    {* Tab Content: Rotation *}
    <div class="ch247-tab-content" id="tab-rotation">
        <div class="ch247-section">
            <div class="ch247-section-header">
                <h3><i class="fas fa-sync-alt"></i> Proxy Rotation Controls</h3>
            </div>
            <div class="ch247-rotation-grid" id="rotation-list">
                <div class="ch247-loading">
                    <i class="fas fa-spinner fa-spin"></i> Loading rotation status...
                </div>
            </div>
        </div>
    </div>

    {* Tab Content: History *}
    <div class="ch247-tab-content" id="tab-history">
        <div class="ch247-section">
            <div class="ch247-section-header">
                <h3><i class="fas fa-history"></i> Order History</h3>
            </div>
            <div class="ch247-history-list" id="order-history">
                <div class="ch247-loading">
                    <i class="fas fa-spinner fa-spin"></i> Loading history...
                </div>
            </div>
        </div>
    </div>
    {else}
    {* No Active Order State *}
    <div class="ch247-empty-state ch247-empty-large">
        <i class="fas fa-wifi"></i>
        <h3>No Active Proxy Order</h3>
        <p>Your proxy service is being set up. This may take a few moments after payment confirmation.</p>
        <div class="ch247-setup-info">
            <div class="ch247-info-item">
                <i class="fas fa-info-circle"></i>
                <span>Service ID: {$serviceId}</span>
            </div>
            <div class="ch247-info-item">
                <i class="fas fa-clock"></i>
                <span>Status: Pending provisioning</span>
            </div>
        </div>
    </div>
    {/if}

    {* Toast Notifications Container *}
    <div class="ch247-toast-container" id="toast-container"></div>

    {* Modal Container *}
    <div class="ch247-modal-overlay" id="modal-overlay">
        <div class="ch247-modal">
            <div class="ch247-modal-header">
                <h3 id="modal-title">Modal Title</h3>
                <button class="ch247-modal-close" id="modal-close">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="ch247-modal-body" id="modal-body"></div>
            <div class="ch247-modal-footer" id="modal-footer"></div>
        </div>
    </div>
</div>

<script>
window.CH247Config = {
    serviceId: {$serviceId},
    csrfToken: '{$csrfToken}',
    orderId: '{$orderId}',
    ajaxUrl: '{$systemurl}modules/servers/cloudhost247_lteproxy/ajax/',
    regions: {json_encode($regions)},
    carriers: {json_encode($carriers)},
    proxyTypes: {json_encode($proxyTypes)},
    rotationTypes: {json_encode($rotationTypes)},
    authTypes: {json_encode($authTypes)},
    connectionTypes: {json_encode($connectionTypes)}
};
</script>
