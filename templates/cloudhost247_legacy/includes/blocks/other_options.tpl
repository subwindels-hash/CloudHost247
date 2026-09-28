{if $hostx_blocks[$block_slug]}
<div class="custom-block-4">
  <div class="container">
		<div class="opt-title">
		  <h2>{eval var=$hostx_blocks[$block_slug]->title}</h2>
		  <p>{eval var=$hostx_blocks[$block_slug]->sub_title}</p>
		</div>
		<div class="row">
		  {foreach $hostx_blocks[$block_slug]->widgets as $widget}
			{eval var=$widget->widget_description|html_entity_decode}
		  {/foreach}
		</div>
  </div>
</div>
{else}
 <div class="custom-block-4">
  <div class="container">
	<div class="opt-title">
	  <h2>Other Options?</h2>
	  <p>We cater more managed hosting services that help businesses unleash the full potential of their websites.</p>
	</div>
	<div class="row">

	  <div class="col-md-3">
	  <div class="block-box blck-4"> 
	  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blk-icon1.svg" alt="network icon"></div>
	  <div class="block-box-cont">
		<h3>Reseller Hosting</h3>
		<p>Our servers and infrastructure are by default protected against denial of service attacks (DDoS). </p>
	  </div>
	  </div>
	  </div>

	  <div class="col-md-3">
	  <div class="block-box blck-4"> 
	  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blk-icon2.svg" alt="vps server"></div>
	  <div class="block-box-cont">
		<h3>Managed VPS</h3>
		<p>Our servers and infrastructure are by default protected against denial of service attacks (DDoS). </p>
	  </div>
	  </div>
	  </div>
	  <div class="col-md-3">
	  <div class="block-box blck-4"> 
	  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blk-icon3.svg" alt="cloud settings"></div>
	  <div class="block-box-cont">
		<h3>Cloud VPS</h3>
		<p>Our servers and infrastructure are by default protected against denial of service attacks (DDoS). </p>
	  </div>
	  </div>
	  </div>
	   <div class="col-md-3">
	  <div class="block-box blck-4"> 
	  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blk-icon4.svg" alt="ssl certificate"></div>
	  <div class="block-box-cont">
		<h3>SSL Certificates</h3>
		<p>Our servers and infrastructure are by default protected against denial of service attacks (DDoS). </p>
	  </div>
	  </div>
	  </div>
	</div>
  </div>
</div>
{/if}