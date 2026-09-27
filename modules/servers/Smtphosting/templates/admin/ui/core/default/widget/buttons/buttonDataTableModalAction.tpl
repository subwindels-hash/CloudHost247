{**********************************************************************
* AmazonLightsail product developed. (2017-09-05)
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

<a {foreach $htmlAttributes as $aValue} {$aValue@key}="{$aValue}" {/foreach}
{if $rawObject->isRawTitle()}title="{$rawObject->getRawTitle()}"{elseif $rawObject->getTitle()}title="{$MGLANG->T('button', $rawObject->getTitle())}"{/if}
class="{$rawObject->getClasses()}" {if $rawObject->isDisableByColumnValue()}{literal}:disabled="dataRow.{/literal}{$rawObject->getDisableColumnName()}{literal} == {/literal}{if $rawObject->getDisableByColumnValue() === null} null {/if}{if $rawObject->isDisableColumnValueString()}'{/if}{$rawObject->getDisableByColumnValue()}{if $rawObject->isDisableColumnValueString()}'{/if}{literal}"{/literal}{/if}>
{if $rawObject->getIcon()}<i class="{$rawObject->getIcon()}"></i>{/if}
</a>
