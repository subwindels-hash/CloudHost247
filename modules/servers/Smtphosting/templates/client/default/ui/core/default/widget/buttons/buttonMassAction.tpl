{**********************************************************************
* AmazonLightsail product developed. (2017-11-13)
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

<button  {foreach $htmlAttributes as $aValue} {$aValue@key}="{$aValue}" {/foreach}
namespace="{$namespace}" index="{$rawObject->getIndex()}"
class="{$rawObject->getClasses()}">
{if $rawObject->getIcon()}<i class="{$rawObject->getIcon()}"></i>{/if}
<span class="lu-btn__text">{if $rawObject->isRawTitle()}{$rawObject->getRawTitle()}{elseif $rawObject->getTitle()}{$MGLANG->T('button', $rawObject->getTitle())}{/if}</span>
</button>
