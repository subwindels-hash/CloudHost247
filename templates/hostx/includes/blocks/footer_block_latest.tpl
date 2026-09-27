{if $hostx_blocks['footer_block_latest']}
<footer class="footer {if $filename == 'clientarea' || $filename == 'submitticket' || $filename == 'affiliates' || $filename == 'supporttickets' || $filename == 'serverstatus' || $filename == 'viewticket' || $templatefile == 'account-user-management' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-paymentmethods' || $templatefile == 'account-paymentmethods-manage' || $templatefile == 'announcements' || $templatefile == 'knowledgebase' || $templatefile == 'downloads' || $templatefile == 'viewannouncement' || $templatefile == 'knowledgebasecat' || $templatefile == 'knowledgebasearticle' || $templatefile == 'user-password' || $templatefile == 'user-profile' || $templatefile == 'user-switch-account' || $templatefile == 'user-security' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-contacts-new'}clientarea-footer-entered{/if}" id="mainfooterhostx">
   <div class="container">
      <div class="row">
          {foreach $hostx_blocks['footer_block_latest']->widgets as $widget}
            {eval var=$widget->widget_description|html_entity_decode}
          {/foreach}
       </div>
   </div>
</footer>
{else}
<footer class="footer footer-block-latest {if $filename == 'clientarea' || $filename == 'submitticket' || $filename == 'affiliates' || $filename == 'supporttickets' || $filename == 'serverstatus' || $filename == 'viewticket' || $templatefile == 'account-user-management' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-paymentmethods' || $templatefile == 'account-paymentmethods-manage' || $templatefile == 'announcements' || $templatefile == 'knowledgebase' || $templatefile == 'downloads' || $templatefile == 'viewannouncement' || $templatefile == 'knowledgebasecat' || $templatefile == 'knowledgebasearticle' || $templatefile == 'user-password' || $templatefile == 'user-profile' || $templatefile == 'user-switch-account' || $templatefile == 'user-security' || $templatefile == 'account-contacts-manage' || $templatefile == 'account-contacts-new'}clientarea-footer-entered{/if}" id="mainfooterhostx">
   <div class="container">
      <div class="row">
         <div class="footer-logo-container ">
            <div class="footer_col">
               <div class="col-md-3 col-sm-12 ">
                  <img src="{$WEB_ROOT}/templates/{$template}/images/logo-white.png" alt="logo-footer" class="logo-dark img-responsive">
               </div>
               <div class="col-md-9 col-sm-12 ">
                  <h2>We love helping you build your brand.</h2>
               </div>
            </div>
         </div>
         <div class="clearfix"></div>
         <div class="for-desktop">
            <div class="col-md-3 col-sm-6 col-xs-6 ">
               <div class="footer_col">
                  <h4>Domains</h4>
                  <ul class="footer_links">
                     <li><a href="#">Register New Domain</a></li>
                     <li><a href="#">Transfer Domain</a></li>
                     <li><a href="#">Domain Extensions</a></li>
                     <li><a href="#">SSL Security</a></li>
                  </ul>
                  <h4>Hosting</h4>
                  <ul class="footer_links">
                     <li><a href="#">Wordpress Hosting</a></li>
                     <li><a href="#">Window Hosting</a></li>
                     <li><a href="#">Plesk Hosting</a></li>
                     <li><a href="#">cPanel Hosting</a></li>
                  </ul>
               </div>
            </div>
            <div class="col-md-3 col-sm-6 col-xs-6 ">
               <div class="footer_col">
                  <h4>Websites</h4>
                  <ul class="footer_links">
                     <li><a href="#">Website Builder</a></li>
                     <li><a href="#">Website Design</a></li>
                     <li><a href="#">Future Element</a></li>
                     <li><a href="#">Web Hosting</a></li>
                  </ul>
                  <h4>Servers</h4>
                  <ul class="footer_links">
                     <li><a href="#">VPS Hosting</a></li>
                     <li><a href="#">Public Cloud</a></li>
                     <li><a href="#">Private Cloud</a></li>
                     <li><a href="#">Enterprise Server</a></li>
                  </ul>
               </div>
            </div>
            <div class="col-md-3 col-sm-6 col-xs-6 ">
               <div class="footer_col">
                  <h4>Business Services</h4>
                  <ul class="footer_links">
                     <li><a href="#">Business Email</a></li>
                     <li><a href="#">VPN Appliance</a></li>
                     <li><a href="#">SEO Tools</a></li>
                     <li><a href="#">Build Website</a></li>
                  </ul>
                  <h4>Security</h4>
                  <ul class="footer_links">
                     <li><a href="#">SSL Certificates</a></li>
                     <li><a href="#">Website Backup</a></li>
                     <li><a href="#">Website Security</a></li>
                  </ul>
               </div>
            </div>
            <div class="col-md-3 col-sm-6 col-xs-6 ">
               <div class="footer_col">
                  <h4>Hostx</h4>
                  <ul class="footer_links">
                     <li><a href="#">Why Hostx</a></li>
                     <li><a href="#">Frequent Questions</a></li>
                     <li><a href="#">Affiliates Program</a></li>
                     <li><a href="#">Terms of services</a></li>
                  </ul>
                  <h4>Support</h4>
                  <ul class="footer_links">
                     <li><a href="#">Open Ticket</a></li>
                     <li><a href="#">Knowledgebase</a></li>
                     <li><a href="#">News</a></li>
                  </ul>
                  <div class="clearfix"></div>
                  <ul class="socil_icon">
                     <li><a target="_blank" href="{$hostx_theme_settings.linkedin_handle_code}" rel="noopener"><i class="fab fa-linkedin"></i></a></li>
                     <li><a target="_blank" href="{$hostx_theme_settings.twitter_handle_code}" rel="noopener"><i class="fab fa-twitter"></i></a></li>
                     <li><a target="_blank" href="{$hostx_theme_settings.facebook_handle_code}" rel="noopener"><i class="fab fa-facebook"></i></a></li>
                     <li><a target="_blank" href="{$hostx_theme_settings.instagram_handle_code}" rel="noopener"><i class="fab fa-instagram"></i></a></li>
                     <li><a target="_blank" href="{$hostx_theme_settings.pinrest_handle_code}" rel="noopener"><i class="fab fa-pinterest"></i></a></li>
                     <li><a target="_blank" href="#" rel="noopener"><i class="fab fa-skype"></i></a></li>
                  </ul>
               </div>
            </div>
         </div>
      </div>
   </div>
</footer>
{/if}
<script>
   jQuery(document).ready(function(){
   jQuery(".footer_col h4").on('click',function(){
   if(jQuery(this).hasClass("active")){
   jQuery(".footer_col h4").removeClass("active");
   jQuery(".footer_links").removeClass("active");
   }else{
   jQuery(".footer_col h4").removeClass("active");
   jQuery(".footer_links").removeClass("active");
   jQuery(this).addClass("active");
   jQuery(this).next(".footer_links").addClass("active");
   }
   });
   });
   </script>