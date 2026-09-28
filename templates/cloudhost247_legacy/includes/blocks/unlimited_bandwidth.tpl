{if $hostx_blocks[$block_slug]}
<div class="bandwidth">
  <div class="container">
    <div class="bandwidth_in">
    <div class="row">
     {foreach $hostx_blocks[$block_slug]->widgets as $widget}
          {eval var=$widget->widget_description|html_entity_decode}
     {/foreach}  
    </div>
  </div>
  </div>
</div>
{else}
<div class="bandwidth">
  <div class="container">
    <div class="bandwidth_in">
    <div class="row">
      <div class="col-sm-5 left">
        <h2>{$LANG.homeunlimitedbandwidth}*</h2>
        <p>{$LANG.cpanelovercharge}</p>
      </div>
      <div class="col-sm-7 left">
        <img src="{$WEB_ROOT}/templates/{$template}/images/img01.png" class="img-responsive" alt="optimize player"> 
      </div>
    </div>
  </div>
  </div>
</div>
{/if}