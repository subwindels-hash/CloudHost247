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
<div class="lu-top__search lu-input-group">
        <span class="lu-icon-sm lu-input-group__icon">
            <i class="lu-zmdi lu-zmdi-search "></i>
        </span>
    <input placeholder="{/literal}{$MGLANG->absoluteT('searchPlacecholder')}{literal}" value="" @keydown.enter="searchDataEnter" class="lu-form-control lu-input-group__form-control lu-table-search">
</div>
{/literal}
