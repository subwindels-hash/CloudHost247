<div class="page-container">
    <div class="page-content" id="MGPage{$currentPageName}">
        <div id="{$mainContainer->getVueInstanceName()}" class="vue-app-main-container">
            <div class="lu-app">
                <div class="lu-app-header"></div>
                <div class="lu-app-navbar"></div>
                <div class="lu-app-main">
                    <div class="lu-app-main__body">
                        <div class="lu-block">
                            <div class="lu-block__sidebar">
                                {foreach from=$mainContainer->getElements('navbar') item=sidebar}
                                    {$sidebar->getHtml()}
                                {/foreach}
                            </div>
                            <div class="lu-block__body">
                                <div class="lu-row"><i v-show="pageLoading" class="page_processing"></i></div>
                                {foreach from=$elements key=nameElement item=dataElement}
                                    {$dataElement->getHtml()}
                                {/foreach}
                                <div class="lu-preloader-container lu-preloader-container--full-screen lu-preloader-container--overlay" v-show="pagePreLoader">
                                    <div class="lu-preloader lu-preloader--lg"></div>
                                </div>
                                <div id="{$mainContainer->getVueInstanceName()}_modal" class="vue-app-main-modal-container" onclick="mgPageControler.closeModal(event);"></div>

                                <div id="loadedTemplates"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
