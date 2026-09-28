<!--ssl-effect-site-->
{if $hostx_blocks[$block_slug]}
<div class="ssl-effect-site">
      <div class="container">
        <div class="row ssl-effect-site-row">
          <div class="col-sm-6">
           <img src="{$WEB_ROOT}/templates/{$template}/images/ssl-effect-img.png" alt="ssl certificate">  
          </div>
           <div class="col-sm-6">
            <h4>{eval var=$hostx_blocks[$block_slug]->title}</h4>
            <p>{eval var=$hostx_blocks[$block_slug]->sub_title}</p>
            <ul>
              {foreach $hostx_blocks[$block_slug]->widgets as $widget}
                  {eval var=$widget->widget_description|html_entity_decode}
              {/foreach}
            </ul>
          </div>
        </div>
     </div>
</div>
{else}
<div class="ssl-effect-site">
      <div class="container">
        <div class="row ssl-effect-site-row">
          <div class="col-sm-6">
           <img src="{$WEB_ROOT}/templates/{$template}/images/ssl-effect-img.png" alt="ssl certificate">  
          </div>
           <div class="col-sm-6">
            <h4>{$LANG.sslPageHowSsl}</h4>
            <p>{$LANG.sslPageHowSslP}</p>
            <ul>
              <li>{$LANG.sslPageHowSslLi1}</li>
              <li>{$LANG.sslPageHowSslLi2}</li>
              <li>{$LANG.sslPageHowSslLi3}</li>
              <li>{$LANG.sslPageHowSslLi4}</li>
              <li>{$LANG.sslPageHowSslLi5}</li>
              <li>{$LANG.sslPageHowSslLi6}</li>
              <li>{$LANG.sslPageHowSslLi7}</li>
              <li>{$LANG.sslPageHowSslLi8}</li>
            </ul>
          </div>
        </div>
     </div>
</div>
{/if}
<!--  ssl-effect-site-->