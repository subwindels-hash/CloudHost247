{if $hostx_blocks[$block_slug]}
<div class="custom-block-1">
  <div class="container">
	<div class="row">
      {foreach $hostx_blocks[$block_slug]->widgets as $widget}
        {eval var=$widget->widget_description|html_entity_decode}
      {/foreach}
	</div>
  </div>
</div>
{else}
<div class="custom-block-1">
  <div class="container">
	<div class="row">
	  <div class="col-md-4">
	  <div class="block-box"> 
	  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blc-icon1.svg" alt="ddos icon"></div>
	  <div class="block-box-cont">
		<h3>Security Optimizations & 500 Gbps+ DDoS Protection</h3>
		<p>Our servers and infrastructure are by default protected against denial of service attacks (DDoS). </p>
	  </div>
	  </div>
	  </div>
	   <div class="col-md-4">
	  <div class="block-box"> 
	  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blc-icon2.svg" alt="server backup"></div>
	  <div class="block-box-cont">
		<h3>Free Data Backup</h3>
		<p>Our servers and infrastructure are by default protected against denial of service attacks (DDoS). </p>
	  </div>
	  </div>
	  </div>
	   <div class="col-md-4">
	  <div class="block-box"> 
	  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blc-icon3.svg" alt="ddos icon"></div>
	  <div class="block-box-cont">
		<h3>Web Hosting Choices Suits</h3>
		<p>Our servers and infrastructure are by default protected against denial of service attacks (DDoS). </p>
	  </div>
	  </div>
	  </div>
	</div>
  </div>
</div>
{/if}