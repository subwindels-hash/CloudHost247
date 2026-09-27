
	{if $hostx_theme_settings.menu_layout eq 'dropdown_menu'}
	<nav class="nav_bar navbar-expand-lg simple-drop-down" id="myHeader">
		<div class="container{if $loggedin && !$sidebarHostxRemove && $templatefile neq 'homepage' && $filename != 'cart' && $templatefile != 'products' && $templatefile != 'store/weebly/index' && $templatefile != 'store/ssl/index' && $templatefile != 'store/codeguard/index' && $templatefile != 'store/sitelock/index' && $templatefile != 'store/spamexperts/index' && $templatefile != 'store/sitelockvpn/index' && $templatefile != 'store/marketgoo/index' && $templatefile != 'store/ox/index' && $templatefile != 'store/sitebuilder/index' && $templatefile != 'store/order' && $templatefile != 'store/cpanelseo/index' && $templatefile != 'store/nordvpn/index' && $templatefile != 'store/threesixtymonitoring/index' && $templatefile != 'store/xovinow/index'}-fluid{/if}">
	 	{include file="$template/hostx_includes/top-menu-dropdown.tpl"}
		</div>
	</nav>
	{elseif $hostx_theme_settings.menu_layout eq 'mega_menu'}
	<nav class="nav_bar navbar-expand-lg mega-menu-old" id="myHeader">
		<div class="container{if $loggedin && !$sidebarHostxRemove && $templatefile neq 'homepage' && $filename != 'cart' && $templatefile != 'products' && $templatefile != 'store/weebly/index' && $templatefile != 'store/ssl/index' && $templatefile != 'store/codeguard/index' && $templatefile != 'store/sitelock/index' && $templatefile != 'store/spamexperts/index' && $templatefile != 'store/sitelockvpn/index' && $templatefile != 'store/marketgoo/index' && $templatefile != 'store/ox/index' && $templatefile != 'store/sitebuilder/index' && $templatefile != 'store/order' && $templatefile != 'store/cpanelseo/index' && $templatefile != 'store/nordvpn/index' && $templatefile != 'store/threesixtymonitoring/index' && $templatefile != 'store/xovinow/index'}-fluid{/if}">
		{include file="$template/hostx_includes/top-mega-menu-default.tpl"}
		</div>
	</nav>
	{elseif $hostx_theme_settings.menu_layout eq 'mega_menu_latest'}
	<nav class="nav_bar navbar-expand-lg mega-menu-latest" id="myHeader">
		<div class="container{if $loggedin && !$sidebarHostxRemove && $templatefile neq 'homepage' && $filename != 'cart' && $templatefile != 'products' && $templatefile != 'store/weebly/index' && $templatefile != 'store/ssl/index' && $templatefile != 'store/codeguard/index' && $templatefile != 'store/sitelock/index' && $templatefile != 'store/spamexperts/index' && $templatefile != 'store/sitelockvpn/index' && $templatefile != 'store/marketgoo/index' && $templatefile != 'store/ox/index' && $templatefile != 'store/sitebuilder/index' && $templatefile != 'store/order' && $templatefile != 'store/cpanelseo/index' && $templatefile != 'store/nordvpn/index' && $templatefile != 'store/threesixtymonitoring/index' && $templatefile != 'store/xovinow/index'}-fluid{/if}">
			{include file="$template/hostx_includes/top-mega-menu-latest.tpl"}
		</div>
	</nav>
	{/if}
