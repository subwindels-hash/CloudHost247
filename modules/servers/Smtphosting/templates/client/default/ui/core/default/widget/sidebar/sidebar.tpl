<div class="lu-block">
    <div class="lu-block__sidebar">
        <div>
            <div class="lu-inner-wrapper-sticky">
                <div class="lu-widget">
                    <div class="lu-widget__header">
                        <div class="lu-widget__top lu-top">
                            <div class="lu-top__title">{$MGLANG->T($rawObject->getId())}</div>
                        </div>
                    </div>
                    <div class="lu-widget__body">
                        <ul class="lu-nav lu-nav--tabs lu-nav--border-left">
                            {foreach from=$rawObject->get() item=sidebarItem}
                                {$sidebarItem->getHtml()}
                            {/foreach}
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
