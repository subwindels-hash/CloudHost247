{foreach $seodata->page_blocks as $block_slug}
  {assign var="filename" value=$block_layouts.{$block_slug}}
  {include file="./includes/blocks/$filename.tpl"}
{/foreach}
{if $has_no_block}
<div class="has_no_block">
	<img src="{$WEB_ROOT}/templates/{$template}/images/has_no_block.png">
	<p style="font-size:22px;padding-bottom:25px;">It is very easy to assign the blocks to page via our Drag N Drop Blocks Manager.<br /> Click on the <a href="https://whmcsglobalservices.com/members/knowledgebase/93/How-to-Assign-a-Block-to-a-page.html" target="_blank">documentation link </a>to learn how to assign the blocks.</p>
</div>
{/if}