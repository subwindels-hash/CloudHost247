{if $hostx_blocks[$block_slug]}
<div class="features-option2 features-option4">
  <div class="container">
    <div class="top">
      <h2>{eval var=$hostx_blocks[$block_slug]->title}</h2>
      <p>{eval var=$hostx_blocks[$block_slug]->sub_title}</p>
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
<div class="features-option2 features-option4">
  <div class="container">
    <div class="top">
      <h2>{$LANG.homehostsolution4you}</h2>
      <p>{$LANG.homechooseplatform}</p>
    </div>
    <div class="clearfix"></div>
    <div class="row">
      <div class="col-sm-4">
        <div class="features-col active">
          <div class="img-box">
            <img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/new/closed-lock-.svg" alt="lock icon"></div>
            <h3>{$LANG.homehackersecur}</h3>
            <p>{$LANG.homehackersecurtext}. </p>
          <div class="features-option4_border"></div>
        </div>
      </div>
      <div class="col-sm-4">
        <div class="features-col"> 
          <div class="img-box">
            <img src="{$WEB_ROOT}/templates/{$template}/images/new/icon.svg" class="svg" alt="speed-server"></div>
            <h3>{$LANG.homeblazingspeed}</h3>  
            <p>{$LANG.homeblazingspeedtext}.</p>
          <div class="features-option4_border"></div>
        </div>
      </div>
      <div class="col-sm-4">
        <div class="features-col">
          <div class="img-box">
            <img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/new/history-clock-button.svg" alt="clock image"></div>
            <h3>{$LANG.homenightlybackup}</h3>
            <p>{$LANG.homenightlybackuptext}.</p>
          <div class="features-option4_border"></div>
        </div>
      </div>
      <div class="col-sm-4">
        <div class="features-col">
          <div class="img-box">
            <img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/new/worldwide.svg" alt="globe"></div>
            <h3>{$LANG.homeglobalavailty}</h3>
            <p>{$LANG.homeglobalavailtytext}.</p>
          <div class="features-option4_border"></div>
        </div>
      </div>
      <div class="col-sm-4">
        <div class="features-col">
          <div class="img-box">
            <img class="svg raid" src="{$WEB_ROOT}/templates/{$template}/images/new/shield-checked.svg" alt="safe and secure"></div>
            <h3>{$LANG.homereimaginedsetp}</h3>
            <p>{$LANG.homereimaginedsetptext}. </p>
          <div class="features-option4_border"></div>
        </div>
      </div>
      <div class="col-sm-4">
        <div class="features-col">
          <div class="img-box">
            <img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/new/wordpress-logo.svg" alt="wordpress logo"></div>
            <h3>{$LANG.hometunedwordpress}</h3>
            <p>{$LANG.hometunedwordpresstext}.</p>
          <div class="features-option4_border"></div>
        </div>
      </div>
       
       
    </div>  
      
  </div>
</div>
{/if} 
