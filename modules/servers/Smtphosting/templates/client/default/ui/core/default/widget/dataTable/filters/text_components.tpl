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

<script type="text/x-template" id="t-mg-dt-text-filter-{$elementId|strtolower}"
        :component_id="component_id"
        :component_namespace="component_namespace"
        :component_index="component_index"
        :parent_id="parent_id"
        :required_to_search="required_to_search"
        :filter_value="filter_value"
>
    <input class="lu-form-control" type="text" placeholder="{$MGLANG->translate($rawObject->getPlaceholder())}" name="{$rawObject->getName()}"
           v-bind:value="filter_value" v-on:input="updateFilterValue" {if $rawObject->isDisabled()}disabled="disabled"{/if}
    {foreach $htmlAttributes as $aValue} {$aValue@key}="{$aValue}" {/foreach}>
</script>
