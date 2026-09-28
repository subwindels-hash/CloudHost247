{if $hostx_blocks[$block_slug]}
<div class="why-choose">
  <div class="container">
    <div class="top"> 
      <h2>{eval var=$hostx_blocks[$block_slug]->title}</h2> 
          {eval var=$hostx_blocks[$block_slug]->description}
    </div>
    <div class="clearfix"></div>
    <div class="row">
       {foreach $hostx_blocks[$block_slug]->widgets as $widget}
            {eval var=$widget->widget_description|html_entity_decode}
        {/foreach}
    </div>
  </div>
</div>
{else}
<div class="why-choose">
  <div class="container">
    <div class="top"> 
      <h2>{$LANG.dedicatedwhychoose}</h2> 
      <p>{$LANG.dedicatedwhychoosetext}</p>
    </div>
    <div class="clearfix"></div>
    <div class="row">
      <div class="col-sm-3">
        <div class="choose-col">
          <img src="{$WEB_ROOT}/templates/{$template}/images/choose_icon1.png" class="svg" alt="maze icon">
          <h2>{$LANG.dedicatedsolutions}</h2>
          <p>{$LANG.dedicatedsolutionstext}</p> 
        </div>
      </div>
      <div class="col-sm-3">
        <div class="choose-col">
          <img src="{$WEB_ROOT}/templates/{$template}/images/choose_icon2.png" class="svg" alt="rocket speed icon">
          <h2>{$LANG.dedicatedspeed}</h2>
          <p>{$LANG.dedicatedspeedtext}</p>
        </div>
      </div>
      <div class="col-sm-3">
        <div class="choose-col">
          <img src="{$WEB_ROOT}/templates/{$template}/images/choose_icon3.png" class="svg" alt="user image">
          <h2>{$LANG.dedicatedsupport}</h2>
          <p>{$LANG.dedicatedsupporttext} </p>
        </div>
      </div>
      <div class="col-sm-3">
        <div class="choose-col">
          <img src="{$WEB_ROOT}/templates/{$template}/images/choose_icon4.png" class="svg" alt="gurantee">
          <h2>{$LANG.dedicateduptime}</h2>
          <p>{$LANG.dedicateduptimetext}</p>
        </div>
      </div>
    </div>
  </div>
</div>
{/if}