{if $hostx_blocks[$block_slug]}
<div class="custom-block-6">
  <div class="container">
	<div class="row">
      {foreach $hostx_blocks[$block_slug]->widgets as $widget}
        {eval var=$widget->widget_description|html_entity_decode}
      {/foreach}
	</div>
  </div>
</div>
{else}
<div class="custom-block-6">
  <div class="container">
	<div class="row">
	  <div class="col-md-4">
		 <div class="vps-plan-box">
		 <div class="vps-top">
		 <h3>VPS SSD</h3>
		 <p>SLA 99.95%<br>
		 Top performance at an affordable price</p>
		 </div>
		 <div class="vps-btm">
		 <p>Annual plan starting at:</p>
		 <h2>$3.35</h2>
		 <p>/month*</p>
		 <a href="#"  class="choose-btn">Choose</a>
		 </div>
		</div>
	  </div>
	   <div class="col-md-4">
		 <div class="vps-plan-box">
		 <div class="vps-top">
		 <h3>VPS SSD</h3>
		 <p>SLA 99.95%<br>
		 Top performance at an affordable price</p>
		 </div>
		 <div class="vps-btm">
		 <p>Annual plan starting at:</p>
		 <h2>$3.35</h2>
		 <p>/month*</p>
		 <a href="#"  class="choose-btn">Choose</a>
		 </div>
		</div>
	  </div>
	   <div class="col-md-4">
		 <div class="vps-plan-box">
		 <div class="vps-top">
		 <h3>VPS SSD</h3>
		 <p>SLA 99.95%<br>
		 Top performance at an affordable price</p>
		 </div>
		 <div class="vps-btm">
		 <p>Annual plan starting at:</p>
		 <h2>$3.35</h2>
		 <p>/month*</p>
		 <a href="#" class="choose-btn">Choose</a>
		 </div>
		</div>
	  </div>
	</div>
  </div>
</div>
{/if}