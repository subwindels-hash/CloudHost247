{**********************************************************************
* AmazonLightsail product developed. (2019-03-21)
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

<script type="text/x-template" id="t-mg-dt-select-filter-{$elementId|strtolower}"
        :component_id="component_id"
        :component_namespace="component_namespace"
        :component_index="component_index"
        :parent_id="parent_id"
>
    <select
            class='lu-form-control raw-select'
            name='{$rawObject->getName()}'
            id='{$elementId}'
            {if $rawObject->isDisabled()}disabled='disabled'{/if}
            {if $rawObject->isMultiple()}data-options='removeButton:true; resotreOnBackspace:true; dragAndDrop:true; maxItems: null;' multiple='multiple'{/if}
    >
        {if $rawObject->getValue()|is_array}
            {foreach from=$rawObject->getAvailableValues() key=opValue item=option}
                <option value="{$opValue}" {if $opValue|in_array:$rawObject->getValue()}selected{/if}>{$option}</option>
            {/foreach}
        {else}
            {foreach from=$rawObject->getAvailableValues() key=opValue item=option}
                <option value="{$opValue}" {if $opValue == $rawObject->getValue()}selected{/if}>{$option}</option>
            {/foreach}
        {/if}
    </select>
</script>
