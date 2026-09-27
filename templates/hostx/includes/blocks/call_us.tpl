{if $hostx_blocks[$block_slug]}
<div class="toll-free">
    <div class="container">
      <div class="row">
        {foreach $hostx_blocks[$block_slug]->widgets as $widget}
          {eval var=$widget->widget_description|html_entity_decode}
        {/foreach}
      </div>
    </div>
  </div>
{else}
<div class="toll-free">
    <div class="container">
      <div class="row">
        <div class="col-sm-7">
          <div class="toll-free-col">
            <img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/toll-free.svg" alt="phone icon"> 
            <h6>{$LANG.domaincallus}</h6>
            <h5>+1(929)8002575</h5>
            <span>({$LANG.domaintollfree})</span>
          </div>
        </div> 
        <div class="col-sm-5"> 
          <div class="toll-free-col">
            <img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/chart.svg" alt="chart">  
            <h6>{$LANG.domainchatwith}</h6>
            <h5>{$LANG.domainexperts}</h5>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

