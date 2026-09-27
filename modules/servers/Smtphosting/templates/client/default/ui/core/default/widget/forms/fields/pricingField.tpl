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

<div class="lu-form-group lu-col-md-4">
    <label class="lu-form-label">{$MGLANG->absoluteT('domainPricing', $rawObject->getTitle())}</label>
    <div class="lu-input-group">
        {assign var="pricingValues" value=$rawObject->getValue()}
        <div class="lu-input-group__addon">{$pricingValues['availableValues']}</div>
        <input name="{$rawObject->getName()}" class="lu-form-control pricing-modal-field" type="text"
               value="{if $pricingValues['value']}{$pricingValues['value']}{else}{if $rawObject->getName()|strpos:'domainregister' > 0}-1.00{else}0.00{/if}{/if}">
    </div>
    <div class="lu-form-feedback lu-form-feedback--icon" hidden="hidden">
    </div>
</div>