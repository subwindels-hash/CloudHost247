{**********************************************************************
* AmazonLightsail product developed. (2018-11-29)
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

<select 
    class="lu-form-control" 
    name="{$rawObject->getName()}"
    {if $rawObject->isDisabled()}disabled="disabled"{/if}
    {foreach $htmlAttributes as $aValue} {$aValue@key}="{$aValue}" {/foreach}
    {if $rawObject->isMultiple()}data-options="removeButton:true; resotreOnBackspace:true; dragAndDrop:true; maxItems: null;" multiple="multiple"{/if}
    >
    {if $rawObject->getValue()|is_array}
        {foreach from=$rawObject->getAvailableValues() key=opValue item=option}
            <option value="{$opValue}" {if $opValue|in_array:$rawObject->getValue()}selected{/if}>
                {$option}
            </option>
        {/foreach}            
    {else}
        {foreach from=$rawObject->getAvailableValues() key=opValue item=option}
            <option value="{$opValue}" {if $opValue===$rawObject->getValue()}selected{/if}>
                {$option}
            </option>
        {/foreach}
    {/if}
</select>
