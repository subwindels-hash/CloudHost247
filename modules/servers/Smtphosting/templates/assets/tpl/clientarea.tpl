<div class="panel panel-default">
    <!-- Default panel contents -->
    {if $configURL}
        <div class="alert alert-info">
            {$MGLANG->T('awaitingConfigurationAlert')}
        </div>
        <a class="btn btn-primary" href="{$configURL}">{$MGLANG->T('awaitingConfiguration')}</a>
    {else}
        {if $details}
            <div class="panel-heading"><b>Information</b></div>
            <table class="table">
                <tbody>
                {foreach from=$details key=name item=value}
                    <tr>
                        <td>{$name}</td>
                        <td class="text-secondary">

                            {if $name =="Status"}
                                <span class="{if $value=='Running'}text-success{else}text-danger{/if}">
                         <i class="glyphicon glyphicon-play-circle"></i>
                           {$value}
                       </span>
                            {else}
                                {$value}
                            {/if}
                        </td>
                    </tr>
                {/foreach}
                </tbody>
            </table>
        {/if}

    {/if}
</div>
