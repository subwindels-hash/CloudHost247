{foreach $navbar as $item}
    {if $item->getName() eq 'Account'}

    {else}    
        <li menuItemName="{$item->getName()}" {if $item->hasChildren()} class="pmenu" {/if} id="{$item->getId()}">
            <a {if $item->hasChildren()} href="javascript:;" class="pmenua" {else}href="{$item->getUri()}"{/if} {if $item->getAttribute('target')} target="{$item->getAttribute('target')}"{/if}>
                 
                 {if $item->getName() eq 'Home'}
                    <i class="img-icon img-icon01"></i>
                 {elseif $item->getName() eq 'Domains'}
                    <i class="img-icon img-icon03"></i>
                 {elseif $item->getName() eq 'Billing'}
                    <i class="img-icon img-icon05"></i>
                 {elseif $item->getName() eq 'Support'}
                    <i class="img-icon img-icon04"></i>
                 {elseif $item->getName() eq 'Support'}
                    <i class="img-icon img-icon04"></i>
                 {else}
                    <i class="img-icon img-icon02"></i>
                 {/if}

                {if $item->hasIcon()}<i class="{$item->getIcon()}"></i>&nbsp;{/if}
                {$item->getLabel()}            
            </a>
            {if $item->hasChildren()}
                <ul class="side_menu_sub">
                {foreach $item->getChildren() as $childItem}
                    {if $childItem->getLabel() eq '-----'}
                    {else}
                        <li menuItemName="{$childItem->getName()}" id="{$childItem->getId()}">
                            <a href="{$childItem->getUri()}"{if $childItem->getAttribute('target')} target="{$childItem->getAttribute('target')}"{/if}>
                                {if $childItem->hasIcon()}<i class="{$childItem->getIcon()}"></i>{else}<i class="fa fa-link"></i>{/if}
                                {$childItem->getLabel()}                        
                            </a>
                        </li>
                    {/if}
                {/foreach}
                </ul>
            {/if}
        </li>
    {/if}
{/foreach}
