<div class="lu-mg-wrapper body" data-target=".body" data-spy="scroll" data-twttr-rendered="true">

    <link href="https://fonts.googleapis.com/css?family=Roboto:300,400,500,700" rel="stylesheet">
    <link rel="stylesheet" href="{$assetsURL}/css/layers-ui.css">
    <link rel="stylesheet" href="{$assetsURL}/css/styles.css">

    <div class="full-screen-module-container" id="layers">
        <div class="clearfix"></div>
        <div class="page-container">
            <div class="page-content" id="MGPage{$currentPageName}">
                <div class="lu-container-fluid">
                    <div class="lu-block">
                        <div class="lu-block__body">
                            <div class="lu-widget">
                                <div class="lu-widget__body">
                                    <div class="lu-zero-data">
                                        <div class="lu-msg">
                                            <div class="lu-msg__body">
                                                <div class="lu-msg__title lu-type-4">
                                                    {$MGLANG->absoluteT('addonCA', 'pageNotFound', 'title')}
                                                </div>
                                                <p class="lu-msg__description">
                                                    {$MGLANG->absoluteT('addonCA', 'pageNotFound', 'description')}
                                                </p>
                                                <div class="lu-msg__actions">
                                                    <a class="lu-btn lu-btn--lg lu-btn--primary" href="javascript:;" onclick="window.history.back();">
                                                        <span class="lu-btn__text">{$MGLANG->absoluteT('addonCA', 'pageNotFound', 'button')}</span>
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
</div>
