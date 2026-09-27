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

<div class="lu-form-group">
    <label class="lu-form-label">
        {if $rawObject->isRawTitle()}{$rawObject->getRawTitle()}{elseif $rawObject->getTitle()}{$MGLANG->T($rawObject->getTitle())}{/if}
        {if $rawObject->getDescription()}
            <i data-title="{$MGLANG->T($rawObject->getDescription())}" data-toggle="lu-tooltip" class="lu-i-c-2x lu-zmdi lu-zmdi-help-outline lu-form-tooltip-helper"></i>
        {/if}
    </label>
    <select class="lu-form-control" name="{$rawObject->getName()}" {if $rawObject->isDisabled()}disabled="disabled"{/if} {if $rawObject->isMultiple()}data-options="removeButton:true; resotreOnBackspace:true; dragAndDrop:true; maxItems: null;" multiple="multiple"{/if}>
        {if $rawObject->getValue()|is_array}
            {foreach from=$rawObject->getAvailableValues() key=opValue item=option}
                <option value="{$option}" {if $option|in_array:$rawObject->getValue()}selected{/if}>
                    {$option}
                </option>
            {/foreach}
        {else}
            {foreach from=$rawObject->getAvailableValues() key=opValue item=option}
                <option value="{$option}" {if $option == $rawObject->getValue()}selected{/if}>
                    {$option}
                </option>
            {/foreach}
        {/if}
    </select>
    <div class="lu-form-feedback lu-form-feedback--icon" hidden="hidden">
    </div>
</div>
