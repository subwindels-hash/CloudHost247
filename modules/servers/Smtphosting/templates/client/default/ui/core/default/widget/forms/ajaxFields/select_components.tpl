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

<script type="text/x-template" id="t-mg-ajax-select-{$elementId|strtolower}"
        :component_id="component_id"
        :component_namespace="component_namespace"
        :component_index="component_index"
        :reload_fields_ids="reload_fields_ids"
        :hide_by_default_if_no_data="hide_by_default_if_no_data"
>
    <select
            class='lu-form-control ajax'
            name='{$rawObject->getName()}'
            id='{$elementId}'
            {if $rawObject->isDisabled()}disabled='disabled'{/if}
            {if $rawObject->isMultiple()}data-options='removeButton:true; resotreOnBackspace:true; dragAndDrop:true; maxItems: null;' multiple='multiple'{/if}>
    </select>
</script>
