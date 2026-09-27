{if $hostx_blocks[$block_slug]}
<div class="simple-steps">
    <h2>{eval var=$hostx_blocks[$block_slug]->title}</h2>
    <div class="container">
      <div class="row">
         {foreach $hostx_blocks[$block_slug]->widgets as $widget}
             {eval var=$widget->widget_description|html_entity_decode}
          {/foreach}
      </div>
    </div>
</div>
{else}

<div class="simple-steps">
    <h2>{$LANG.domainsimplesteps}</h2>
    <div class="container">
      <div class="row">
        <div class="col-sm-4">
          <div class="simple-col">
            <img src="{$WEB_ROOT}/templates/{$template}/images/icon-01.png" alt="www icon">  
            <h3>{$LANG.domainchoosename}</h3>
            <p>{$LANG.domainchoosenametext}</p>
          </div>
        </div>
        <div class="col-sm-4">
          <div class="simple-col">
            <img src="{$WEB_ROOT}/templates/{$template}/images/icon-02.png" alt="notepad pen">  
            <h3>{$LANG.domainselecthostplan}</h3>
            <p>{$LANG.domainselecthostplantext}</p>
          </div>
        </div>
        <div class="col-sm-4">
          <div class="simple-col">
            <img src="{$WEB_ROOT}/templates/{$template}/images/icon-03.png" alt="settings icon">   
            <h3>{$LANG.domainsetupwebsite}</h3> 
            <p>{$LANG.domainsetupwebsitetext}</p>
          </div>
        </div>
      </div>
    </div>
</div>

{/if}