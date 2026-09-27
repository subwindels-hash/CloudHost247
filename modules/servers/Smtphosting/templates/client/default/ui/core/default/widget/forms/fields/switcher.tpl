{**********************************************************************
* AmazonLightsail product developed. (2017-10-30)
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

<div class="{$rawObject->getClasses()}">
    <label>
        <span class="lu-form-text">
            {if $rawObject->isRawTitle()}{$rawObject->getRawTitle()}{elseif $rawObject->getTitle()}{$MGLANG->T($rawObject->getTitle())}{/if}
            {if $rawObject->getDescription()}
                <i data-title="{$MGLANG->T($rawObject->getDescription())}" data-toggle="lu-tooltip" class="lu-i-c-2x lu-zmdi lu-zmdi-help-outline lu-form-tooltip-helper"></i>
            {/if}
        </span>
        <div class="lu-switch">
            <input type="checkbox" class="lu-switch__checkbox" name="{$rawObject->getName()}" {if $rawObject->getValue() === 'on'}checked{/if}
                   {if $rawObject->isDisabled()}disabled="disabled"{/if}
            {foreach $htmlAttributes as $aValue} {$aValue@key}="{$aValue}" {/foreach}>
            <span class="lu-switch__container"><span class="lu-switch__handle"></span></span>
        </div>
    </label>
</div>
