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

{literal}
{/literal}{if $rawObject->getTableRowCol()}{literal}
<div class="lu-row">
    <div class="{/literal}{$rawObject->getTableRowCol()}{literal} " id="{/literal}{$rawObject->getId()}" namespace="{$namespace}" index="{$rawObject->getIndex()}"{literal}>
        {/literal}{/if}{literal}
        <mg-graph
                v-bind:elementindexprop='"{/literal}{$elementId}{literal}"'
                v-bind:namespaceprop='"{/literal}{$namespace}{literal}"'
                v-bind:indexprop='"{/literal}{$rawObject->getIndex()}{literal}"'
                inline-template>
            <div class="lu-widget vueDatatableTable widgetActionComponent" id="graph_{/literal}{$elementId}{literal}" actionid="{/literal}{$rawObject->getIndex()}{literal}">
                {/literal}{if $rawObject->getRawTitle() || $rawObject->getTitle() || $rawObject->titleButtonIsExist()}{literal}
                    <div class="lu-widget__header">
                    <div class="lu-widget__top top">
                {/literal}{if $rawObject->getRawTitle() || $rawObject->getTitle()}{literal}
                    <div class="lu-top__title">
                {/literal} {if $rawObject->getIcon()}<i class="{$rawObject->getIcon()}"></i>{/if}{if $rawObject->isRawTitle()}{$rawObject->getRawTitle()}{elseif $rawObject->getTitle()}{$MGLANG->T($rawObject->getTitle())}{/if} {literal}
                    </div>
                {/literal}{/if}{literal}
                {/literal}{if $rawObject->titleButtonIsExist()}{literal}
                    <div class="lu-top__toolbar">
                {/literal} {foreach from=$rawObject->getTitleButtons() key=buttonKey item=buttonValue} {$buttonValue->getHtml()} {/foreach} {literal}
                    </div>
                {/literal}{/if}{literal}
                    </div>
                    </div>
                {/literal}{/if}{literal}
                <div class="lu-widget__body">
                    <canvas id="{/literal}{$elementId}{literal}" width="{/literal}{$rawObject->getGraphWidth()}{literal}" height="{/literal}{$rawObject->getGraphHeight()}{literal}"></canvas>
                    <div class="lu-preloader-container lu-preloader-container--full-screen lu-preloader-container--overlay" v-show="loading">
                        <div class="lu-preloader lu-preloader--sm"></div>
                    </div>
                </div>
                {/literal}{if ($isDebug eq true AND (count($MGLANG->getMissingLangs()) != 0))}{literal}
                    <div class="lu-row" style="max-width: 95%;">
                {/literal}{foreach from=$MGLANG->getMissingLangs() key=varible item=value}{literal}
                    <div class="lu-col-md-12"><b>{/literal}{$varible}{literal}</b> = '{/literal}{$value}{literal}';</div>
                {/literal}{/foreach}{literal}
                    </div>
                {/literal}{/if}{literal}
            </div>

        </mg-graph>
        {/literal}{if $rawObject->getTableRowCol()}{literal}
    </div>
</div>
{/literal}{/if}