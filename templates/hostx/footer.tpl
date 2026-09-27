{if $templatefile == 'homepage' || $templatefile == 'clientregister' || $templatefile == 'login'  || $templatefile == 'password-reset-container' || $templatefile == 'logout' || $templatefile == 'email-prompt' || $sidebarHostxRemove == 'true'}
{else}
</div><!-- /.main-content -->
</div><!-- /.main-content -->
<div class="clearfix"></div>
</div>
</div>
</section>
{/if}
<!-- footer -->
{if $hostx_theme_settings.disable_footer_inner_page neq 'on'}
    {if $hostx_theme_settings.footer_layout eq '1'}
        {include file="$template/includes/blocks/footer_block_latest.tpl"}
    {else}
	    {include file="$template/includes/blocks/footer_block.tpl"}
    {/if}
{else if $hostx_theme_settings.disable_footer_inner_page eq 'on'}
	{if $filename != 'clientarea' && $filename != 'submitticket' && $filename != 'affiliates' && $filename != 'supporttickets' && $filename != 'serverstatus' && $filename != 'viewticket' && !$smarty.get.m && $templatefile != 'account-user-management' && $templatefile != 'account-contacts-manage' && $templatefile != 'account-paymentmethods' && $templatefile != 'account-paymentmethods-manage' && $templatefile != 'announcements' && $templatefile != 'knowledgebase' && $templatefile != 'downloads' && $templatefile != 'viewannouncement' && $templatefile != 'knowledgebasecat' && $templatefile != 'knowledgebasearticle' && $templatefile != 'user-password' && $templatefile != 'user-profile' && $templatefile != 'user-switch-account' && $templatefile != 'user-security' && $filename != 'upgrade'}
        {if $hostx_theme_settings.footer_layout eq '1'}
            {include file="$template/includes/blocks/footer_block_latest.tpl"}
        {else}
		    {include file="$template/includes/blocks/footer_block.tpl"}
        {/if}
	{/if}
{/if}
{include file="$template/includes/blocks/copyright.tpl"}
<a id="wgs-toplink" title="Back to top" href="#">&#10148;</a>
<!-- footer end -->
<script src="{$WEB_ROOT}/templates/{$template}/js/slick.js"></script>
<script src="{$WEB_ROOT}/templates/{$template}/js/hc-offcanvas-nav.js"></script>
<script src="{$WEB_ROOT}/templates/{$template}/js/popper.min.js"></script>      
<script src="{$WEB_ROOT}/templates/{$template}/js/wow.min.js"></script>  
<script src="{$WEB_ROOT}/templates/{$template}/js/owl.carousel.js"></script>  
<script src="{$WEB_ROOT}/templates/{$template}/js/ion.rangeSlider.min.js"></script>
<script src="{$WEB_ROOT}/templates/{$template}/js/custom.js"></script>   
<script src="{$WEB_ROOT}/templates/{$template}/js/custom_scripts.js"></script>
{if $overridesJs}
	<script src="{$WEB_ROOT}/templates/{$template}/js/overrides/override.js"></script>
{/if} 
<div id="fullpage-overlay" class="hidden">
    <div class="outer-wrapper">
        <div class="inner-wrapper">
            <img src="{$WEB_ROOT}/assets/img/overlay-spinner.svg" alt="spinnet loader">
            <br>
            <span class="msg"></span>
        </div>
    </div>
</div>
<div class="modal system-modal fade" id="modalAjax" tabindex="-1" role="dialog" aria-hidden="true">
    <div class="modal-dialog">
        <div class="modal-content panel panel-primary">
            <div class="modal-header panel-heading">
                <button type="button" class="close" data-dismiss="modal">
                    <span aria-hidden="true">&times;</span>
                    <span class="sr-only">{$LANG.footerclose}</span>
                </button>
                <h4 class="modal-title">{$LANG.footertitle}</h4>
            </div>
            <div class="modal-body panel-body">
                Loading...
            </div>
            <div class="modal-footer panel-footer">
                <div class="pull-left loader">
                    <i class="fas fa-circle-notch fa-spin"></i> Loading...
                </div>
                <button type="button" class="btn btn-default" data-dismiss="modal">
                    {$LANG.footerclose}
                </button>
                <button type="button" class="btn btn-primary modal-submit">
                    {$LANG.footersubmit}
                </button>
            </div>
        </div>
    </div>
</div> 
{include file="$template/includes/generate-password.tpl"}
{$footeroutput}
{include file="$template/hostx_includes/sticky-header-setting.tpl"}
{include file="$template/hostx_includes/social-sharing.tpl"}
{* {include file="$template/hostx_includes/side-menu-manage-both.tpl"} *}
{include file="$template/hostx_includes/cookie-offers.tpl"}
{include file="$template/hostx_includes/livechatoptions.tpl"}
</body>
</html>
