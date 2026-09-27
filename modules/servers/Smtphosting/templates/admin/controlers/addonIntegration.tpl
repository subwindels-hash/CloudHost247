<div class="col-md-12">
    {include file='assets/css_assets.tpl'}

    {if $isCustomIntegrationCss}
        <link rel="stylesheet" href="{$customAssetsURL}/css/integration.css">
    {/if}

    <div id="layers">
        <div class="lu-app">
            <div class="lu-app-main">
                <div class="lu-app-main__body">
                    {$content}
                </div>
            </div>
        </div>
    </div>

    {include file='assets/js_assets.tpl'}
</div>
