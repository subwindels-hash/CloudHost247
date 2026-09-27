<div class="row">
    <div class="col-lg-12 center-block">
        {if $details['warning']}
            <div class="alert alert-warning ">
                {$details['warning']}
            </div>
        {elseif $details}
            <div class="panel-heading"><b>{$MGLANG->T('ProxmoxVPS', 'Information')}</b></div>
            <table class="table">
                {foreach from=$details key=detail item=value}
                    {if $value !== '' && !is_null($value)}
                        <tr>
                            <td>{$MGLANG->T($detail)}</td>
                            {if $detail == 'Status'}
                                <td>
                                    <span class="{if $value=='Running'}text-success{else}text-danger{/if}">
                                        {$value}
                                    </span>
                                </td>
                            {else}
                                <td>{$value}</td>
                            {/if}
                        </tr>
                    {/if}

                {/foreach}
            </table>
        {else}
            <table class="table table-striped">
                <div class="alert alert-info">
                    {$MGLANG->T('proxmoxVMConfigurationsSucces')}
                </div>
            </table>
        {/if}
    </div>
</div>

<style>
    .alert-warning {
        border-color: #ffeeba;
        color: #856404 !important;
        background-color: #fff3cd !important;

    }
</style>

