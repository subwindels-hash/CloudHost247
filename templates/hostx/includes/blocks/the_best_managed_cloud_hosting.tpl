{if $hostx_blocks[$block_slug]}
<div class="get_started">
    <div class="container">
        {eval var=$hostx_blocks[$block_slug]->description}
    </div>
</div>
{else}
<div class="get_started">
    <div class="container">
    <h2>Choose the best managed <b>Cloud Hosting</b> experience for your business!</h2> <a href="#" class="button01 cldhosting">Get started Now</a>
    </div>
</div>
{/if}