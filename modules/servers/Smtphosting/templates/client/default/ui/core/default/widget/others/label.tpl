<span
{foreach $htmlAttributes as $aValue} {$aValue@key}="{$aValue}" {/foreach} class="{$rawObject->getClasses()} {if $rawObject->getType()}lu-label--{$rawObject->getType()}{/if}"
{if $rawObject->getMessage()} data-toggle="tooltip" data-title="{$rawObject->getMessage()}" {/if}
style="margin-left: 0px
;
    margin-right: 10px
;
    margin-bottom: 5px
;
    {if !$rawObject->getType()} background-color: #
{$rawObject->getBackgroundColor()}
;
    color: #
{$rawObject->getColor()}
;{/if}" >{$rawObject->getTitle()}
</span>
