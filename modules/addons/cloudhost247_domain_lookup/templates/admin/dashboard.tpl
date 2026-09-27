{* CloudHost247 Domain Lookup - Admin Dashboard *}

<div class="cloudhost247-admin-dashboard">
    <div class="cloudhost247-admin-header">
        <h2><i class="fa fa-wrench"></i> CloudHost247 Domain Lookup Dashboard</h2>
        <p class="text-muted">Overview of tool usage and system status</p>
    </div>
    
    <div class="row cloudhost247-stats-row">
        <div class="col-sm-3">
            <div class="cloudhost247-stat-card">
                <div class="cloudhost247-stat-icon cloudhost247-stat-blue">
                    <i class="fa fa-search"></i>
                </div>
                <div class="cloudhost247-stat-info">
                    <h3>{$stats.total_queries|number_format}</h3>
                    <p>Total Queries</p>
                </div>
            </div>
        </div>
        <div class="col-sm-3">
            <div class="cloudhost247-stat-card">
                <div class="cloudhost247-stat-icon cloudhost247-stat-green">
                    <i class="fa fa-calendar"></i>
                </div>
                <div class="cloudhost247-stat-info">
                    <h3>{$stats.today_queries|number_format}</h3>
                    <p>Today's Queries</p>
                </div>
            </div>
        </div>
        <div class="col-sm-3">
            <div class="cloudhost247-stat-card">
                <div class="cloudhost247-stat-icon cloudhost247-stat-orange">
                    <i class="fa fa-check-circle"></i>
                </div>
                <div class="cloudhost247-stat-info">
                    <h3>{$stats.success_rate}%</h3>
                    <p>Success Rate</p>
                </div>
            </div>
        </div>
        <div class="col-sm-3">
            <div class="cloudhost247-stat-card">
                <div class="cloudhost247-stat-icon cloudhost247-stat-red">
                    <i class="fa fa-exclamation-triangle"></i>
                </div>
                <div class="cloudhost247-stat-info">
                    <h3>{$stats.failed_queries|number_format}</h3>
                    <p>Failed Queries</p>
                </div>
            </div>
        </div>
    </div>
    
    <div class="row">
        <div class="col-md-6">
            <div class="panel panel-default cloudhost247-admin-panel">
                <div class="panel-heading">
                    <h3 class="panel-title"><i class="fa fa-bar-chart"></i> Top Tools</h3>
                </div>
                <div class="panel-body">
                    {if $stats.top_tools}
                    <table class="table table-striped">
                        <thead>
                            <tr>
                                <th>Tool</th>
                                <th class="text-right">Queries</th>
                            </tr>
                        </thead>
                        <tbody>
                            {foreach from=$stats.top_tools item=tool}
                            <tr>
                                <td>
                                    {if $tool->tool == 'domain_whois'}
                                        <i class="fa fa-globe text-primary"></i> Domain WHOIS
                                    {elseif $tool->tool == 'ip_whois'}
                                        <i class="fa fa-map-marker text-success"></i> IP Lookup
                                    {elseif $tool->tool == 'dns_lookup'}
                                        <i class="fa fa-server text-info"></i> DNS Lookup
                                    {elseif $tool->tool == 'availability'}
                                        <i class="fa fa-search text-warning"></i> Domain Availability
                                    {else}
                                        <i class="fa fa-wrench"></i> {$tool->tool}
                                    {/if}
                                </td>
                                <td class="text-right"><span class="badge">{$tool->count|number_format}</span></td>
                            </tr>
                            {/foreach}
                        </tbody>
                    </table>
                    {else}
                    <div class="text-center text-muted">
                        <p><i class="fa fa-info-circle fa-2x"></i></p>
                        <p>No data available yet. Tools will appear here once used.</p>
                    </div>
                    {/if}
                </div>
            </div>
        </div>
        
        <div class="col-md-6">
            <div class="panel panel-default cloudhost247-admin-panel">
                <div class="panel-heading">
                    <h3 class="panel-title"><i class="fa fa-cog"></i> Quick Settings</h3>
                </div>
                <div class="panel-body">
                    <div class="list-group cloudhost247-quick-links">
                        <a href="{$moduleLink}&action=logs" class="list-group-item">
                            <i class="fa fa-list-alt"></i> View Request Logs
                            <span class="pull-right"><i class="fa fa-arrow-right"></i></span>
                        </a>
                        <a href="configaddonmods.php?module=cloudhost247_domain_lookup" class="list-group-item">
                            <i class="fa fa-cogs"></i> Module Configuration
                            <span class="pull-right"><i class="fa fa-arrow-right"></i></span>
                        </a>
                        <a href="https://www.whatismyip.com/" target="_blank" class="list-group-item">
                            <i class="fa fa-external-link"></i> Get WhatIsMyIP API Key
                            <span class="pull-right"><i class="fa fa-arrow-right"></i></span>
                        </a>
                        <a href="https://ipinfo.io/" target="_blank" class="list-group-item">
                            <i class="fa fa-external-link"></i> Get IPinfo Token
                            <span class="pull-right"><i class="fa fa-arrow-right"></i></span>
                        </a>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <div class="panel panel-default cloudhost247-admin-panel">
        <div class="panel-heading">
            <h3 class="panel-title"><i class="fa fa-info-circle"></i> Module Information</h3>
        </div>
        <div class="panel-body">
            <div class="row">
                <div class="col-md-4">
                    <p><strong>Version:</strong> {$version}</p>
                    <p><strong>Compatible:</strong> WHMCS 8.x, CloudHost247 v2.2.6</p>
                </div>
                <div class="col-md-4">
                    <p><strong>PHP Version:</strong> {$smarty.const.PHP_VERSION}</p>
                    <p><strong>IonCube:</strong> {if extension_loaded('ioncube_loader')}Loaded{else}Not Required{/if}</p>
                </div>
                <div class="col-md-4">
                    <p><strong>Cache Method:</strong> {if $smarty.session.cloudhost247_cache_method}{$smarty.session.cloudhost247_cache_method}{else}Database{/if}</p>
                    <p><strong>Debug Mode:</strong> {if $smarty.session.cloudhost247_debug}Enabled{else}Disabled{/if}</p>
                </div>
            </div>
        </div>
    </div>
</div>
