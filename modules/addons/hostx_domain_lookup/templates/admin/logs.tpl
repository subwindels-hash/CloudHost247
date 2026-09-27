{* HostX Tools - Admin Logs *}

<div class="hostx-admin-logs">
    <div class="hostx-admin-header">
        <h2><i class="fa fa-list-alt"></i> Request Logs</h2>
        <p class="text-muted">Recent tool usage and API request history</p>
    </div>
    
    <div class="panel panel-default">
        <div class="panel-heading">
            <h3 class="panel-title"><i class="fa fa-history"></i> Recent Requests</h3>
        </div>
        <div class="panel-body">
            {if $logs}
            <div class="table-responsive">
                <table class="table table-striped table-hover">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Time</th>
                            <th>Tool</th>
                            <th>Query</th>
                            <th>Source</th>
                            <th>Status</th>
                            <th>IP Address</th>
                            <th>Message</th>
                        </tr>
                    </thead>
                    <tbody>
                        {foreach from=$logs item=log}
                        <tr>
                            <td>{$log->id}</td>
                            <td>{$log->created_at}</td>
                            <td>
                                {if $log->tool == 'domain_whois'}
                                    <span class="label label-primary">WHOIS</span>
                                {elseif $log->tool == 'ip_whois'}
                                    <span class="label label-success">IP</span>
                                {elseif $log->tool == 'dns_lookup'}
                                    <span class="label label-info">DNS</span>
                                {elseif $log->tool == 'availability'}
                                    <span class="label label-warning">Avail</span>
                                {else}
                                    <span class="label label-default">{$log->tool}</span>
                                {/if}
                            </td>
                            <td><code>{$log->query}</code></td>
                            <td><span class="label label-default">{$log->source}</span></td>
                            <td>
                                {if $log->status == 'success'}
                                    <span class="label label-success"><i class="fa fa-check"></i> Success</span>
                                {else}
                                    <span class="label label-danger"><i class="fa fa-times"></i> Error</span>
                                {/if}
                            </td>
                            <td>{$log->ip_address}</td>
                            <td>
                                {if $log->message}
                                    <small class="text-muted">{$log->message}</small>
                                {else}
                                    -
                                {/if}
                            </td>
                        </tr>
                        {/foreach}
                    </tbody>
                </table>
            </div>
            {else}
            <div class="text-center text-muted">
                <p><i class="fa fa-info-circle fa-2x"></i></p>
                <p>No request logs found. Logs will appear here once tools are used.</p>
            </div>
            {/if}
        </div>
    </div>
    
    <div class="text-right">
        <a href="{$moduleLink}&action=dashboard" class="btn btn-default">
            <i class="fa fa-arrow-left"></i> Back to Dashboard
        </a>
    </div>
</div>
