{if $hostx_blocks[$block_slug]}
<div class="vps-hosting">
  <div class="container">
    <h2>{eval var=$hostx_blocks[$block_slug]->title}</h2>
    {foreach $hostx_blocks[$block_slug]->widgets as $widget}
             {eval var=$widget->widget_description|html_entity_decode}
    {/foreach}
  </div>
</div>
{else}
<div class="vps-hosting">
  <div class="container">
    <h2>{$LANG.vpschoosehosting}?</h2>
        <div class="vps-hosting-list"> 
            <div class="row">      
                <div class="col-sm-3 left">
                  <img class="img-responsive" src="{$WEB_ROOT}/templates/{$template}/images/icon_b1.png" alt="server">
                </div>
                <div class="col-sm-8 right">  
                  <h2>{$LANG.vpsfullaccess}</h2>
                  <p>{$LANG.vpsfullaccesstext}</p> 
                </div>
              </div>
        </div>
        <div class="vps-hosting-list"> 
          <div class="row">      
            <div class="col-sm-3 left">
              <img class="img-responsive" src="{$WEB_ROOT}/templates/{$template}/images/icon_b2.png" alt="computer image">
            </div>
            <div class="col-sm-8 right">  
              <h2>{$LANG.vpsintegratedcpanel}</h2> 
              <p>{$LANG.vpsintegratedcpaneltext}</p> 
              <p>{$LANG.vpsintegratedcpaneltext2}.</p> 
            </div>
          </div>
        </div>
        <div class="vps-hosting-list"> 
          <div class="row">
              <div class="col-sm-3 left">
                <img class="img-responsive" src="{$WEB_ROOT}/templates/{$template}/images/icon_b3.png" alt="vps globe">
              </div>
              <div class="col-sm-8 right">  
                <h2>{$LANG.vpsinstantprovision}</h2>  
                <p>{$LANG.vpsinstantprovisiontext}.</p> 
                <p>{$LANG.vpsinstantprovisiontext2}.</p> 
              </div>
          </div>
        </div>
  </div>
</div>
{/if}