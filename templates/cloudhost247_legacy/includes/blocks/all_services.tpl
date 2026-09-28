{if $hostx_blocks[$block_slug]}
<div class="custom-block-5">
  <div class="container">
	<div class="row">
      {foreach $hostx_blocks[$block_slug]->widgets as $widget}
        {eval var=$widget->widget_description|html_entity_decode}
      {/foreach}
	</div>
  </div>
</div>
{else}
<div class="custom-block-5">
  <div class="container">
	<div class="row">
		
	  <div class="col-md-4">
	  <div class="block-box block-5"> 
	  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blc-5-icon1.png" alt="server icon"></div>
	  <div class="block-box-cont">
		<h3>Server Auction</h3>
		<p>Enter your required specifications, and when the moment is right, snap up your offer!</p>
	  </div>
	  <div class="block-5-btm">
	  <h4><small>Starting at </small>$19.33</h4>
	  <a href="#">Overview</a>
	  </div>
	  </div>
	  </div>

	   <div class="col-md-4">
	  <div class="block-box block-5"> 
	  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blc-5-icon2.png" alt="database"></div>
	  <div class="block-box-cont">
		<h3>Web Hosting</h3>
		<p>We give digital agencies & e-commerce businesses flexibility in how websites are hosted.</p>
	  </div>
	  <div class="block-5-btm">
	  <h4><small>Starting at </small>$19.33</h4>
	  <a href="#">Overview</a>
	  </div>
	  </div>
	  </div>
	   <div class="col-md-4">
	  <div class="block-box block-5"> 
	  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blc-5-icon3.png" alt="dedicated server"></div>
	  <div class="block-box-cont">
		<h3>Dedicated Servers</h3>
		<p>We offer dedicated servers for websites excelling in performance, security, and control.</p>
	  </div>
	  <div class="block-5-btm">
	  <h4><small>Starting at </small>$19.33</h4>
	  <a href="#">Overview</a>
	  </div>
	  </div>
	  </div>
	  <div class="col-md-4">
	  <div class="block-box block-5"> 
	  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blc-5-icon4.png" alt="cloud server icon"></div>
	  <div class="block-box-cont">
		<h3>Cloud</h3>
		<p>With cloud hosting, give your site more flexibility and power than traditional single-server hosting.</p>
	  </div>
	  <div class="block-5-btm">
	  <h4><small>Starting at </small>$19.33</h4>
	  <a href="#">Overview</a>
	  </div>
	  </div>
	  </div>
	  
	   <div class="col-md-4">
	  <div class="block-box block-5"> 
	  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blc-5-icon5.png" alt="server settings"></div>
	  <div class="block-box-cont">
		<h3>Managed Server</h3>
		<p>Manages your server infrastructure to ensure continuous service availability of mission- critical systems.</p>
	  </div>
	  <div class="block-5-btm">
	  <h4><small>Starting at </small>$19.33</h4>
	  <a href="#">Overview</a>
	  </div>
	  </div>
	  </div>
	   <div class="col-md-4">
	  <div class="block-box block-5"> 
	  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blc-5-icon6.png" alt="cloud server"></div>
	  <div class="block-box-cont">
		<h3>Colocation</h3>
		<p>Get a powerful mix of state-of-the-art facilities and global best practices in colocation services.</p>
	  </div>
	  <div class="block-5-btm">
	  <h4><small>Starting at </small>$19.33</h4>
	  <a href="#">Overview</a>
	  </div>
	  </div>
	  </div>
	</div>
  </div>
</div>
{/if}