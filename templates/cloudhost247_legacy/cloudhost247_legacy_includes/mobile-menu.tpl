<div class="left-content">
	<nav id="main-nav" style="display: none;">
		<ul class="first-nav">
		  <li class="cryptocurrency">
			  <form action="cart.php" id="formSubMobileDomains" method="get">
				 <input type="hidden" name="a" value="add">
				 <input type="hidden" name="domain" value="register">
				 <input type="hidden" name="sld" id="hideenSlds">
				<input type="text" placeholder="{$LANG.domainBlockPlaceHolder}" class="search_input" id="serachBarTopMenu"><i class="fa fa-search" aria-hidden="true" onclick="wgsDomainRegisterCall();"></i>
			  </form>
		  </li>
		</ul>
		<ul class="second-nav">
		{foreach $topMenusData as $topMenuData}
		  <li class="devices">
			{if $topMenuData.url != '#' && $topMenuData.url != ''  }
			 <a href="{if $topMenuData.menuthirdparty eq '1'}{$topMenuData.url}{else}{$WEB_ROOT}/{$topMenuData.url}{/if}" {if $topMenuData.menunewtab eq '1'}target="_blank"{/if}> {$topMenuData.name} </a>
			{else}
			 <span>{$topMenuData.name}</span>
			{/if}
				{if $topMenuData.menutype eq '3' || $topMenuData.menutype eq '2'}
				<ul>
					 {foreach $topMenuData.submenu as $submenu} 
						 <li>
							{if $submenu.url != '#' && $submenu.url != ''  }
							 <a href="{if $submenu.menuthirdparty eq '1'}{$submenu.url}{else}{$WEB_ROOT}/{$submenu.url}{/if}" {if $submenu.menunewtab eq '1'}target="_blank"{/if}> <i class="{if $submenu.icon neq ''}{$submenu.icon}{else}fa fa-check{/if}"></i> {$submenu.name} </a>
							{else}
							<span> <i class="{if $submenu.icon neq ''}{$submenu.icon}{else}fa fa-check{/if}"></i> {$submenu.name}</span>
							{/if}
							
							 {if $topMenuData.menutype eq '3'}
								 <ul class="childsubmenu">
									 {foreach $submenu.childsubmenu as $childsubmenu}
										 <li>
											{if $childsubmenu.url != '#' && $childsubmenu.url != ''  }
											 <a href="{if $childsubmenu.menuthirdparty eq '1'}{$childsubmenu.url}{else}{$WEB_ROOT}/{$childsubmenu.url}{/if}" {if $childsubmenu.menunewtab eq '1'}target="_blank"{/if}> <i class="{if $childsubmenu.icon neq ''}{$childsubmenu.icon}{else}fa fa-check{/if}"></i> {$childsubmenu.name} </a>
											{else}
											<span> <i class="{if $childsubmenu.icon neq ''}{$childsubmenu.icon}{else}fa fa-check{/if}"></i> {$childsubmenu.name}</span>
											{/if}
										 </li>
									 {/foreach}
								 </ul>  
							 {/if}
						 </li>
					 {/foreach}
				</ul>
				{/if}

		  </li>
		{/foreach}
		</ul>
	</nav>
</div>