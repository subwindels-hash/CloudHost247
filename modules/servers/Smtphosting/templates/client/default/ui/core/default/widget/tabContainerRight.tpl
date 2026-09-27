{**********************************************************************
* AmazonLightsail product developed. (2017-08-24)
* *
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

<div class="row-fluid">
    <div class="box light" id="{$elementId}">
        <div class="box-title tabbable-line" style="border-bottom: 1px solid #eee!important;">
            {***CONTAINER*HEADER*TITLE***********************************************************}
            <div class="caption" style="display: inline-block!important; max-width: 15%;">
                {if $rawObject->getIcon()}<i class="{$rawObject->getIcon()}"></i>{/if}
                <span class="caption-subject bold font-red-thunderbird uppercase">
                    {if $rawObject->isRawTitle()}{$rawObject->getRawTitle()}{elseif $rawObject->getTitle()}{$MGLANG->T($rawObject->getTitle())}{/if}
                </span>
            </div>
            {assign var="firstArrKey" value=$elements|array_keys}
            {if $elements}
                <ul class="lu-nav nav-tabs" style="display: inline-block!important; max-width: 85%;">
                    {foreach from=$elements key=tplKey item=tplValue}
                        <li {if $tplKey  === $firstArrKey[0]} class="active" {/if}><a data-toggle="tab" href="#contTab{$tplValue->getId()}">{if $tplValue->getTitle()}{$tplValue->getTitle()}{else}{$tplValue->getRawTitle()}{/if}</a></li>
                    {/foreach}
                </ul>
            {/if}
        </div>
        {***DATATABLES*BODY*****************************************************************}
        <div class="lu-row">
            <div class="lu-col-md-12">
                <div class="box-body">
                    <div class="lu-tab-content">
                        {foreach from=$elements key=tplKey item=tplValue}
                            <div id="contTab{$tplValue->getId()}" class="lu-tab-pane {if $tplKey === $firstArrKey[0]} active {/if}">
                                {$tplValue->getHtml()}
                            </div>
                        {/foreach}
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
