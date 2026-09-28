{if $hostx_blocks[$block_slug]}
<div class="custom-block-7">
  <div class="container">
	<div class="sp-offer">
	  <h3>{eval var=$hostx_blocks[$block_slug]->title}</h3>
	  <h2>{eval var=$hostx_blocks[$block_slug]->sub_title}</h2>
	</div>
	{foreach $hostx_blocks[$block_slug]->widgets as $widget}
		{eval var=$widget->widget_description|html_entity_decode}
	{/foreach}
  </div>
</div>
{else}
<div class="custom-block-7">
  <div class="container">
		<div class="sp-offer">
		  <h3>Special Offer</h3>
		  <h2>50% Off</h2>
		</div>
		<div class="cuppon-box">
			<h5><strong>SHARED / RESELLER</strong> - Save 50% on First Term (up to 3 years) with code: <span class="c-code">KH50DEAL</span><br> 
				<strong>SSD VPS / CLOUD VPS</strong> - Save 30% for LIFE with Code: <span class="c-code">KH30DEAL</span><br>
				<strong>DEDICATED</strong> - Check back
			</h5>
		</div>
		<a href="#" class="see-ofr-btn">See Special Offers</a>
  </div>
</div>
{/if}