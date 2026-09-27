<div class="lu-col-md-12">
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

    <script>
        if (typeof whmcsPostOriginal === 'undefined')
        {
            var whmcsPostOriginal = {};
            Object.assign(whmcsPostOriginal, WHMCS.http.jqClient);

            function whmcsPostWrapper(t, e, i, n)
            {
                if (typeof e.indexOf !== 'undefined' && e.indexOf('modop'))
                {
                    if (typeof mgPageControler !== 'undefined' && typeof mgPageControler.vueLoader !== 'undefined' && mgPageControler.vueLoader !== false)
                    {
                        for (var key in mgPageControler.vueLoader.$children)
                        {
                            if (!mgPageControler.vueLoader.$children.hasOwnProperty(key))
                            {
                                continue;
                            }
                            mgPageControler.vueLoader.$children[key].$destroy();
                            mgPageControler.vueLoader.$children[key] = false;
                        }
                        mgPageControler.vueLoader.$destroy();
                        mgPageControler.vueLoader = false;

                        $(".lu-tooltip").remove();
                    }
                }

                return whmcsPostOriginal.post(t, e, i, n);
            }

            WHMCS.http.jqClient.post = whmcsPostWrapper;
        }

        function mgWaitForAssets()
        {
            setTimeout(function () {
                if (typeof window.Vue === 'function' && typeof window.mgLoadPageContoler === 'function'
                    && typeof window.initMassActionsOnDatatables === 'function')
                {
                    if ((typeof mgPageControler !== 'undefined' && mgPageControler.vueLoader === false) || (typeof mgPageControler === 'undefined'))
                    {
                        mgLoadPageContoler();
                        mgEventHandler.on('AppCreated', null, function (appId, params) {
                            params.instance.$nextTick(function () {
                                initContainerTooltips('layers');
                            });
                        }, 1000);
                    }
                } else
                {
                    mgWaitForAssets();
                }
            }, 1000);
        }

        mgWaitForAssets();
    </script>
</div>
