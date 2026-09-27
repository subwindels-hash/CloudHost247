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
            <div class="lu-row">
                {if $rawObject->getFields()}
                    <div class="lu-col-md-6 lu-p-r-4x">
                        {foreach from=$rawObject->getFields() item=field }
                            {$field->getHtml()}
                        {/foreach}
                    </div>
                {/if}
                {if $rawObject->getSections()}
                    {foreach from=$rawObject->getSections() item=section }
                        {$section->getHtml()}
                    {/foreach}
                {/if}
            </div>
        </div>
    </div>
</div>
