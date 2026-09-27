<header class="top-mega-menu-latest-cls {if $filename == 'clientarea' || $filename == 'submitticket' || $filename == 'affiliates' || $filename == 'supporttickets' || $filename == 'serverstatus' || $filename == 'viewticket' || $templatefile == 'account-user-management' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-paymentmethods' || $templatefile == 'account-paymentmethods-manage' || $templatefile == 'announcements' || $templatefile == 'knowledgebase' || $templatefile == 'downloads' || $templatefile == 'viewannouncement' || $templatefile == 'knowledgebasecat' || $templatefile == 'knowledgebasearticle' || $templatefile == 'user-password' || $templatefile == 'user-profile' || $templatefile == 'user-switch-account' || $templatefile == 'user-security' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-contacts-new' || $templatefile == 'store/ox/manage'} wgs-top-menu-latest-clientarea{/if}">
   <div class="main-top-sec">
      <div class="container">
         <div class="main-sec">
            <div class="left-sec">
               <div class="logo-sec">
                  {if !empty($hostx_theme_settings.header_logo)}
                     <a href="{if $hostx_theme_settings.header_logo_link neq ''}{$hostx_theme_settings.header_logo_link}{else}{$WEB_ROOT}/index.php{/if}" {if $hostx_theme_settings.enable_header_target eq 'on'}target="_blank"{/if}  class="logo {if $filename == 'clientarea' || $filename == 'submitticket' || $filename == 'affiliates' || $filename == 'supporttickets' || $filename == 'serverstatus' || $filename == 'viewticket' || $templatefile == 'account-user-management' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-paymentmethods' || $templatefile == 'account-paymentmethods-manage' || $templatefile == 'announcements' || $templatefile == 'knowledgebase' || $templatefile == 'downloads' || $templatefile == 'viewannouncement' || $templatefile == 'knowledgebasecat' || $templatefile == 'knowledgebasearticle' || $templatefile == 'user-password' || $templatefile == 'user-profile' || $templatefile == 'user-switch-account' || $templatefile == 'user-security' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-contacts-new' || $templatefile == 'store/ox/manage'}mega-latest-menu{/if}"><img src="{$hostx_theme_settings.header_logo}" alt="{$companyname}" {if $hostx_theme_settings.header_logo_height neq ''}height="{$hostx_theme_settings.header_logo_height}"{/if} {if $hostx_theme_settings.header_logo_width neq ''}width="{$hostx_theme_settings.header_logo_width}" {/if}>
                     </a>
                  {else}
                     <a href="{if $hostx_theme_settings.header_logo_link neq ''}{$hostx_theme_settings.header_logo_link}{else}{$WEB_ROOT}/index.php{/if}" class="logo logo-text {if $filename == 'clientarea' || $filename == 'submitticket' || $filename == 'affiliates' || $filename == 'supporttickets' || $filename == 'serverstatus' || $filename == 'viewticket' || $templatefile == 'account-user-management' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-paymentmethods' || $templatefile == 'account-paymentmethods-manage' || $templatefile == 'announcements' || $templatefile == 'knowledgebase' || $templatefile == 'downloads' || $templatefile == 'viewannouncement' || $templatefile == 'knowledgebasecat' || $templatefile == 'knowledgebasearticle' || $templatefile == 'user-password' || $templatefile == 'user-profile' || $templatefile == 'user-switch-account' || $templatefile == 'user-security' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-contacts-new' || $templatefile == 'store/ox/manage'}mega-latest-menu{/if}" {if $hostx_theme_settings.enable_header_target eq 'on'}target="_blank"{/if}>{$companyname}
                     </a>
                  {/if}
               </div>
               {if $languagechangeenabled && count($locales) > 1}
                  <div class="country-sec">
                     <ul class="counrty-inner">
                        <li>
                           <a href="#"><i class="fa fa-globe"></i>{$hxselectedlanguage.localisedName}<i class="fa fa-chevron-down"></i></a>
                           <div class="country-dropdown"> 
                              {foreach $hxlanguagesflags as $locale}
                                 <a class="dropdown-item" href="{$currentpagelinkback}language={$locale.language}"><img src="{$WEB_ROOT}/templates/{$template}/flags/blank.gif" class="flag flag-{$locale.flagcode}" alt="{$locale.localisedName}" /> {$locale.localisedName}</a>
                              {/foreach}
                           </div>
                        </li>
                     </ul>
                  </div> 
               {/if}
            </div>
            <div class="right-sec">
            {if $sidebarHostxRemove eq 'true' || $templatefile eq 'homepage' || !$loggedin || $filename == 'cart' || $templatefile == 'products' || $templatefile == 'configureproductdomain' || $templatefile == 'domain-renewals' || $templatefile == 'store/weebly/index' || $templatefile == 'store/ssl/index' || $templatefile == 'store/codeguard/index' || $templatefile == 'store/sitelock/index' || $templatefile == 'store/spamexperts/index' || $templatefile == 'store/sitelockvpn/index' || $templatefile == 'store/marketgoo/index' || $templatefile == 'store/ox/index' || $templatefile == 'store/sitebuilder/index' || $templatefile == 'store/order' || $templatefile == 'store/cpanelseo/index' || $templatefile == 'store/nordvpn/index' || $templatefile == 'store/threesixtymonitoring/index' || $templatefile == 'store/xovinow/index'}
               <ul class="list-menu top-menu-ul-header-latest">
                  {foreach $topMenusData as $topMenuData}
                     <li class="top-menu-li-header">
                        <a href="{if $topMenuData.menuthirdparty eq '1'}{$topMenuData.url}{else}
                        {if $topMenuData.menutype eq '3' || $topMenuData.menutype eq '2'}javascript:void(0){else}{$WEB_ROOT}/{$topMenuData.url}{/if}{/if}" class="top-menu-parent {if $topMenuData.submenu}have-child{/if}">{$topMenuData.name} {if $topMenuData.menutype neq '1'}<i class="fa fa-chevron-down"></i>{/if}</a>
                        {if $topMenuData.menutype neq '1'}
                        <div class="drop-down-menu">
                           <div class="row">
                              {if $topMenuData.menutype eq '3'}
                                 <div class="col-md-6 border-right-mnu">
                                    <div class="left-side">
                                       <ul class="left-list">
                                          {foreach $topMenuData.submenu as $submenu}
                                             {if $submenu.childsubmenu}
                                                <li class="left-list-inner">
                                                   <div class="li-descp-head-title-data hidden">{$submenu.menu_head_line}</div>
                                                   <div class="li-descp-head-descp-data hidden">{if $submenu.menu_side_description neq ''}<ul class="nav side-description-menu">{$submenu.menu_side_description}</ul>{/if}</div>
                                                   <a class="first-list cursorPointerCss">
                                                      <div class="icon-sec">
                                                         <div class="icon-img-new">
                                                            <i class="{if $submenu.icon neq ''}{$submenu.icon}{else}fa fa-check{/if}" aria-hidden="true"></i>
                                                         </div>
                                                      </div>
                                                      <div class="text-sec">
                                                         <h5>{$submenu.name}</h5>
                                                         <p>{$submenu.menu_tag_line}</p>
                                                      </div>
                                                   </a>
                                                   <div class="child-link-data hidden">
                                                      <div class="bottom-sec">
                                                         <div class="bottom-sec-ul">
                                                            <h5>{$submenu.menu_bottom_sec_head_line}</h5>
                                                            <ul class="nav bottomChildLinks">
                                                               {foreach $submenu.childsubmenu as $childsubmenu}
                                                                  <li class="nav-item">
                                                                     <a href="{if $childsubmenu.menuthirdparty eq '1'}{$childsubmenu.url}{else}{$WEB_ROOT}/{$childsubmenu.url}{/if}" {if $childsubmenu.menunewtab eq '1'}target="_blank"{/if}><i class="{if $childsubmenu.icon neq ''}{$childsubmenu.icon}{else}fa fa-check{/if}"></i> &nbsp; {$childsubmenu.name}</a>
                                                                  </li>
                                                               {/foreach}
                                                            </ul>
                                                         </div>
                                                      </div>
                                                   </div>
                                                </li>
                                             {/if}
                                          {/foreach}
                                       </ul>
                                    </div>
                                 </div>
                                 <div class="col-md-6 right-side-panel-data hidden">
                                    <div class="right-side">
                                       <div class="right-ul"><h5></h5></div>
                                    </div>
                                 </div>
                                 <div class="col-md-12 bottom-menu-link-header-latest"></div>                                 
                              {elseif $topMenuData.menutype eq '2'}
                                 <div class="col-md-6 border-right-mnu">
                                    <div class="left-side">
                                       <ul class="left-list">
                                          {foreach $topMenuData.submenu as $submenu}
                                                <li class="left-list-inner">
                                                   <div class="li-descp-head-title-data hidden">{$submenu.menu_head_line}</div>
                                                   <div class="li-descp-head-descp-data hidden">{if $submenu.menu_side_description neq ''}<ul class="nav side-description-menu">{$submenu.menu_side_description}</ul>{/if}</div>
                                                   <a class="first-list cursorPointerCss">
                                                      <div class="icon-sec">
                                                         <div class="icon-img-new">
                                                            <i class="{if $submenu.icon neq ''}{$submenu.icon}{else}fa fa-check{/if}" aria-hidden="true"></i>
                                                         </div>
                                                      </div>
                                                      <div class="text-sec">
                                                         <h5>{$submenu.name}</h5>
                                                         <p>{$submenu.menu_tag_line}</p>
                                                      </div>
                                                   </a>
                                                   <div class="child-link-data hidden">
                                                      <div class="bottom-sec">
                                                         <div class="bottom-sec-ul">
                                                            <h5>{$submenu.menu_bottom_sec_head_line}</h5>
                                                            <ul class="nav bottomChildLinks">                                                              
                                                                  <li class="nav-item">
                                                                     <a href="{if $submenu.menuthirdparty eq '1'}{$submenu.url}{else}{$WEB_ROOT}/{$submenu.url}{/if}" {if $submenu.menunewtab eq '1'}target="_blank"{/if}><i class="{if $submenu.icon neq ''}{$submenu.icon}{else}fa fa-check{/if}"></i> &nbsp; {$submenu.name}</a>
                                                                  </li>
                                                            </ul>
                                                         </div>
                                                      </div>
                                                   </div>
                                                </li>
                                          {/foreach}
                                       </ul>
                                    </div>
                                 </div>
                                 <div class="col-md-6 right-side-panel-data hidden">
                                    <div class="right-side">
                                       <div class="right-ul"><h5></h5></div>
                                    </div>
                                 </div>
                                 <div class="col-md-12 bottom-menu-link-header-latest"></div> 
                              {/if}
                           </div>
                        </div>
                        {/if}
                     </li>
                  {/foreach}
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
         </div>
      </div>
   </div>
</header>
<script>
   jQuery(document).ready(function(){
      jQuery("ul.top-menu-ul-header-latest").find("li.top-menu-li-header").each(function(){
         jQuery(this).find("li.left-list-inner").eq(0).addClass("active");
         var headTitleMenu = jQuery(this).find("li.left-list-inner").eq(0).find(".li-descp-head-title-data").html();
         var headDescriptionMenu = jQuery(this).find("li.left-list-inner").eq(0).find(".li-descp-head-descp-data").html();
         var childMenuLink = jQuery(this).find("li.left-list-inner").eq(0).find(".child-link-data").html();
         jQuery(this).find(".right-side-panel-data").find("h5").html(headTitleMenu);
         jQuery(this).find(".right-side-panel-data").find("h5").after(headDescriptionMenu);
         jQuery(this).find(".bottom-menu-link-header-latest").html(childMenuLink);
         jQuery(this).find(".right-side-panel-data").removeClass("hidden");
         jQuery(this).find(".bottom-menu-link-header-latest").removeClass("hidden");
      });
      jQuery("ul.top-menu-ul-header-latest").find("li.top-menu-li-header").find("a.top-menu-parent").on('click',function(){
         if(jQuery(this).parent().hasClass("active-show-mobile")){
            jQuery(this).parent().removeClass("active-show-mobile");
         }else{
            jQuery("ul.top-menu-ul-header-latest").find("li.top-menu-li-header.active-show-mobile").removeClass("active-show-mobile");
            jQuery(this).parent().addClass("active-show-mobile");
         }
      });
      jQuery("li.left-list-inner").on('click',function(){
         jQuery(this).parent().find("li.left-list-inner.active").removeClass("active");      
         jQuery(this).addClass("active");
         var headTitleMenu = jQuery(this).find(".li-descp-head-title-data").html();
         var headDescriptionMenu = jQuery(this).find(".li-descp-head-descp-data").html();
         var childMenuData = jQuery(this).find(".child-link-data").html();
         jQuery(this).parent().parent().parent().parent().find(".right-side-panel-data").find("h5").html('');
         jQuery(this).parent().parent().parent().parent().find(".bottom-menu-link-header-latest").html('');
         jQuery(this).parent().parent().parent().parent().find(".right-side-panel-data").find("ul.side-description-menu").remove();
         jQuery(this).parent().parent().parent().parent().find(".right-side-panel-data").find("h5").html(headTitleMenu);
         jQuery(this).parent().parent().parent().parent().find(".right-side-panel-data").find("h5").after(headDescriptionMenu);
         jQuery(this).parent().parent().parent().parent().find(".bottom-menu-link-header-latest").html(childMenuData);
      });
      jQuery("li.top-menu-li-header").on('mouseover',function(){
         jQuery("ul.top-menu-ul-header-latest").find(".drop-down-menu").removeClass("show");
      });
   });
</script>