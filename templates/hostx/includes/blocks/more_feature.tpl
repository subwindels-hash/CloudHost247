{if $hostx_blocks[$block_slug]}
<div id="feature" class="hosting_feature">
  <div class="container">
    <h2>{eval var=$hostx_blocks[$block_slug]->title} </h2>
    <p>{eval var=$hostx_blocks[$block_slug]->sub_title}</p>
    <div class="hosting_sections">
      <div class="row">
        {foreach $hostx_blocks[$block_slug]->widgets as $widget}
          {eval var=$widget->widget_description|html_entity_decode}
        {/foreach}      
      </div>
    </div> 
  </div>
</div>
{else}
<div id="feature" class="hosting_feature">
  <div class="container">
    <h2>{$LANG.cpanelmorefeature} </h2>
    <p>{$LANG.cpanelmorefeaturetext}</p>
  <div class="hosting_sections">
    <div class="row">
      <div class="col-sm-4 mt-3">
        <div class="hosting_box"> 
          <span><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon001.svg" alt="www icon"></span>
          <h3>{$LANG.cpanelfreename} </h3>
          <p>{$LANG.cpanelfreenametext}.</p>
        </div>
      </div>
        <div class="col-sm-4 mt-3">
        <div class="hosting_box"> 
          <span><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon002.svg" alt="message icon"></span>
          <h3>{$LANG.cpanelfreepersonalised}</h3>
          <p>{$LANG.cpanelfreepersonalisedtext}.</p>
        </div>
      </div>
      <div class="col-sm-4 mt-3">
        <div class="hosting_box"> 
          <span><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon003.svg" alt="lock"></span>
          <h3>{$LANG.cpanelfreeencreypt} </h3>
          <p>{$LANG.cpanelfreeencreypttext}.</p>
        </div>
      </div>
      <div class="col-sm-4 mt-3">
        <div class="hosting_box"> 
          <span><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon004.svg" alt="svg icon"></span>
          <h3>{$LANG.cpanelfreebackup}</h3>
          <p>{$LANG.cpanelfreebackuptext}.</p>
        </div>
      </div>
      <div class="col-sm-4 mt-3">
        <div class="hosting_box"> 
          <span><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon005.svg" alt="cloud server"></span>
          <h3>{$LANG.cpanelfreemigration}</h3>
          <p>{$LANG.cpanelfreemigrationtext}</p>
        </div>
      </div>
      <div class="col-sm-4 mt-3">
        <div class="hosting_box"> 
          <span><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon006.svg" alt="wordpress logo"></span>
          <h3>{$LANG.cpaneloneclickhosting}</h3>
          <p>{$LANG.cpaneloneclickhostingtext}</p>
        </div>
      </div>
    </div>
  </div> 
  </div>
</div>
{/if}