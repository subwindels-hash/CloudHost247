{if $hostx_theme_settings.menu_layout eq 'mega_menu'}
{if $sidebarHostxRemove eq 'true' || $templatefile eq 'homepage' || !$loggedin || $filename == 'cart' || $templatefile == 'products' ||  $templatefile == 'configureproductdomain'  || $templatefile == 'domain-renewals' || $templatefile == 'store/weebly/index' || $templatefile == 'store/ssl/index' || $templatefile == 'store/codeguard/index' || $templatefile == 'store/sitelock/index' || $templatefile == 'store/spamexperts/index' || $templatefile == 'store/sitelockvpn/index' || $templatefile == 'store/marketgoo/index' || $templatefile == 'store/ox/index' || $templatefile == 'store/sitebuilder/index' || $templatefile == 'store/order' || $templatefile == 'store/cpanelseo/index' || $templatefile == 'store/nordvpn/index' || $templatefile == 'store/threesixtymonitoring/index' || $templatefile == 'store/xovinow/index'}
	<header class="header wgs-new-header-top">
	<div class="container">
		{if !empty($hostx_theme_settings.header_logo)}
			 <a href="{if $hostx_theme_settings.header_logo_link neq ''}{$hostx_theme_settings.header_logo_link}{else}{$WEB_ROOT}/index.php{/if}" {if $hostx_theme_settings.enable_header_target eq 'on'}target="_blank"{/if}  class="logo wgs-new-head-logo">
				 <img src="{$hostx_theme_settings.header_logo}" alt="{$companyname}" {if $hostx_theme_settings.header_logo_height neq ''}height="{$hostx_theme_settings.header_logo_height}"{/if} {if $hostx_theme_settings.header_logo_width neq ''}width="{$hostx_theme_settings.header_logo_width}" {/if}>
			 </a>
		{else}
			 <a href="{if $hostx_theme_settings.header_logo_link neq ''}{$hostx_theme_settings.header_logo_link}{else}{$WEB_ROOT}/index.php{/if}" class="logo logo-text wgs-new-head-logo" {if $hostx_theme_settings.enable_header_target eq 'on'}target="_blank"{/if}>{$companyname}</a>
		{/if}	
		<div class="right float-right">
			<ul class="nav right_navi"> 
				 {if $hostx_theme_settings.phone_display eq 'yes'}
					 {if empty($hostx_theme_settings.phone)}
						 <li><a href="tel:+{$LANG.headerphone}" class="telephoneanchor"><i class="fa fa-phone"></i><span>{$LANG.headerphone}</span></a></li>
					 {else}
						 <li><a href="tel:+{$hostx_theme_settings.country_calling_code_phone}{$hostx_theme_settings.phone}" class="telephoneanchor"><i class="fa fa-phone"></i> <span>(+{$hostx_theme_settings.country_calling_code_phone}) {$hostx_theme_settings.phone}</span></a></li>
					 {/if}
				 {/if}
				 {if $languagechangeenabled && count($locales) > 1}
					 <li class="languageDiv"><a href="#" data-toggle="dropdown"><span id="sLanguage"><img src="{$WEB_ROOT}/templates/{$template}/flags/blank.gif" class="flag flag-{$hxselectedlanguage.flagcode}" alt="{$hxselectedlanguage.localisedName}" /> {$hxselectedlanguage.localisedName}</span> <i class="fa fa-sort-desc"></i></a>
						 <div class="dropdown-menu flag_drop" id="languageList"> 
							 {foreach $hxlanguagesflags as $locale}
								 <a class="dropdown-item" href="{$currentpagelinkback}language={$locale.language}"><img src="{$WEB_ROOT}/templates/{$template}/flags/blank.gif" class="flag flag-{$locale.flagcode}" alt="{$locale.localisedName}" /> {$locale.localisedName}</a>
							 {/foreach}
						 </div>
					 </li> 
				 {/if}
				 {if !$loggedin && $currencies && ($hostx_theme_settings.disable_multi_crrency) == 'on' }
					 <li class="currencyDiv"><a href="#" data-toggle="dropdown"><span id="sCurrency">{$hxselectedcurrency.prefix} {$hxselectedcurrency.code}</span> <i class="fa fa-sort-desc"></i></a>
						 <div class="dropdown-menu" id="currencyList"> 
							 {foreach from=$currencies item=listcurr}
								 <a class="dropdown-item" href="{$currentpagelinkback}currency={$listcurr.id}">{$listcurr.prefix} {$listcurr.code}</a>
							 {/foreach}
						 </div>
					 </li>
				 {/if}
				 {if !$loggedin}
					 <li class="hover mblshow"><a href="{$WEB_ROOT}/clientarea.php"><i class="fa fa-user"></i></a></li>
				 {else}
					 <li class="hover mblshow"><a href="{$WEB_ROOT}/clientarea.php"><i class="fa fa-user"></i></a></li>
					 <li class="hover mblshow"><a href="{$WEB_ROOT}/logout.php"><i class="fa fa-sign-out"></i></a></li>
				 {/if}
				 <li class="hover"><a href="{$WEB_ROOT}/cart.php?a=view">
					<i class="fa fa-shopping-cart"></i>
					<span class="label label-success wgs-custom-label-cart-hostx {if $cartitemcount > 0}itemincart{/if}">{$cartitemcount}</span>
				 </a></li>
				{if $adminMasqueradingAsClient || $adminLoggedIn}
					<li>
						<a href="{$WEB_ROOT}/logout.php?returntoadmin=1" class="hover mblshow" data-toggle="tooltip" data-placement="bottom" title="{if $adminMasqueradingAsClient}{$LANG.adminmasqueradingasclient} {$LANG.logoutandreturntoadminarea}{else}{$LANG.adminloggedin} {$LANG.returntoadminarea}{/if}">
							<i class="fal fa-sign-out"></i>
						</a>
					</li>
				{/if}					 
			</ul>
			<button class="navbar-toggler wgs-nav-main-header" type="button"  > &#9776; </button>
		</div> 
	</div>
	</header>
	{/if}
{elseif $hostx_theme_settings.menu_layout eq 'mega_menu_latest'}
	{if $sidebarHostxRemove eq 'true' || $templatefile eq 'homepage' || !$loggedin || $filename == 'cart' || $templatefile == 'products' || $templatefile == 'configureproductdomain' || $templatefile == 'domain-renewals' || $templatefile == 'store/weebly/index' || $templatefile == 'store/ssl/index' || $templatefile == 'store/codeguard/index' || $templatefile == 'store/sitelock/index' || $templatefile == 'store/spamexperts/index' || $templatefile == 'store/sitelockvpn/index' || $templatefile == 'store/marketgoo/index' || $templatefile == 'store/ox/index' || $templatefile == 'store/sitebuilder/index' || $templatefile == 'store/order' || $templatefile == 'store/cpanelseo/index' || $templatefile == 'store/nordvpn/index' || $templatefile == 'store/threesixtymonitoring/index' || $templatefile == 'store/xovinow/index'}
	<header class="header wgs-new-header-top-latest">
		<div class="container">
			{if !empty($hostx_theme_settings.header_logo)}
				<a href="{if $hostx_theme_settings.header_logo_link neq ''}{$hostx_theme_settings.header_logo_link}{else}{$WEB_ROOT}/index.php{/if}" {if $hostx_theme_settings.enable_header_target eq 'on'}target="_blank"{/if}  class="logo wgs-new-head-logo">
					<img src="{$hostx_theme_settings.header_logo}" alt="{$companyname}" {if $hostx_theme_settings.header_logo_height neq ''}height="{$hostx_theme_settings.header_logo_height}"{/if} {if $hostx_theme_settings.header_logo_width neq ''}width="{$hostx_theme_settings.header_logo_width}" {/if}>
				</a>
			{else}
				<a href="{if $hostx_theme_settings.header_logo_link neq ''}{$hostx_theme_settings.header_logo_link}{else}{$WEB_ROOT}/index.php{/if}" class="logo logo-text wgs-new-head-logo" {if $hostx_theme_settings.enable_header_target eq 'on'}target="_blank"{/if}>{$companyname}</a>
			{/if}	
			<div class="right float-right">
				<ul class="nav right_navi"> 
					{if $hostx_theme_settings.phone_display eq 'yes'}
						{if empty($hostx_theme_settings.phone)}
							<li><a href="tel:+{$LANG.headerphone}" class="telephoneanchor"><i class="fa fa-phone"></i><span>{$LANG.headerphone}</span></a></li>
						{else}
							<li><a href="tel:+{$hostx_theme_settings.country_calling_code_phone}{$hostx_theme_settings.phone}" class="telephoneanchor"><i class="fa fa-phone"></i> <span>(+{$hostx_theme_settings.country_calling_code_phone}) {$hostx_theme_settings.phone}</span></a></li>
						{/if}
					{/if}
					{if $languagechangeenabled && count($locales) > 1}
						<li class="languageDiv"><a href="#" data-toggle="dropdown"><span id="sLanguage"><img src="{$WEB_ROOT}/templates/{$template}/flags/blank.gif" class="flag flag-{$hxselectedlanguage.flagcode}" alt="{$hxselectedlanguage.localisedName}" /> {$hxselectedlanguage.localisedName}</span> <i class="fa fa-sort-desc"></i></a>
							<div class="dropdown-menu flag_drop" id="languageList"> 
								{foreach $hxlanguagesflags as $locale}
									<a class="dropdown-item" href="{$currentpagelinkback}language={$locale.language}"><img src="{$WEB_ROOT}/templates/{$template}/flags/blank.gif" class="flag flag-{$locale.flagcode}" alt="{$locale.localisedName}" /> {$locale.localisedName}</a>
								{/foreach}
							</div>
						</li> 
					{/if}
					{if !$loggedin && $currencies && ($hostx_theme_settings.disable_multi_crrency) == 'on' }
						<li class="currencyDiv"><a href="#" data-toggle="dropdown"><span id="sCurrency">{$hxselectedcurrency.prefix} {$hxselectedcurrency.code}</span> <i class="fa fa-sort-desc"></i></a>
							<div class="dropdown-menu" id="currencyList"> 
								{foreach from=$currencies item=listcurr}
									<a class="dropdown-item" href="{$currentpagelinkback}currency={$listcurr.id}">{$listcurr.prefix} {$listcurr.code}</a>
								{/foreach}
							</div>
						</li>
					{/if}
					{if !$loggedin}
						<li class="hover mblshow"><a href="{$WEB_ROOT}/clientarea.php"><i class="fa fa-user"></i></a></li>
					{else}
						<li class="hover mblshow"><a href="{$WEB_ROOT}/clientarea.php"><i class="fa fa-user"></i></a></li>
						<li class="hover mblshow"><a href="{$WEB_ROOT}/logout.php"><i class="fa fa-sign-out"></i></a></li>
					{/if}
					<li class="hover"><a href="{$WEB_ROOT}/cart.php?a=view">
						<i class="fa fa-shopping-cart"></i>
						<span class="label label-success wgs-custom-label-cart-hostx {if $cartitemcount > 0}itemincart{/if}">{$cartitemcount}</span>
					</a></li>
					{if $adminMasqueradingAsClient || $adminLoggedIn}
						<li>
							<a href="{$WEB_ROOT}/logout.php?returntoadmin=1" class="hover mblshow" data-toggle="tooltip" data-placement="bottom" title="{if $adminMasqueradingAsClient}{$LANG.adminmasqueradingasclient} {$LANG.logoutandreturntoadminarea}{else}{$LANG.adminloggedin} {$LANG.returntoadminarea}{/if}">
								<i class="fal fa-sign-out"></i>
							</a>
						</li>
					{/if}					 
				</ul>
				<button class="navbar-toggler" id="nav-latest-mega-menu-toggle" type="button"> &#9776; </button>
			</div> 
		</div>
	</header>
	{/if}
{elseif $hostx_theme_settings.menu_layout eq 'dropdown_menu'}
	{if $sidebarHostxRemove eq 'true' || $templatefile eq 'homepage' || !$loggedin || $filename == 'cart' || $templatefile == 'products' ||  $templatefile == 'configureproductdomain' || $templatefile == 'domain-renewals' || $templatefile == 'store/weebly/index' || $templatefile == 'store/ssl/index' || $templatefile == 'store/codeguard/index' || $templatefile == 'store/sitelock/index' || $templatefile == 'store/spamexperts/index' || $templatefile == 'store/sitelockvpn/index' || $templatefile == 'store/marketgoo/index' || $templatefile == 'store/ox/index' || $templatefile == 'store/sitebuilder/index' || $templatefile == 'store/order' || $templatefile == 'store/cpanelseo/index' || $templatefile == 'store/nordvpn/index' || $templatefile == 'store/threesixtymonitoring/index' || $templatefile == 'store/xovinow/index'}
	<header class="header">
	{if !$cartpage && $templatefile neq 'domain-renewals' && $loggedin && $filename == 'clientarea'}
		{if $hostx_theme_settings.enable_primary_sidebar_left neq 'on'}
			<div class="left-side-arrow-primary-header-top">
				<i class="fa fa-align-left" onclick="wgsChangeSideBarsClaas(this,'primary');" id="leftPrimaryBarIclass"></i>
			</div>
		{/if}
		{if $hostx_theme_settings.enable_secondary_sidebar_right neq 'on'}
			<div class="right-side-arrow-secondary-header-top">
				<i class="fa fa-align-right" onclick="wgsChangeSideBarsClaas(this,'secondary');" id="rightSideBarIclass"></i>	
			</div>
		{/if}
	{/if}
	<div class="container">
		{if !empty($hostx_theme_settings.header_logo)}
			 <a href="{if $hostx_theme_settings.header_logo_link neq ''}{$hostx_theme_settings.header_logo_link}{else}{$WEB_ROOT}/index.php{/if}" {if $hostx_theme_settings.enable_header_target eq 'on'}target="_blank"{/if}  class="logo wgs-new-head-logo-dropdown">
				 <img src="{$hostx_theme_settings.header_logo}" alt="{$companyname}" {if $hostx_theme_settings.header_logo_height neq ''}height="{$hostx_theme_settings.header_logo_height}"{/if} {if $hostx_theme_settings.header_logo_width neq ''}width="{$hostx_theme_settings.header_logo_width}" {/if}>
			 </a>
		{else}
			 <a href="{if $hostx_theme_settings.header_logo_link neq ''}{$hostx_theme_settings.header_logo_link}{else}{$WEB_ROOT}/index.php{/if}" class="logo logo-text wgs-new-head-logo-dropdown" {if $hostx_theme_settings.enable_header_target eq 'on'}target="_blank"{/if}>{$companyname}</a>
		{/if}	
		<div class="right float-right">
			<ul class="nav right_navi"> 
				 {if $hostx_theme_settings.phone_display eq 'yes'}
					 {if empty($hostx_theme_settings.phone)}
						 <li><a href="tel:+{$LANG.headerphone}" class="telephoneanchor"><i class="fa fa-phone"></i><span>{$LANG.headerphone}</span></a></li>
					 {else}
						 <li><a href="tel:+{$hostx_theme_settings.country_calling_code_phone}{$hostx_theme_settings.phone}" class="telephoneanchor"><i class="fa fa-phone"></i> <span>(+{$hostx_theme_settings.country_calling_code_phone}) {$hostx_theme_settings.phone}</span></a></li>
					 {/if}
				 {/if}
				 {if $languagechangeenabled && count($locales) > 1}
					 <li class="languageDiv"><a href="#" data-toggle="dropdown"><span id="sLanguage"><img src="{$WEB_ROOT}/templates/{$template}/flags/blank.gif" class="flag flag-{$hxselectedlanguage.flagcode}" alt="{$hxselectedlanguage.localisedName}" /> {$hxselectedlanguage.localisedName}</span> <i class="fa fa-sort-desc"></i></a>
						 <div class="dropdown-menu flag_drop" id="languageList"> 
							 {foreach $hxlanguagesflags as $locale}
								 <a class="dropdown-item" href="{$currentpagelinkback}language={$locale.language}"><img src="{$WEB_ROOT}/templates/{$template}/flags/blank.gif" class="flag flag-{$locale.flagcode}" alt="{$locale.localisedName}" /> {$locale.localisedName}</a>
							 {/foreach}
						 </div>
					 </li> 
				 {/if}
				 {if !$loggedin && $currencies && ($hostx_theme_settings.disable_multi_crrency) == 'on' }
					 <li class="currencyDiv"><a href="#" data-toggle="dropdown"><span id="sCurrency">{$hxselectedcurrency.prefix} {$hxselectedcurrency.code}</span> <i class="fa fa-sort-desc"></i></a>
						 <div class="dropdown-menu" id="currencyList"> 
							 {foreach from=$currencies item=listcurr}
								 <a class="dropdown-item" href="{$currentpagelinkback}currency={$listcurr.id}">{$listcurr.prefix} {$listcurr.code}</a>
							 {/foreach}
						 </div>
					 </li>
				 {/if}
				 {if !$loggedin}
					 <li class="hover mblshow"><a href="{$WEB_ROOT}/clientarea.php"><i class="fa fa-user"></i></a></li>
				 {else}
					 <li class="hover mblshow"><a href="{$WEB_ROOT}/clientarea.php"><i class="fa fa-user"></i></a></li>
					 <li class="hover mblshow"><a href="{$WEB_ROOT}/logout.php"><i class="fa fa-sign-out"></i></a></li>
				 {/if}
				 <li class="hover"><a href="{$WEB_ROOT}/cart.php?a=view">
					<i class="fa fa-shopping-cart"></i>
					<span class="label label-success wgs-custom-label-cart-hostx {if $cartitemcount > 0}itemincart{/if}">{$cartitemcount}</span>
				 </a></li>
				{if $adminMasqueradingAsClient || $adminLoggedIn}
					<li>
						<a href="{$WEB_ROOT}/logout.php?returntoadmin=1" class="hover mblshow" data-toggle="tooltip" data-placement="bottom" title="{if $adminMasqueradingAsClient}{$LANG.adminmasqueradingasclient} {$LANG.logoutandreturntoadminarea}{else}{$LANG.adminloggedin} {$LANG.returntoadminarea}{/if}">
							<i class="fal fa-sign-out"></i>
						</a>
					</li>
				{/if}					 
			</ul>
			<button class="navbar-toggler wgs-nav-main-header" type="button"  > &#9776; </button>
		</div> 
	</div>
	</header>
	{/if}
{/if} 