{* CloudHost247 LTE Proxy Admin Dashboard *}
{* Version: 1.0.0 *}

<div class="ch247-admin-dashboard">
    <div class="ch247-admin-header">
        <h2><i class="fas fa-wifi"></i> CloudHost247 LTE Proxy Admin</h2>
        <span class="ch247-admin-version">v{$moduleVersion}</span>
    </div>

    {* Stats Cards *}
    <div class="ch247-admin-stats">
        <div class="ch247-admin-stat">
            <i class="fas fa-network-wired"></i>
            <div>
                <span class="ch247-admin-stat-value">{$stats.totalServices|default:0}</span>
                <span class="ch247-admin-stat-label">Total Services</span>
            </div>
        </div>
        <div class="ch247-admin-stat">
            <i class="fas fa-check-circle"></i>
            <div>
                <span class="ch247-admin-stat-value">{$stats.activeServices|default:0}</span>
                <span class="ch247-admin-stat-label">Active</span>
            </div>
        </div>
        <div class="ch247-admin-stat">
            <i class="fas fa-exclamation-triangle"></i>
            <div>
                <span class="ch247-admin-stat-value">{$stats.suspendedServices|default:0}</span>
                <span class="ch247-admin-stat-label">Suspended</span>
            </div>
        </div>
        <div class="ch247-admin-stat">
            <i class="fas fa-dollar-sign"></i>
            <div>
                <span class="ch247-admin-stat-value">{$apiBalance|default:'$0.00'}</span>
                <span class="ch247-admin-stat-label">API Balance</span>
            </div>
        </div>
    </div>

    {* Recent Activity *}
    <div class="ch247-admin-section">
        <div class="ch247-section-header">
            <h3><i class="fas fa-list"></i> Recent Proxy Services</h3>
        </div>
        <div class="ch247-table-wrapper">
            <table class="ch247-table">
                <thead>
                    <tr>
                        <th>Service ID</th>
                        <th>Client</th>
                        <th>Order ID</th>
                        <th>Status</th>
                        <th>Proxies</th>
                        <th>Created</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {if $recentServices}
                        {foreach from=$recentServices item=svc}
                        <tr>
                            <td>{$svc.id}</td>
                            <td>{$svc.clientName}</td>
                            <td><code>{$svc.orderId}</code></td>
                            <td>
                                <span class="ch247-badge ch247-badge-{if $svc.status == 'Active'}success{elseif $svc.status == 'Suspended'}warning{else}danger{/if}">
                                    {$svc.status}
                                </span>
                            </td>
                            <td>{$svc.proxyCount}</td>
                            <td>{$svc.createdAt}</td>
                            <td>
                                <a href="clientsservices.php?userid={$svc.clientId}&id={$svc.id}" class="ch247-btn ch247-btn-sm ch247-btn-secondary">
                                    <i class="fas fa-eye"></i> View
                                </a>
                            </td>
                        </tr>
                        {/foreach}
                    {else}
                        <tr>
                            <td colspan="7" class="ch247-empty-cell">No proxy services found</td>
                        </tr>
                    {/if}
                </tbody>
            </table>
        </div>
    </div>

    {* API Status *}
    <div class="ch247-admin-section">
        <div class="ch247-section-header">
            <h3><i class="fas fa-server"></i> API Connection Status</h3>
            <span class="ch247-status-indicator ch247-status-{if $apiConnected}online{else}offline{/if}">
                {if $apiConnected}Connected{else}Disconnected{/if}
            </span>
        </div>
        <div class="ch247-api-info">
            <div class="ch247-info-row">
                <span>API Base URL:</span>
                <code>{$apiBaseUrl}</code>
            </div>
            <div class="ch247-info-row">
                <span>API Key:</span>
                <code>{$maskedApiKey}</code>
            </div>
            <div class="ch247-info-row">
                <span>Response Time:</span>
                <span>{$apiResponseTime}ms</span>
            </div>
        </div>
    </div>
</div>
