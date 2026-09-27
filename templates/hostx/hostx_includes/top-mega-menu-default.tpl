<div class="navbar-toggleable-md collapse navbar-collapse wgs-new-mega-menu {if ($filename == 'clientarea' || $filename == 'submitticket' || $filename == 'affiliates' || $filename == 'supporttickets' || $filename == 'serverstatus' || $filename == 'viewticket' || $templatefile == 'account-user-management' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-paymentmethods' || $templatefile == 'account-paymentmethods-manage' || $templatefile == 'announcements' || $templatefile == 'knowledgebase' || $templatefile == 'downloads' || $templatefile == 'viewannouncement' || $templatefile == 'knowledgebasecat' || $templatefile == 'knowledgebasearticle' || $templatefile == 'user-password' || $templatefile == 'user-profile' || $templatefile == 'user-switch-account' || $templatefile == 'user-security' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-contacts-new' || $templatefile == 'store/ox/manage') && $loggedin}clientarea-entered{/if}" id="mainNavbarCollapse">
    {if !empty($hostx_theme_settings.header_logo)}
            <a href="{if $hostx_theme_settings.header_logo_link neq ''}{$hostx_theme_settings.header_logo_link}{else}{$WEB_ROOT}/index.php{/if}" {if $hostx_theme_settings.enable_header_target eq 'on'}target="_blank"{/if}  class="logo {if $filename == 'clientarea' || $filename == 'submitticket' || $filename == 'affiliates' || $filename == 'supporttickets' || $filename == 'serverstatus' || $filename == 'viewticket' || $templatefile == 'account-user-management' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-paymentmethods' || $templatefile == 'account-paymentmethods-manage' || $templatefile == 'announcements' || $templatefile == 'knowledgebase' || $templatefile == 'downloads' || $templatefile == 'viewannouncement' || $templatefile == 'knowledgebasecat' || $templatefile == 'knowledgebasearticle' || $templatefile == 'user-password' || $templatefile == 'user-profile' || $templatefile == 'user-switch-account' || $templatefile == 'user-security' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-contacts-new' || $templatefile == 'store/ox/manage'}mega-new-menu-logo{/if}">
                <img src="{$hostx_theme_settings.header_logo}" alt="{$companyname}" {if $hostx_theme_settings.header_logo_height neq ''}height="{$hostx_theme_settings.header_logo_height}"{/if} {if $hostx_theme_settings.header_logo_width neq ''}width="{$hostx_theme_settings.header_logo_width}" {/if}>
            </a>
    {else}
            <a href="{if $hostx_theme_settings.header_logo_link neq ''}{$hostx_theme_settings.header_logo_link}{else}{$WEB_ROOT}/index.php{/if}" class="logo logo-text {if $filename == 'clientarea' || $filename == 'submitticket' || $filename == 'affiliates' || $filename == 'supporttickets' || $filename == 'serverstatus' || $filename == 'viewticket' || $templatefile == 'account-user-management' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-paymentmethods' || $templatefile == 'account-paymentmethods-manage' || $templatefile == 'announcements' || $templatefile == 'knowledgebase' || $templatefile == 'downloads' || $templatefile == 'viewannouncement' || $templatefile == 'knowledgebasecat' || $templatefile == 'knowledgebasearticle' || $templatefile == 'user-password' || $templatefile == 'user-profile' || $templatefile == 'user-switch-account' || $templatefile == 'user-security' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-contacts-new' || $templatefile == 'store/ox/manage'}mega-new-menu-logo{/if}" {if $hostx_theme_settings.enable_header_target eq 'on'}target="_blank"{/if}>{$companyname}</a>
    {/if}
    {if $sidebarHostxRemove eq 'true' || $templatefile eq 'homepage' || !$loggedin || $filename == 'cart' || $templatefile == 'products' ||  $templatefile == 'configureproductdomain' || $templatefile == 'domain-renewals' || $templatefile == 'store/weebly/index' || $templatefile == 'store/ssl/index' || $templatefile == 'store/codeguard/index' || $templatefile == 'store/sitelock/index' || $templatefile == 'store/spamexperts/index' || $templatefile == 'store/sitelockvpn/index' || $templatefile == 'store/marketgoo/index' || $templatefile == 'store/ox/index' || $templatefile == 'store/sitebuilder/index' || $templatefile == 'store/order' || $templatefile == 'store/cpanelseo/index' || $templatefile == 'store/nordvpn/index' || $templatefile == 'store/threesixtymonitoring/index' || $templatefile == 'store/xovinow/index'}
        <ul class="nav navbar-nav justify-content-between w100p">
                {foreach $topMenusData as $topMenuData}
                    <li class="{if $topMenuData.menutype neq '1'}hostx-dropdown{/if}" > <a class="nav-link {if $topMenuData.menutype neq '1'}dropdown-toggle{/if} menu_top" 
                    href="{if $topMenuData.menuthirdparty eq '1'}{$topMenuData.url}{else}
                    {if $topMenuData.menutype eq '3' || $topMenuData.menutype eq '2'}{$WEB_ROOT}/#{else}{$WEB_ROOT}/{$topMenuData.url}{/if}{/if}" 
                    {if $topMenuData.url eq '#'} role="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" {/if} {if $topMenuData.menunewtab eq '1'}target="_blank"{/if}>{$topMenuData.name}</a>
                        {if $topMenuData.menutype neq '1'}
                            <div class="dropdown-menu megamenu">
                                <div class="container">
                                    <div class="row">
                                    <div class="col-md-8 ">
                                        {if $topMenuData.description neq ''}
                                            <div class="col-md-4">
                                                <div class="drow_menu">
                                                    <h3>{$topMenuData.name}</h3>
                                                    <p>{$topMenuData.description|html_entity_decode}</p>
                                                    {if $topMenuData.caption_button_name neq ''}
                                                        <a href="{$topMenuData.menu_caption_url}" class="btn btn-danger text-uppercase learn_btn"><b>{$topMenuData.caption_button_name}</b></a>
                                                    {/if}
                                                </div>
                                            </div>
                                        {/if}  
                                        {if $topMenuData.menutype eq '3'}
                                            {foreach $topMenuData.submenu as $submenu}  
                                                {if $submenu.childsubmenu}
                                                    <div class="col-md-4 drow_menu">
                                                        <h5>{$submenu.name}</h5>
                                                        <ul class="nav flex-column ">
                                                            {foreach $submenu.childsubmenu as $childsubmenu}
                                                                <li class="nav-item">
                                                                    <a class="nav-link active" href="{if $childsubmenu.menuthirdparty eq '1'}{$childsubmenu.url}{else}{$WEB_ROOT}/{$childsubmenu.url}{/if}" {if $childsubmenu.menunewtab eq '1'}target="_blank"{/if}><i class="{if $childsubmenu.icon neq ''}{$childsubmenu.icon}{else}fa fa-check{/if}"></i> &nbsp; {$childsubmenu.name}</a>
                                                                </li>
                                                            {/foreach}
                                                        </ul>
                                                    </div>                            
                                                {/if}    
                                            {/foreach}
                                            {if $topMenuData.submenu|@count == '1' && $topMenuData.description neq ''}
                                                <div class="col-md-4 drow_menu empty-menu">
                                                    &nbsp;
                                                </div>
                                            {else if $topMenuData.submenu|@count == '1' && $topMenuData.description eq ''}
                                                <div class="col-md-6 drow_menu empty-menu">
                                                    &nbsp;
                                                </div>  
                                            {else if $topMenuData.submenu|@count == '2' && $topMenuData.description eq ''}
                                                <div class="col-md-4 drow_menu empty-menu">
                                                    &nbsp;
                                                </div>    
                                            {/if}
                                        {elseif $topMenuData.menutype eq '2'}
                                            <div class="col-md-4 drow_menu">
                                                <h5>{$topMenuData.name}</h5>
                                                <ul class="nav flex-column ">
                                                    {foreach $topMenuData.submenu as $submenu}
                                                        <li class="nav-item">
                                                            <a class="nav-link active" href="{if $submenu.menuthirdparty eq '1'}{$submenu.url}{else}{$WEB_ROOT}/{$submenu.url}{/if}" {if $submenu.menunewtab eq '1'}target="_blank"{/if}><i class="{if $submenu.icon neq ''}{$submenu.icon}{else}fa fa-check{/if}"></i> &nbsp; {$submenu.name}</a>
                                                        </li>
                                                    {/foreach}
                                                </ul>
                                            </div>
                                            <div class="col-md-{if $topMenuData.description neq ''}3{else}6{/if} drow_menu empty-menu">
                                                &nbsp;
                                            </div>
                                        {/if}	
                                    </div>
                                        <div class="col-md-4 text-center">
                                            {if $tld_data['show_on_menu'] neq ''}
                                            <div class="register">
                                                <div class="carousel slide" data-ride="carousel">
                                                    <!-- The slideshow -->
                                                    <div class="carouselInnerCT carousel-inner">
                                                        {foreach from=$tld_data['show_on_menu']  item=sale_item}
                                                        <div class="carousel-item">
                                                            <h2 class="tld-list-show">.{$sale_item->tld_id}</h2>
                                                            <p class="my-3">{$LANG.headercomtext}</p>
                                                            <h2 class="tld-list-show-price">{$sale_item->register}</h2>
															{assign var="extractNumber" value= $sale_item->price|regex_replace:"/[^0-9]/":""}
															{if $extractNumber gt 0}
                                                            <h5 class="mb-3">{$LANG.headerwas} <span class="strike">{$sale_item->price}</span></h5>
                                                            {/if}
                                                            <a href="{$WEB_ROOT}/cart.php?&a=add&domain=register&tld=.{$sale_item->tld_id}&sld=" class="btn btn-danger text-uppercase learn_btn mb-4">
                                                            {$LANG.headerregister}
                                                            </a>
                                                        </div>
                                                        {/foreach}
                                                    </div>
                                                </div>
                                            </div>
                                            {/if}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        {/if}
                    </li>
                {/foreach}     
                {if $hostx_theme_settings.header_button_txt neq ''}
                    <li class="menu-last-btn">
                        <a href="{$hostx_theme_settings.header_button_link}" class="nav-link" {if $hostx_theme_settings.header_button_link eq '#' || $hostx_theme_settings.header_button_link eq ''} role="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"{/if}><i class="fa fa-search"></i> {$hostx_theme_settings.header_button_txt}</a>
                        <div class="dropdown-menu megamenu">
                            <div class="container container-domain">
                                <div class="row">
                                    <div class="col-sm-8">
                                    <form action="{$WEB_ROOT}/domainchecker.php" method="post">  
                                        <input type="hidden" name="register">
                                            <div class="left-domain-bnr">
                                                <h2>{$LANG.findyour} <span class="red-sp-d">{$LANG.headerdomain}</span> {$LANG.contactname}</h2>
                                                <div class="domain-name-cintainer">
                                                    <div class="domain-name-cintainer-inner">
                                                        <label><img src="{$WEB_ROOT}/templates/{$template}/images/search-icon-p.png" alt="serach"></label>
                                                        <input type="text" class="form-control input-domain" placeholder="{$LANG.domainBlockPlaceHolder}" name="domain">
                                                        <button type="submit" class="btn btn-default domain-search-bn">{$LANG.domainsearch}</button> 
                                                    </div>
                                                </div>
                                                <ul class="domain-name-ul currency_style_{$currency_format}">
                                                {foreach from=$tld_data['show_on_menu']  item=sale_item}
                                                    <li class="block-{$sale_item->tld_id}"><strong class="font-22" ><span>.</span>{$sale_item->tld_id}</strong><span>{$sale_item->register}</span></li>
                                                    {/foreach}
                                                </ul>
                                            </div>
                                        </form>    
                                    </div>
                                    <div class="col-sm-4">
                                        <div class="banner-right-domain-img">
                                            <img src="{$WEB_ROOT}/templates/{$template}/images/www-img.png" alt="globe">
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </li> 
                {/if}
        </ul>
    {else}
        <div class="wgs-menu-in-clientarea">
        {if $filename == 'clientarea' || $filename == 'submitticket' || $filename == 'affiliates' || $filename == 'supporttickets' || $filename == 'serverstatus' || $filename == 'viewticket' || $templatefile == 'account-user-management' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-paymentmethods' || $templatefile == 'account-paymentmethods-manage' || $templatefile == 'announcements' || $templatefile == 'knowledgebase' || $templatefile == 'downloads' || $templatefile == 'viewannouncement' || $templatefile == 'knowledgebasecat' || $templatefile == 'knowledgebasearticle' || $templatefile == 'user-password' || $templatefile == 'user-profile' || $templatefile == 'user-switch-account' || $templatefile == 'user-security' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-contacts-new' || $templatefile == 'store/ox/manage'}
            {if $hostx_theme_settings.enable_primary_sidebar_left neq 'on'}
                <div class="primary-side-open-close-side-new trynowone">
                    <div class="primary-menu-toggle {if $primarySideBarStatus eq '' || $primarySideBarStatus eq 'open'}change-primary{/if}" onclick="wgsChangeSideBarNavigationsButtons(this,'primary');">
                        <div class="bar1"></div>
                        <div class="bar2"></div>
                        <div class="bar3"></div>
                    </div>
                </div>
            {/if}
            <a href="{$WEB_ROOT}/index.php" class="home-logo-mega-menu"><i class="fa fa-home"></i></a>
        {/if}
        <ul class="nav right_navi new-mega-menu-right-bar"> 
                {if $hostx_theme_settings.phone_display eq 'yes'}
                    {if empty($hostx_theme_settings.phone)}
                        <li><a href="tel:{$LANG.headerphone}" class="telephoneanchor"><i class="fa fa-phone"></i><span>{$LANG.headerphone}</span></a></li>
                    {else}
                        <li><a href="tel:+{$hostx_theme_settings.country_calling_code_phone}{$hostx_theme_settings.phone}" class="telephoneanchor"><i class="fa fa-phone"></i><span> (+{$hostx_theme_settings.country_calling_code_phone}) {$hostx_theme_settings.phone}</span></a></li>
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
        {if $filename == 'clientarea' || $filename == 'submitticket' || $filename == 'affiliates' || $filename == 'supporttickets' || $filename == 'serverstatus' || $filename == 'viewticket' || $templatefile == 'account-user-management' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-paymentmethods' || $templatefile == 'account-paymentmethods-manage' || $templatefile == 'announcements' || $templatefile == 'knowledgebase' || $templatefile == 'downloads' || $templatefile == 'viewannouncement' || $templatefile == 'knowledgebasecat' || $templatefile == 'knowledgebasearticle' || $templatefile == 'user-password' || $templatefile == 'user-profile' || $templatefile == 'user-switch-account' || $templatefile == 'user-security' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-contacts-new' || $templatefile == 'store/ox/manage'}
            {if $hostx_theme_settings.enable_secondary_sidebar_right neq 'on'}
                {if !$inShoppingCart && ($secondarySidebar->hasChildren() || $primarySidebar->hasChildren())}
                    <div class="secondary-side-open-close-side-new">
                        <div class="secondary-menu-toggle {if $secondarySideBarStatus eq '' ||  $secondarySideBarStatus eq 'open'}change-secondary{/if}" onclick="wgsChangeSideBarNavigationsButtons(this,'secondary');">
                            <div class="bar1"></div>
                            <div class="bar2"></div>
                            <div class="bar3"></div>
                        </div>
                    </div>
                {/if}
            {/if}						
        {/if}
        </div>
    {/if}
</div>