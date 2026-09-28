{if $hostx_blocks[$block_slug]}
<div class="ssl-effect-site recent-changes-effact">
	<div class="container">
	  <div class="row ssl-effect-site-row">
		<div class="col-sm-7">
		  <h4>{eval var=$hostx_blocks[$block_slug]->title}</h4>
		      {eval var=$hostx_blocks[$block_slug]->description}
		</div>
		{foreach $hostx_blocks[$block_slug]->widgets as $widget}
          {eval var=$widget->widget_description|html_entity_decode}
        {/foreach}
	  </div>
   </div>
</div>
{else}
<div class="ssl-effect-site recent-changes-effact">
	<div class="container">
	  <div class="row ssl-effect-site-row">
		 <div class="col-sm-7">
		  <h4>{$LANG.sslPageEffectSiteH4}</h4>
		  <p>{$LANG.sslPageEffectSiteP}<span>{$LANG.sslPageEffectSitePSpan}</span></p>
		</div>
		<div class="col-sm-5">
		  <div class="http-image-box">
		    <img src="{$WEB_ROOT}/templates/{$template}/images/http-domain-ssl.png" alt="ssl certificate">  
		  </div>
		</div>
	  </div>
   </div>
</div>
{/if}