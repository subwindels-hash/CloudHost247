{if $hostx_blocks['copyright']}
<div class="copyright" id="copyRightHostx">
    {eval var=$hostx_blocks['copyright']->description}
</div>
{else}
<div class="copyright" id="copyRightHostx">
    &copy; {$date_year} {$companyname}. {$LANG.footerprivacypolicy}&nbsp;&nbsp;&nbsp;<a href="{$WEB_ROOT}/aboutus.php">{$LANG.aboutPageTitle}</a>
</div> 
{/if}