{**********************************************************************
* AmazonLightsail product developed. (2017-08-31)
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
* This is default search form template for widget elements
*
* @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
*}

{literal}
<div data-toggler-options="toggleClass: is-open" class="lu-input-group lu-input-group--toggle">
    <input v-model="sSearch" type="text" data-toggler-options="toggleClass: hidden" placeholder="{/literal}{$MGLANG->absoluteT('searchPlacecholder')}{literal}" class="lu-form-control hidden" @keydown.enter="searchDataEnter">
    <button @click="hideSearch" data-toggler="selectors: .lu-btn .lu-btn__icon, .lu-form-control; container: .lu-input-group;" type="button" class="lu-icon-in-button lu-btn lu-btn--sm lu-btn--icon lu-btn--link">
        <i data-toggler-options="toggleClass: lu-zmdi-search lu-zmdi-close;" class="lu-btn__icon lu-zmdi lu-zmdi-search"></i>
    </button>
</div>
{/literal}
