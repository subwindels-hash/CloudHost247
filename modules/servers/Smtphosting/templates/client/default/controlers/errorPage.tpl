<div class="mg-wrapper body" data-target=".body" data-spy="scroll" data-twttr-rendered="true">

    <link href="https://fonts.googleapis.com/css?family=Roboto:300,400,500,700" rel="stylesheet">
    <link rel="stylesheet" href="{$assetsURL}/css/layers-ui.css">
    <link rel="stylesheet" href="{$assetsURL}/css/mg_styles.css">
    <link rel="stylesheet" href="{$assetsURL}/css/module_styles.css">

    <div class="full-screen-module-container" id="layers">
        <div class="clearfix"></div>
        <div class="page-container">
            <div class="page-content" id="MGPage{$currentPageName}">
                <div class="lu-container-fluid">
                    <div class="lu-block">
                        <div class="lu-block__body">
                            <div class="lu-widget">
                                <div class="lu-widget__header lu-docs-color lu-bg-danger-lighter">
                                    {$MGLANG->absoluteT('addonCA', 'errorPage', 'error')}
                                </div>
                                <div class="lu-widget__body lu-docs-color lu-bg-danger-faded" style="min-height: 350px">
                                    <div class="lu-row">
                                        <div class="lu-col-md-12">
                                            <div class="lu-msg__title lu-type-4 lu-docs-color-name" style="margin-bottom: 35px; margin-top: 25px; text-align: center;">
                                                {$MGLANG->absoluteT('addonCA', 'errorPage', 'title')}
                                            </div>
                                        </div>
                                        <div class="lu-col-md-12">
                                            <div class="lu-msg">
                                                <div class="lu-msg__body">
                                                    <p class="lu-msg__description lu-docs-color-value" style="font-size: 16px; margin-bottom: 15px;">
                                                        {$MGLANG->absoluteT('addonCA', 'errorPage', 'description')}
                                                    </p>
                                                    {foreach from=$errorPageDetails key=dKey item=dValue}
                                                        <p class="lu-msg__description lu-docs-color-value" style="font-size: 14px; margin-top: 5px; margin-bottom: 5px;">
                                                            {$MGLANG->absoluteT('addonCA', 'errorPage', $dKey)}: {$dValue}
                                                        </p>
                                                    {/foreach}
                                                </div>
                                            </div>
                                        </div>
                                        <div class="lu-col-md-12" style="margin-top: 35px; margin-bottom: 15px; text-align: center;">
                                            <div class="lu-msg__actions">
                                                <a class="lu-btn lu-btn--lg lu-btn--default" href="javascript:;" onclick="window.history.back();" style="background-color: #f66e6e !important; color: #fff">
                                                    <span class="lu-btn__text">{$MGLANG->absoluteT('addonCA', 'errorPage', 'button')}</span>
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<div class="clear"></div>
