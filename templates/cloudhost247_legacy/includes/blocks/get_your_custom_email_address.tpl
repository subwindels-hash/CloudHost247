{if $hostx_blocks[$block_slug]}
<div class="business-row">
    <div class="container">
      <div class="row">
        <div class="col-sm-6">
          <div class="left">
            <h2>{eval var=$hostx_blocks[$block_slug]->title}.</h2> 
            <p>{eval var=$hostx_blocks[$block_slug]->sub_title}.</p> 
               {eval var=$hostx_blocks[$block_slug]->description}
          </div>
        </div>
      </div>
    </div>
</div>
{else}
<div class="business-row">
    <div class="container">
      <div class="row">
        <div class="col-sm-6">
          <div class="left">
            <h2>{$LANG.domaingetemailaddress}.</h2> 
            <p>{$LANG.domaingetemailtext}.</p> 
            <a href="#" class="button03">{$LANG.domainregister}</a> 
          </div>
        </div>
      </div>
    </div>
</div>
{/if}