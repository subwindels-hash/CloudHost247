{**********************************************************************
* AmazonLightsail product developed. (2017-10-04)
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

<div class="lu-list-group__item">
    <div class="lu-list-group__top lu-top" data-toggle="lu-collapse" data-target="#pricing{$rawObject->getId()}" aria-expanded="false">
        <span class="lu-collapse-icon"></span>
        <div class="lu-top__title lu-type-7">{$MGLANG->absoluteT('domainPricing', $rawObject->getName())}</div>
    </div>
    <div id="pricing{$rawObject->getId()}" class="lu-collapse" style="">
        <div class="lu-list-group__content">
            <div class="lu-row">
                {foreach from=$rawObject->getFields() item=field }
                    {$field->getHtml()}
                {/foreach}
            </div>
        </div>
    </div>
</div>
