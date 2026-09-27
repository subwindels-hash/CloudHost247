{**********************************************************************
* AmazonLightsail product developed. (2019-01-14)
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

<div class="lu-col-md-12">
    <div class="lu-widget mg-form-tabs-widget">
        <div class="lu-widget__header">
            {if $rawObject->isRawTitle() || $rawObject->getTitle()}
                <div class="lu-widget__top lu-top">
                    <div class="lu-top__title">
                        {if $rawObject->getIcon()}<i class="{$rawObject->getIcon()}"></i>{/if}
                        {if $rawObject->isRawTitle()}{$rawObject->getRawTitle()}{elseif $rawObject->getTitle()}{$MGLANG->T($rawObject->getTitle())}{/if}
                    </div>
                    <div class="lu-top__title-right">
                        {foreach from=$rawObject->getButtons() key=buttonKey item=buttonValue}
                            {$buttonValue->getHtml()}
                        {/foreach}
                    </div>
                </div>
            {/if}
            <div class="lu-widget__nav swiper-container swiper-container-horizontal swiper-container-false" data-content-slider="" style="visibility: visible;">
                {assign var="firstArrKey" value=$rawObject->getSections()|array_keys}
                {if $rawObject->getSections()}
                    <ul class="swiper-wrapper lu-nav lu-nav--md lu-nav--h lu-nav--tabs lu-nav--arrow">
                        {foreach from=$rawObject->getSections() key=tplKey item=tplValue}
                            <li {if $tplKey  === $firstArrKey[0]} class="lu-nav__item swiper-slide is-active" {else} class="lu-nav__item swiper-slide" {/if}>
                                <a class="lu-nav__link" data-toggle="lu-tab" href="#contTab{$tplValue->getId()}">
                                    <span class="lu-nav__link-text">{if $tplValue->isRawTitle()}{$tplValue->getRawTitle()}{elseif $tplValue->getTitle()}{$MGLANG->T($tplValue->getTitle())}{/if}</span>
                                </a>
                            </li>
                        {/foreach}
                    </ul>
                {/if}
            </div>
        </div>
        <div class="lu-widget__body">
            <form id="{$rawObject->getId()}" namespace="{$namespace}" index="{$rawObject->getIndex()}" mgformtype="{$rawObject->getFormType()}">
                <div class="lu-tab-content">
                    {foreach from=$rawObject->getSections() key=tplKey item=tplValue}
                        <div id="contTab{$tplValue->getId()}" class="lu-tab-pane {if $tplKey === $firstArrKey[0]} is-active {/if}">
                            <div class="lu-col-md-12 mg-tabs-form-wrapper">
                                {$tplValue->getHtml()}
                            </div>
                        </div>
                    {/foreach}
                </div>
                <div class="lu-col-md-12 ui-form-submit">
                    {$rawObject->getSubmitHtml()}
                </div>
            </form>
        </div>
    </div>
</div>

