<style>
    .csrText {
        resize: vertical;
        min-height: 300px;
        overflow: auto;
    }
</style>
<div class="row">
    <div class="col-lg-12 center-block">
        {if $configURL}
            <div class="alert alert-info">
                {$MGLANG->T('awaitingConfigurationAlert')}
            </div>
            <a class="btn btn-primary" href="{$configURL}">{$MGLANG->T('awaitingConfiguration')}</a>
        {else}
            {if isset($status)}

                {if $status == "PENDING_ISSUANCE"}
                    <div class="alert alert-info">
                        {$MGLANG->T('domainControlVerification')}
                    </div>
                {/if}
                <table class="table table-striped">
                    <tr>
                        <td>{$MGLANG->T('productType')}</td>
                        <td>{$MGLANG->absoluteT($productType)}</td>
                    </tr>
                    <tr>
                        <td>{$MGLANG->T('status')}</td>
                        <td>{$MGLANG->absoluteT($status)}</td>
                    </tr>
                    <tr>
                        <td>{$MGLANG->T('commonName')}</td>
                        <td><a href="http://{$commonName}" target="_blank">{$commonName}</a></td>
                    </tr>
                    <tr>
                        <td>{$MGLANG->T('period')}</td>
                        <td>{$period}</td>
                    </tr>

                    {if $expiryDate}
                        <tr>
                            <td>{$MGLANG->T('expiryDate')}</td>
                            <td>{$expiryDate}</td>
                        </tr>
                    {/if}
                    {if $cert}
                        <tr>
                            <td colspan="2">
                                <button type="button" class="btn btn-primary" data-toggle="modal"
                                        data-target="#csrModal">{$MGLANG->T('download')}</button>
                            </td>
                        </tr>
                    {/if}
                </table>
            {else}
                <div class="alert alert-info">
                    {$MGLANG->T('awaitingConfigurationLabel')}
                </div>
            {/if}

        {/if}

    </div>
</div>
{if $cert}
    <!-- Modal -->
    <div class="modal fade" id="csrModal" tabindex="-1" role="dialog" aria-labelledby="csrModelLabel" aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">{$MGLANG->T('certificate')}</h5>
                </div>
                <div class="modal-body">
                    <textarea class="form-control csrText" rows="5" readonly>
                        {trim($cert)}
                    </textarea>
                </div>
                <div class="modal-footer">
                    <button type="button" id="download-csr" class="btn btn-default"
                            onclick="downloadTxt(`{$cert}`, `{$commonName}`,`{'crt'}`)"
                            style="margin:2px">{$MGLANG->T('get')}</button>
                    <button type="button" class="btn btn-primary selectAll">{$MGLANG->T('selectAll')}</button>
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">{$MGLANG->T('close')}</button>
                </div>
            </div>
        </div>
    </div>
{/if}

<script type="text/javascript">
    {literal}
    $(document).ready(function () {
        $('.selectAll').on('click', function () {
            $('.csrText').select();
        })

    })

    function downloadTxt(cert, domain, suffix)
    {
        var blob = new Blob([cert], {type: suffix});

        var a = document.createElement('a');
        a.download = domain + "." + suffix;
        a.href = URL.createObjectURL(blob);
        a.dataset.downloadurl = [suffix, a.download, a.href].join(':');
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () {
            URL.revokeObjectURL(a.href);
        }, 1500);
    }
    {/literal}
</script>