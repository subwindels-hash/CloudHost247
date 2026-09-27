{if $hostx_blocks['footer_block']}
<footer class="footer {if $filename == 'clientarea' || $filename == 'submitticket' || $filename == 'affiliates' || $filename == 'supporttickets' || $filename == 'serverstatus' || $filename == 'viewticket' || $templatefile == 'account-user-management' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-paymentmethods' || $templatefile == 'account-paymentmethods-manage' || $templatefile == 'announcements' || $templatefile == 'knowledgebase' || $templatefile == 'downloads' || $templatefile == 'viewannouncement' || $templatefile == 'knowledgebasecat' || $templatefile == 'knowledgebasearticle' || $templatefile == 'user-password' || $templatefile == 'user-profile' || $templatefile == 'user-switch-account' || $templatefile == 'user-security' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-contacts-new'}clientarea-footer-entered{/if}" id="mainfooterhostx">
    <div class="container">
    	<div class="row">
	        {foreach $hostx_blocks['footer_block']->widgets as $widget}
	          {eval var=$widget->widget_description|html_entity_decode}
	        {/foreach}
        </div>
    </div>
</footer>
{else}
<footer class="footer {if $filename == 'clientarea' || $filename == 'submitticket' || $filename == 'affiliates' || $filename == 'supporttickets' || $filename == 'serverstatus' || $filename == 'viewticket' || $templatefile == 'account-user-management' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-paymentmethods' || $templatefile == 'account-paymentmethods-manage' || $templatefile == 'announcements' || $templatefile == 'knowledgebase' || $templatefile == 'downloads' || $templatefile == 'viewannouncement' || $templatefile == 'knowledgebasecat' || $templatefile == 'knowledgebasearticle' || $templatefile == 'user-password' || $templatefile == 'user-profile' || $templatefile == 'user-switch-account' || $templatefile == 'user-security' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-contacts-new'}clientarea-footer-entered{/if}" id="mainfooterhostx">
    <div class="container">
        <div class="row">
            <div class="col-sm-4">
                <div class="footer_col">
                    <h4>{$LANG.footeraboutus}</h4>
                    <p>{$LANG.footeraboutustext}.</p>
                    <a href="#" class="button03">{$LANG.footergettouch}</a>
                </div>
            </div>
            <div class="col-sm-4">
                <div class="footer_col">
                    <h4>{$LANG.footercontactinfo}</h4>
                    <a href="#">{$LANG.footer24support}</a>
                    <h4 class="mt-2">+{$hostx_theme_settings.country_calling_code_phone} {$hostx_theme_settings.phone}</h4>
                    <p class="mt-3">{$LANG.footeremail}</p>
                    <a href="#" class="color_white">{$companyEmailAddress}</a>
                    <div class="clearfix"></div>
					{if !empty($hostx_theme_settings.facebook_handle_code) || !empty($hostx_theme_settings.instagram_handle_code) || 
					!empty($hostx_theme_settings.pinrest_handle_code) || 
					!empty($hostx_theme_settings.linkedin_handle_code) || 
					!empty($hostx_theme_settings.twitter_handle_code)}
					    <a href="#" class="mt-3 pull-left">{$LANG.footerfollowus}</a>
						<ul class="socil_icon">
						{if !empty($hostx_theme_settings.facebook_handle_code)}
							<li>
								<a href="{$hostx_theme_settings.facebook_handle_code}" target="_blank"><i class="fab fa-facebook"></i></a>
							</li>
						{/if}
						{if !empty($hostx_theme_settings.instagram_handle_code)}
							<li>
								<a href="{$hostx_theme_settings.instagram_handle_code}" target="_blank">
								<i class="fab fa-instagram"></i></a>
							</li>
						{/if}
						{if !empty($hostx_theme_settings.pinrest_handle_code)}
							<li>
								<a href="{$hostx_theme_settings.pinrest_handle_code}" target="_blank">
								<i class="fab fa-pinterest"></i></a>
							</li>
						{/if}
						{if !empty($hostx_theme_settings.linkedin_handle_code)}
							<li>
								<a href="{$hostx_theme_settings.linkedin_handle_code}" target="_blank">
								<i class="fab fa-linkedin"></i>
								</a>
							</li>
						{/if}
						{if !empty($hostx_theme_settings.twitter_handle_code)}
							<li>
								<a href="{$hostx_theme_settings.twitter_handle_code}" target="_blank">
								<i class="fab fa-twitter"></i></a>
							</li>
						{/if}
						</ul>
					{/if}
                </div>
            </div>
            <div class="col-sm-4">
                <div class="footer_col">
                    <h4>{$LANG.footerusefullinks}</h4>
                    <ul class="footer_links">
                        <li><a href="{$WEB_ROOT}/dedeicated-server.php">{$LANG.headerdedicatedservers}</a></li>
                        <li><a href="{$WEB_ROOT}/windows-hosting.php">{$LANG.headerwindowhosting} </a></li>
                        <li><a href="{$WEB_ROOT}/vps-hosting.php">{$LANG.homecloudhosting} </a></li>
                        <li><a href="{$WEB_ROOT}/cpanel-hosting.php">{$LANG.footerlinuxservers} </a></li>
                    </ul> 
                </div>
            </div>
        </div>
    </div>
</footer>
{/if}