{*TODO change ip when ip binding enabled, and creation/expiration dates*}
{if $serviceStatus}
    <div class="panel panel-default">
        <div class="panel-heading"><b>{$MGLANG->T('PleskKeyAdministrator', 'licenseDetails')}</b></div>
        <table class="table">
            <tbody>

            {if $details['Key Number']}
                <tr role="row">
                    <td>{$MGLANG->T('PleskKeyAdministrator', 'Key Number')}</td>
                    <td class="text-secondary">
                        {$details['Key Number']}
                    </td>
                </tr>
            {/if}
            {if $details['Product Key']}
                <tr role="row">
                    <td>{$MGLANG->T('PleskKeyAdministrator', 'Product Key')}</td>
                    <td class="text-secondary">
                        {$details['Product Key']}
                    </td>
                </tr>
            {/if}
            {if $details['Key Type']}
                <tr role="row">
                    <td>{$MGLANG->T('PleskKeyAdministrator', 'Key Type')}</td>
                    <td class="text-secondary">
                        {$details['Key Type']}
                    </td>
                </tr>
            {/if}
            {if array_key_exists('IP Binding', $details)}
                <tr role="row">
                    <td>{$MGLANG->T('PleskKeyAdministrator', 'IP Binding')}</td>
                    {if $details['IP Binding']}
                        <td class="text-secondary">
                            {$MGLANG->T('PleskKeyAdministrator', 'disabled')}
                        </td>
                    {else}
                        <td class="text-secondary">
                            {$MGLANG->T('PleskKeyAdministrator', 'enabled')}
                        </td>
                    {/if}
                </tr>
            {/if}
            </tr>
            </tbody>
        </table>
    </div>
{/if}

