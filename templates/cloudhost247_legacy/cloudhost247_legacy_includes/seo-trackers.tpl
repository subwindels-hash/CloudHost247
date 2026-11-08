{* LEGACY RETIREMENT: facebook_pixel_code remains stored for explicit admin import only.
   The shared consent-gated Meta owner lives in marketing.tpl. Never restore this direct
   Pixel/noscript initializer: it bypassed consent and duplicated the canonical tracker.
   Other legacy analytics below retain their existing behaviour; this change does not claim
   to make Google/Baidu/GTM consent-compliant. Review those providers separately before rollout. *}
{if isset($cloudhost247.settings.google_analytics_code) && $cloudhost247.settings.google_analytics_code}
<script async src="https://www.googletagmanager.com/gtag/js?id={$cloudhost247.settings.google_analytics_code|escape:'html'}"></script>
{literal}
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '{/literal}{$cloudhost247.settings.google_analytics_code|escape:"javascript"}{literal}');
</script>
{/literal}
{/if}
{if isset($cloudhost247.settings.baidu_analytics_code) && $cloudhost247.settings.baidu_analytics_code}
<script>
var _hmt = _hmt || [];
(function() {
  var hm = document.createElement("script");
  hm.src = "https://hm.baidu.com/hm.js?{$cloudhost247.settings.baidu_analytics_code|escape:'javascript'}";
  var s = document.getElementsByTagName("script")[0];
  s.parentNode.insertBefore(hm, s);
})();
</script>
{/if}
{if isset($cloudhost247.settings.google_tag_manager_code) && $cloudhost247.settings.google_tag_manager_code}
{literal}
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','{/literal}{$cloudhost247.settings.google_tag_manager_code|escape:"javascript"}{literal}');</script>
{/literal}
{/if}
