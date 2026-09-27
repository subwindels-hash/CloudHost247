{if $hostx_blocks[$block_slug]}
<div class="custom-block-2">
  <div class="container">
	<div class="row">
      {foreach $hostx_blocks[$block_slug]->widgets as $widget}
        {eval var=$widget->widget_description|html_entity_decode}
      {/foreach}
	</div>
  </div>
</div>
{else}
<div class="custom-block-2">
  <div class="container">
	<div class="row">
	  <div class="col-md-4">
		<div class="b-support-img"><img src="{$WEB_ROOT}/templates/{$template}/images/b-support-img.png" alt="support icon"></div>
	  </div>	   
	   <div class="col-md-8">
		  <div class="block2-cont">
			<h2>Premium Everything - Especially Support</h2>
			<p>An in-house, expert team is available round-the-clock to help resolve your queries to get you started and grow your presence online. We are there when you get stuck-anytime, day or night. We help you create a website fast and easy by resolving all web hosting queries!</p>
			<h3>Need Help? We are here right now</h3>
			<div class="c-support-btn"><a href="#" class="live-btn">contact Support</a> <a href="#" class="button03">Live sales Support</a></div>
		  </div>
		</div>
	</div>
  </div>
</div>
{/if}