{**********************************************************************
* AmazonLightsail product developed. (2017-10-06)
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

<div class="lu-widget">
    {if ($rawObject->getRawTitle() || $rawObject->getTitle()) && $rawObject->isViewHeader()}
        <div class="lu-widget__header">
            <div class="lu-widget__top lu-top">
                <div class="lu-top__title">
                    {if $rawObject->getIcon()}<i class="{$rawObject->getIcon()}"></i>{/if}
                    {if $rawObject->isRawTitle()}{$rawObject->getRawTitle()}{elseif $rawObject->getTitle()}{$MGLANG->T($rawObject->getTitle())}{/if}
                </div>
            </div>
        </div>
    {/if}
    <div class="lu-widget__body">
        <div class="lu-widget__content">
            {if $rawObject->getElementById('sectionDescription')}
                {$rawObject->insertElementById('sectionDescription')}
            {/if}
            <form id="{$rawObject->getId()}" mgformtype="{$rawObject->getFormType()}" id="{$elementId}" namespace="{$namespace}" index="{$rawObject->getIndex()}">
                <div class="lu-row">
                    <div class="lu-col-md-12">
                        {foreach from=$rawObject->getSections() item=section}
                            {$section->getHtml()}
                        {/foreach}

                        {foreach from=$rawObject->getFields() item=field}
                            {$field->getHtml()}
                        {/foreach}
                    </div>
                    <div class="lu-col-md-12 ui-form-submit">
                        {$rawObject->getSubmitHtml()}
                    </div>
                </div>
            </form>
        </div>
    </div>
</div>
