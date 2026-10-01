{if $cloudhost247.blocks[$block_slug]}
<div class="free-trial">
  <div class="container">
        {eval var=$cloudhost247.blocks[$block_slug]->description}
  </div>
</div>
{else}
<div class="free-trial">
  <div class="container">
      <div class="free-trial-col">
        <img src="{$WEB_ROOT}/templates/{$template}/images/30day.png" alt="free trial">
        <h2>{$LANG.vpsguarantee}.</h2>
        <p>{$LANG.vpsguaranteetext}.</p> 
      </div>
  </div>
</div>
{/if}