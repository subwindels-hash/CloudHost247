{if $hostx_blocks[$block_slug]}
<div class="custom-block-3">
  <div class="container">
	<div class="row">
      {foreach $hostx_blocks[$block_slug]->widgets as $widget}
        {eval var=$widget->widget_description|html_entity_decode}
      {/foreach}
	</div>
  </div>
</div>
{else}
<div class="custom-block-3">
   <div class="container">
      <div class="row">
         <div class="col-md-6">
            <div class="b-left-box">
               <div class="figure-icon"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/fgr-icon1.svg" alt="right icon"></div>
               <div class="b-left-box-cont">
                  <h5>Everything You’ll need</h5>
                  <p>We monitor and manage multiple domain centralization in real-time to ensure your websites are always up and running.</p>
               </div>
            </div>
            <div class="b-left-box">
               <div class="figure-icon"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/fgr-icon3.svg" alt="server reload"></div>
               <div class="b-left-box-cont">
                  <h5>Backup</h5>
                  <p>We provide website backup and disaster recovery services in the easiest way possible; saving time and securing data.</p>
               </div>
            </div>
            <div class="b-left-box">
               <div class="figure-icon"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/fgr-icon2.svg" alt="open source code"></div>
               <div class="b-left-box-cont">
                  <h5>Free SSL</h5>
                  <p>Start protecting your e-commerce, logins, and more in just a few minutes with an automated domain validated FreeSSL.</p>
               </div>
            </div>
            <div class="b-left-box">
               <div class="figure-icon"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/fgr-icon4.svg" alt="user system"></div>
               <div class="b-left-box-cont">
                  <h5>Convenience Softaculous</h5>
                  <p>Softaculous takes care of the complete application lifecycle inclusive of installation, backup, restoration, and updation.</p>
               </div>
            </div>
         </div>
         <div class="col-md-6">
            <div class="b-left-box">
               <div class="figure-icon"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/fgr-icon5.svg" alt="settings icon"></div>
               <div class="b-left-box-cont">
                  <h5>Control Panel - cPanel</h5>
                  <p>Easy manage your domain name, renew the order, & make the most of your purchase with our intuitive control panel.</p>
               </div>
            </div>
            <div class="b-left-box">
               <div class="figure-icon"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/fgr-icon6.svg" alt="lock icon"></div>
               <div class="b-left-box-cont">
                  <h5>Security - Imunify360</h5>
                  <p>The comprehensive multi-layered defense architecture ensures precision targeting and eradication of malware and viruses.</p>
               </div>
            </div>
            <div class="b-left-box">
               <div class="figure-icon"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/fgr-icon7.svg" alt="speed-server"></div>
               <div class="b-left-box-cont">
                  <h5>Performance - LiteSpeed + LSCache</h5>
                  <p>Boost your WordPress, Joomla, and other dynamic websites performance and manage cache while spiking traffic.</p>
               </div>
            </div>
            <div class="b-left-box">
               <div class="figure-icon"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/fgr-icon8.svg" alt="server connnection"></div>
               <div class="b-left-box-cont">
                  <h5>Convenience Migrations</h5>
                  <p>We offer convenience website migration services by transferring files, databases, scripts, and free domain registration transfer.</p>
               </div>
            </div>
         </div>
      </div>
   </div>
</div>
{/if}