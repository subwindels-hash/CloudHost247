<div class="testimonials-1">
  <div class="container">
	{if $cloudhost247.blocks[$block_slug]}
		<h2>{eval var=$cloudhost247.blocks[$block_slug]->title}</h2>
		<h6>{eval var=$cloudhost247.blocks[$block_slug]->sub_title}</h2>
		<div class="carousel slide" data-ride="carousel">
			<div class="wgsTestimonial carousel-inner">
			  {foreach $cloudhost247.blocks[$block_slug]->widgets as $widget}
				{eval var=$widget->widget_description|html_entity_decode}
			  {/foreach}
			</div>
		</div>
	{else}
      <h2>{$LANG.hometestimonials}</h2>
      <h6>{$LANG.hometestimhead}.</h6>
		<div class="carousel slide" data-ride="carousel">
			<div class="wgsTestimonial carousel-inner">
				<div class="carousel-item testimonials_box">
				  <img src="{$WEB_ROOT}/templates/{$template}/images/user05.png" alt="user settings">
				  <h2>{$LANG.hometestimname} <span>www.website.com</span></h2>
				  <p>{$LANG.hometestimtext}.</p>
				</div>
				<div class="carousel-item testimonials_box">
				  <img src="{$WEB_ROOT}/templates/{$template}/images/user05.png" alt="user settings">
				  <h2>{$LANG.hometestimname} <span>www.website.com</span></h2>
				  <p>{$LANG.hometestimtext}.</p>
				</div>			
			</div>
		</div>
	{/if}
    </div>
</div>
