{if $hostx_blocks[$block_slug]}
<div class="perfect-domain">
    <h2>{eval var=$hostx_blocks[$block_slug]->title}</h2>
    <p>{eval var=$hostx_blocks[$block_slug]->sub_title}.</p>
       {eval var=$hostx_blocks[$block_slug]->description}
</div>
{else}
<div class="perfect-domain">
    <h2>{$LANG.domainowndomain}</h2>
    <p>{$LANG.domainowndomaintext}.</p>
    <a href="#" class="button03">{$LANG.domainclickstart}</a>
</div>
{/if}