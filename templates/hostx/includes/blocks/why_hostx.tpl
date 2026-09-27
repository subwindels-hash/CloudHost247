{if $hostx_blocks[$block_slug]}
<div class="why-hostx">
     <div class="container">
        <div class="row">
        	<h2 style="display: none;">{eval var=$hostx_blocks[$block_slug]->title}</h2>
        	<p style="display: none;" >{eval var=$hostx_blocks[$block_slug]->sub_title}</p>
               {eval var=$hostx_blocks[$block_slug]->description}
        </div>
     </div>
  </div>
{/if}