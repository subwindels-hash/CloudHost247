{if $hostx_blocks[$block_slug]}
<div class="build-sites">
   <div class="container">
   <h2>{eval var=$hostx_blocks[$block_slug]->title}</h2>
   <p>{eval var=$hostx_blocks[$block_slug]->sub_title}</p>      
	   {eval var=$hostx_blocks[$block_slug]->description}
   </div>
</div>
{/if}