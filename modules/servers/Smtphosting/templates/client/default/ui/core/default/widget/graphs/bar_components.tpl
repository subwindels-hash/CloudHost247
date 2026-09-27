{**********************************************************************
* AmazonLightsail product developed. (2017-10-10)
*
*
*  CREATED BY MODULESGARDEN       ->       http://modulesgarden.com
*  CONTACT                        ->       contact@modulesgarden.com
*
*
* This software is furnished under a license and may be used and copied
* only  in  accordance  with  the  terms  of such  license and with the
* inclusion of the above copyright notice.  This software  or any other
* copies thereof may not be provided or otherwise made available to any
* other person.  No title to and  ownership of the  software is  hereby
* transferred.
*
*
**********************************************************************}

{**
* @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
*}

<script type="text/x-template" id="t-mg-graph-{$elementId|strtolower}"
        :component_id="component_id"
        :component_namespace="component_namespace"
        :component_index="component_index"
>
    <div class="lu-widget vueDatatableTable widgetActionComponent" id="graph_{$elementId}" actionid="{$rawObject->getIndex()}">
        {if $rawObject->getRawTitle() || $rawObject->getTitle() || $rawObject->titleButtonIsExist()}
            <div class="lu-widget__header">
                <div class="lu-widget__top lu-top">
                    {if $rawObject->getRawTitle() || $rawObject->getTitle()}
                        <div class="lu-top__title">
                            {if $rawObject->getIcon()}<i class="{$rawObject->getIcon()}"></i>{/if}{if $rawObject->isRawTitle()}{$rawObject->getRawTitle()}{elseif $rawObject->getTitle()}{$MGLANG->T($rawObject->getTitle())}{/if}
                        </div>
                    {/if}
                    {if $rawObject->titleButtonIsExist()}
                        <div class="lu-top__toolbar">
                            {foreach from=$rawObject->getTitleButtons() key=buttonKey item=buttonValue} {$buttonValue->getHtml()} {/foreach}
                        </div>
                    {/if}
                </div>
            </div>
        {/if}
        <div class="lu-widget__body">
            <canvas id="canv_{$elementId}" width="{$rawObject->getGraphWidth()}" height="{$rawObject->getGraphHeight()}"></canvas>
            <div class="lu-preloader-container lu-preloader-container--full-screen lu-preloader-container--overlay" v-show="loading">
                <div class="lu-preloader lu-preloader--sm"></div>
            </div>
        </div>
        {if ($isDebug eq true AND (count($MGLANG->getMissingLangs()) != 0))}
            <div class="lu-row" style="max-width: 95%;">
                {foreach from=$MGLANG->getMissingLangs() key=varible item=value}
                    <div class="lu-col-md-12"><b>{$varible}</b> = '{$value}';</div>
                {/foreach}
            </div>
        {/if}
    </div>
</script>
