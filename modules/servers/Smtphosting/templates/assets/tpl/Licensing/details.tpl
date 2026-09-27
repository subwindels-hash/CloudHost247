{if !empty($details)}
    <div class="panel panel-default">
        <div class="panel-heading"><b>{$MGLANG->T('Licensing', 'licenseDetails')}</b></div>
        <table class="table">
            <tbody>
                <tr role="row">
                    <td>{$MGLANG->T('Licensing', 'licensekey')}</td>
                    <td class="text-secondary">
                        {$details['licensekey']}
                    </td>
                </tr>
                <tr role="row">
                    <td>{$MGLANG->T('Licensing', 'validdomain')}</td>
                    <td class="text-secondary">
                        {str_replace(',', ', ', $details['validdomain'])}
                    </td>
                </tr>
                <tr role="row">
                    <td>{$MGLANG->T('Licensing', 'validip')}</td>
                    <td class="text-secondary">
                        {str_replace(',', ', ', $details['validip'])}
                    </td>
                </tr>
                <tr role="row">
                    <td>{$MGLANG->T('Licensing', 'validdirectory')}</td>
                    <td class="text-secondary">
                        {$details['validdirectory']}
                    </td>
                </tr>
                <tr role="row">
                    <td>{$MGLANG->T('Licensing', 'status')}</td>
                    <td class="text-secondary">
                        {$details['status']}
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
{/if}
