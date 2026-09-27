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

<script type="text/x-template" id="t-mg-pass-gen-{$elementId|strtolower}">
    <div class="lu-input-group">
        <input class="lu-form-control" type="text" placeholder="{$rawObject->getPlaceholder()}" name="{$rawObject->getName()}"
               :value="password" {if $rawObject->isDisabled()}disabled="disabled"{/if}
        {foreach $htmlAttributes as $aValue} {$aValue@key}="{$aValue}" {/foreach}>
        <button @click="generatePass" class="lu-input-group__btn lu-btn lu-btn--default" type="button"><span class="lu-btn__text">{$MGLANG->T('Generate')}</span></button>
    </div>
</script>
