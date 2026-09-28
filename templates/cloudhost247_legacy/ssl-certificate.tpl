<!--ssl-banner-->
<div class="cpanel_banner ssl-banner"> 
   {eval var=$seodata->banner}
</div>   
<!--ssl-banner-->

  {foreach $seodata->page_blocks as $block_slug}
      {include file="./includes/blocks/$block_slug.tpl"}
  {/foreach}

