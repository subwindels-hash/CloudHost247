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

<a {foreach $htmlAttributes as $aValue} {$aValue@key}="{$aValue}" {/foreach} class="{$rawObject->getClasses()}">
{if $rawObject->getIcon()}
    <i class="{$rawObject->getIcon()}"></i>
{/if}
{if $rawObject->isRawTitle()}
    <span class="lu-btn__text">{$rawObject->getRawTitle()}</span>
{elseif $rawObject->getTitle()}
    <span class="lu-btn__text">{$MGLANG->T('button', $rawObject->getTitle())}</span>
{/if}
</a>
