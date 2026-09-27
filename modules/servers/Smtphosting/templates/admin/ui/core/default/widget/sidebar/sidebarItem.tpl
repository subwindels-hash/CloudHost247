<li class="lu-nav__item {if $rawObject->isActive()}is-active{/if}">
    <a {foreach $htmlAttributes as $aValue} {$aValue@key}="{$aValue}" {/foreach} class="lu-nav__link ">
    {if $rawObject->getIcon()}<i class="{$rawObject->getIcon()}"></i>{/if}
    <span class="lu-nav__link-text lu-nav__link-text-bold">{$MGLANG->T($rawObject->getId())}</span>
    </a>
</li>
