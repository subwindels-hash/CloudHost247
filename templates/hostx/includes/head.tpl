<!-- Styling -->
<link href="{assetPath file='all.min.css'}?v={$versionHash}" rel="stylesheet">
<!-- Bootstrap CSS -->
<link href="{$WEB_ROOT}/templates/{$template}/css/opensans-300-800.css" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/font-awesome/4.7.0/css/font-awesome.min.css">
<link rel="stylesheet" href="{$WEB_ROOT}/templates/{$template}/css/owl.carousel.css"> 
<link rel="stylesheet" href="{$WEB_ROOT}/templates/{$template}/css/ion.rangeSlider.css">
<link rel="stylesheet" href="{$WEB_ROOT}/templates/{$template}/css/bootstrap.min.css">
<link rel="stylesheet" href="{$WEB_ROOT}/templates/{$template}/css/main-style.css">
<link rel="stylesheet" href="{$WEB_ROOT}/templates/{$template}/css/animate.css">
<link href="{$WEB_ROOT}/templates/{$template}/css/hc-offcanvas-nav.css" rel="stylesheet">
<link href="{$WEB_ROOT}/templates/{$template}/flags/flags.css" rel="stylesheet" type="text/css">
<link href="{$WEB_ROOT}/templates/{$template}/css/custom.css" rel="stylesheet">  
<link href="{$WEB_ROOT}/templates/{$template}/css/custom-responsive.css" rel="stylesheet">
<link rel="stylesheet" type="text/css" href="{$WEB_ROOT}/templates/{$template}/css/slick.css">
<!-- Third party module CSS -->
<link rel="stylesheet" type="text/css" href="{$WEB_ROOT}/templates/{$template}/css/thirdpartymodule.css">
{if $layoutStyle neq ''}
	<link href="{$WEB_ROOT}/templates/{$template}/css/{$layoutStyle}/custom-color-scheme.css" rel="stylesheet">
{/if}
<script>
	var rtlHostx = false;
</script>
{if $LANG.locale == 'ar_AR' || $LANG.locale == 'fa_IR' || $LANG.locale == 'he_IL'}
	<link href="{$WEB_ROOT}/templates/{$template}/css/style-rtl.css" rel="stylesheet">
	<script>
		var rtlHostx = true;
	</script>
{/if}
{if $overridesCss}
	<link href="{$WEB_ROOT}/templates/{$template}/css/overrides/override.css" rel="stylesheet">
{/if}
<script>
    var csrfToken = '{$token}',
        markdownGuide = '{lang|addslashes key="markdown.title"}',
        locale = '{if !empty($mdeLocale)}{$mdeLocale}{else}en{/if}',
        saved = '{lang|addslashes key="markdown.saved"}',
        saving = '{lang|addslashes key="markdown.saving"}',
        whmcsBaseUrl = "{\WHMCS\Utility\Environment\WebHelper::getBaseUrl()}",
        requiredText = '{lang|addslashes key="orderForm.required"}',
        recaptchaSiteKey = "{if $captcha}{$captcha->recaptcha->getSiteKey()}{/if}";
</script>
<script src="{assetPath file='scripts.min.js'}?v={$versionHash}"></script>
<script src="{$WEB_ROOT}/templates/{$template}/js/scrollBarWgs.js"></script> 
{if $templatefile == "viewticket" && !$loggedin}
  <meta name="robots" content="noindex" />
{/if}