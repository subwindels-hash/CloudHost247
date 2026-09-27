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

<input class="lu-form-control" type="text" placeholder="{$rawObject->getPlaceholder()}" name="{$rawObject->getName()}"
       value="{$rawObject->getValue()}" {if $rawObject->isDisabled()}disabled="disabled"{/if}
       {foreach $htmlAttributes as $aValue} {$aValue@key}="{$aValue}" {/foreach}>
