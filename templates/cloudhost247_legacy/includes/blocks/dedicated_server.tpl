{if $hostx_blocks[$block_slug]}
<div class="dedicated-server">
  <div class="container">
    <div id="owl-demo1">  
      <div class="item">
        <img src="{$WEB_ROOT}/templates/{$template}/images/server-img.png" alt="vps panel">
        <h2>{eval var=$hostx_blocks[$block_slug]->title}</h2>
         <p>{eval var=$hostx_blocks[$block_slug]->sub_title}</p>
        <div class="clearfix"></div>
        {foreach $hostx_blocks[$block_slug]->widgets as $widget}
          <div class="dedicated_box">
            {eval var=$widget->widget_description|html_entity_decode}
          </div>
        {/foreach}
        <div class="packages">{eval var=$hostx_blocks[$block_slug]->description}</div>
      </div>
    </div>
  </div>
</div>
{else}
<div class="dedicated-server">
  <div class="container">
    <div id="owl-demo1">  
      <div class="item">
        <img src="{$WEB_ROOT}/templates/{$template}/images/server-img.png" alt="vps panel">
        <h2>{$LANG.dedicateserver}</h2>
        <p>{$LANG.dedicateservertext}</p>
        <div class="clearfix"></div>
        <div class="dedicated_box">
          <div class="dedicated_box_col">
            <div class="gol"></div>
          </div>
          <div class="dedicated_box_col">
            <h5>{$LANG.dedicateserv}</h5>
            <h6>{$LANG.dedicatedintel}</span></h6>
            <h6>8 GB  <span>{$LANG.dedicatedram}</span></h6>
          </div>
          <div class="dedicated_box_col">
            <h6>2X2 TB <span>{$LANG.dedicatedraid} 0/1</span></h6>
            <h6>1000/1000 <span>{$LANG.dedicatedmbit}</span></h6>
          </div>
          <div class="dedicated_box_col">
            <h6>499 Kr <span>/{$LANG.homemonth}</span></h6>
            <a href="#" class="button02">{$LANG.dedicatedgstart}</a>
          </div>
        </div>
        <div class="packages">{$LANG.dedicatedpackage} <a href="#">{$LANG.dedicatedpackage2}</a></div>
      </div>
	  
      <div class="item">
        <img src="{$WEB_ROOT}/templates/{$template}/images/server-img.png" alt="vps panel">
        <h2>{$LANG.dedicateserver}</h2>
        <p>{$LANG.dedicateservertext}</p>
        <div class="clearfix"></div>
        <div class="dedicated_box">
          <div class="dedicated_box_col">
            <div class="gol"></div>
          </div>
          <div class="dedicated_box_col">
            <h5>{$LANG.dedicateserv}</h5>
            <h6>{$LANG.dedicatedintel}</span></h6>
            <h6>8 GB  <span>{$LANG.dedicatedram}</span></h6>
          </div>
          <div class="dedicated_box_col">
            <h6>2X2 TB <span>{$LANG.dedicatedraid} 0/1</span></h6>
            <h6>1000/1000 <span>{$LANG.dedicatedmbit}</span></h6>
          </div>
          <div class="dedicated_box_col">
            <h6>499 Kr <span>/{$LANG.homemonth}</span></h6>
            <a href="#" class="button02">{$LANG.dedicatedgstart}</a>
          </div>
        </div>
        <div class="packages">{$LANG.dedicatedpackage} <a href="#">{$LANG.dedicatedpackage2}</a></div>
      </div>
	  
    </div>
  </div>
</div>
{/if}