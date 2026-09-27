{if $hostx_blocks[$block_slug]}
<!-- best VPS server -->
<div class="best-vps-server">
  <h2>{eval var=$hostx_blocks[$block_slug]->title|html_entity_decode}</h2>
  <div class="container">
    <div class="row">
      {foreach $hostx_blocks[$block_slug]->widgets as $widget}
        {eval var=$widget->widget_description|html_entity_decode}
      {/foreach}
    </div>
  </div>
</div>
<!-- best VPS server end -->
{else}
<div class="best-vps-server">
  <h2>{$LANG.vpssearchvps}</h2>
  <div class="container">
    <div class="row">

      <div class="col-sm-4">
        <div class="cols">
           <img src="{$WEB_ROOT}/templates/{$template}/images/cpu.png" alt="cpu-server-image">
           <h3>{$LANG.vpsfastsimple}</h3>
           <p>{$LANG.vpsfastsimpletext}</p>
        </div>
      </div>

      <div class="col-sm-4">
        <div class="cols">
           <img src="{$WEB_ROOT}/templates/{$template}/images/EASY.png" alt="video player settings">
           <h3>{$LANG.vpseasypanel}</h3>
           <p>{$LANG.vpseasypaneltext}</p>
        </div>
      </div>

      <div class="col-sm-4">
        <div class="cols">
           <img src="{$WEB_ROOT}/templates/{$template}/images/support1.png" alt="support icon">
           <h3>{$LANG.vpsawardwinsupport}</h3>
           <p>{$LANG.vpsawardwinsupporttext}</p>
        </div>
      </div>

      <div class="col-sm-4">
        <div class="cols">
           <img src="{$WEB_ROOT}/templates/{$template}/images/custom.png" alt="custom icon">
           <h3>{$LANG.vpsedgehardware}</h3>
           <p>{$LANG.vpsedgehardwaretext}</p>
        </div>
      </div>

      <div class="col-sm-4">
        <div class="cols">
           <img src="{$WEB_ROOT}/templates/{$template}/images/PRIVATe.png" alt="private network">
           <h3>{$LANG.vpsprivateserver}</h3>
           <p>{$LANG.vpsprivateservertext}.</p>
        </div>
      </div>

      <div class="col-sm-4">
        <div class="cols">
           <img src="{$WEB_ROOT}/templates/{$template}/images/cloud.png" alt="cloud database">
           <h3>{$LANG.vpshighcloudserver}</h3>
           <p>{$LANG.vpshighcloudservertext}. </p> 
        </div>
      </div>

    </div>
  </div>
</div>
{/if}