<div class="intergation-ca-page">
    <div class="console-page-header">
        <h2>{$MGLANG->T('Virtualizor','vncConsole')}</h2>
        {if $shouldShowIntegration}
            <button class="btn btn-primary btn-console" href="javascript:void(0);"
                    onclick="launchHTML5vnc('{$vpsID}', '{$url}')">{$MGLANG->T('Virtualizor','launchVncInNewWindow')}</button>
        {/if}
    </div>
</div>
{if $shouldShowIntegration}
    <div id="no-vnc-external">
        {$novnc}
    </div>
{else}
    <div class="alert alert-danger text-center">{$MGLANG->T('Virtualizor', 'serverConnectionFailed')}</div>
{/if}

<script>
    Object.defineProperty(document, 'title', {
        set: function (newValue) {
        },
    });

    function launchHTML5vnc(vpsid, url)
    {
        window.open('clientarea.php?' + url + '&act=vnc&novnc=1&jsnohf=1&svs=' + vpsid, '_blank', 'height=400,width=720');
    }
</script>
