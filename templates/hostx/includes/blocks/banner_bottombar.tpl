
{if $hostx_blocks[$block_slug]}
<div class="banner-bottombar">
      <div class="container">
        <div class="row">
          {foreach $hostx_blocks[$block_slug]->widgets as $widget}
                    {eval var=$widget->widget_description|html_entity_decode}
          {/foreach}
        </div>
      </div>
</div>
{else}
<div class="banner-bottombar">
      <div class="container">
        <div class="row">
          <div class="col-sm-4 cols">
            <img src="{$WEB_ROOT}/templates/{$template}/images/24hras.png" alt="24*7 Support"> {$LANG.vpslivesupport}
          </div>
          <div class="col-sm-4 cols">
            <img src="{$WEB_ROOT}/templates/{$template}/images/clock.png" alt="clock image"> {$LANG.vpsuptimeguarantee}
          </div>
          <div class="col-sm-4 cols">
            <img src="{$WEB_ROOT}/templates/{$template}/images/doller.png" alt="dollar icon"> {$LANG.vpsriskfree}
          </div>
        </div>
      </div>
</div>
{/if}