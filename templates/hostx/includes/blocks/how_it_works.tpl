{if $hostx_blocks[$block_slug]}
<div class="how-it-works-offers">
   <div class="container">
      <div class="row how-it-works-offers-row">
         <div class="col-sm-12">
            <h2>{eval var=$hostx_blocks[$block_slug]->title}</h2>
            <p>{eval var=$hostx_blocks[$block_slug]->sub_title}</p>
               {eval var=$hostx_blocks[$block_slug]->description}
         </div>
      </div>
   </div>
</div>
{/if}