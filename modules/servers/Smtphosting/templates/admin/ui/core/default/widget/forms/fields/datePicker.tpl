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

<div class="form-group">
    <label class="form-label">
        {if $rawObject->isRawTitle()}{$rawObject->getRawTitle()}{elseif $rawObject->getTitle()}{$MGLANG->T($rawObject->getTitle())}{/if}
        {if $rawObject->getDescription()}
            <i data-title="{$MGLANG->T($rawObject->getDescription())}" data-toggle="lu-tooltip" class="lu-i-c-2x lu-zmdi lu-zmdi-help-outline lu-form-tooltip-helper "></i>
        {/if}
    </label>
    <mg-field
            v-bind:fieldidprop="'{$rawObject->getId()}'"
            v-bind:nameprop="'{$rawObject->getName()}'"
            v-bind:namespaceprop="'{$rawObject->getNamespace()}'"
            v-bind:indexprop="'{$rawObject->getIndex()}'"
            v-bind:valueprop="'{$rawObject->getValue()}'"
            inline-template>
        <md-datepicker class="form-control mg-datapicker" v-model="value"></md-datepicker>
    </mg-field>
    <input name="{$rawObject->getName()}" id="{$rawObject->getId()}" type="hidden"/>
    <div class="form-feedback form-feedback--icon" hidden="hidden"></div>
</div>
