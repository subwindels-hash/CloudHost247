{if $cloudhost247.blocks[$block_slug]}
<div class="why-cloudhost247">
     <div class="container">
        <div class="row">
		<h2 style="display: none;">{eval var=$cloudhost247.blocks[$block_slug]->title}</h2>
		<p style="display: none;" >{eval var=$cloudhost247.blocks[$block_slug]->sub_title}</p>
               {eval var=$cloudhost247.blocks[$block_slug]->description}
        </div>
     </div>
  </div>
{/if}