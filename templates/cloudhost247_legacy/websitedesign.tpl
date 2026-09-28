
<!-- banner2 -->
<div class="banner">
   {eval var=$seodata->banner}
</div>
<!-- banner2 end-->  
   
{foreach $seodata->page_blocks as $block_slug}
      {include file="$template/includes/blocks/$block_slug.tpl"}
{/foreach}