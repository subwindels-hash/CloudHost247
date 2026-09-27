{foreach $sidebarLinksHostx as $sidebarLink}
	<li class="{if $sidebarLink->submenus|@count neq 0} nav-dropdown nolink {/if} {if $sidebarLink->activeClass}active open{/if}">
		<a href="{if $sidebarLink->submenus|@count neq 0}javascript:void(0);{else}{if $sidebarLink->is_third_party  eq '1'}{$sidebarLink->url}{else}{$WEB_ROOT}{if $sidebarLink->url|substr:0:1 neq '/'}/{/if}{$sidebarLink->url}{/if}{/if}" {if $sidebarLink->open_new_tab eq '1'} target="_blank" {/if}{if $sidebarLink->class neq ''}class="{$sidebarLink->class}"{/if}>
		{if $sidebarLink->icon neq ''}<i class="{$sidebarLink->icon} lficnmn"></i>{/if}
			{$sidebarLink->name}
		</a>
		{if $sidebarLink->submenus|@count neq 0}
			<ul class="nav-sub">
				{foreach $sidebarLink->submenus as $submenusLink}
					<li>
						<a href="{if $submenusLink->is_third_party eq '1'}{$submenusLink->url}{else}{$WEB_ROOT}{if $submenusLink->url|substr:0:1 neq '/'}/{/if}{$submenusLink->url}{/if}" class="{if $submenusLink->activeClass}active{/if}" {if $submenusLink->open_new_tab eq '1'}target="_blank"{/if} {if $submenusLink->class neq ''}class="{$submenusLink->class}"{/if}>
							{if $submenusLink->icon neq ''}
								<i class="{$submenusLink->icon}"></i>
							{/if}
							{$submenusLink->name}
						</a>
					</li>
				{/foreach}
			</ul>
		{/if}
	</li>
{/foreach}