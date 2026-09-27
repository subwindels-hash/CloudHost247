<div class="lu-alert alert-{$rawObject->getClasses()}">
    {if $rawObject->isRaw()}
        {$rawObject->getDescription()}
    {else}
        {if $rawObject->isHtmlTagsAllowed()}
            {$MGLANG->T($rawObject->getDescription())|unescape:'html'}
        {else}
            {$MGLANG->T($rawObject->getDescription())}
        {/if}
    {/if}
</div>