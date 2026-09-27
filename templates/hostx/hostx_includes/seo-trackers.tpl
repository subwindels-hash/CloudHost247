{if !empty($hostx_theme_settings.google_verification_code)}
	<meta name="google-site-verification" content="{$hostx_theme_settings.google_verification_code}" />
{/if}
{if !empty($hostx_theme_settings.yandex_verification_code)}
	<meta name="yandex-verification" content="{$hostx_theme_settings.yandex_verification_code}" />
{/if}
{if !empty($hostx_theme_settings.baidu_pixel_code)}
	<meta name="baidu-site-verification" content="{$hostx_theme_settings.baidu_pixel_code}" />
{/if}
{if !empty($hostx_theme_settings.bing_verification_code)}
	<meta name="msvalidate.01" content="{$hostx_theme_settings.bing_verification_code}" />
{/if}
{if !empty($hostx_theme_settings.google_analytics_code)}
	{literal}
		<!-- Global site tag (gtag.js) - Google Analytics -->
		<script async src="https://www.googletagmanager.com/gtag/js?id={/literal}{$hostx_theme_settings.google_analytics_code}{literal}"></script>
		<script>
		  window.dataLayer = window.dataLayer || [];
		  function gtag(){dataLayer.push(arguments);}
		  gtag('js', new Date());
		  gtag('config', '{/literal}{$hostx_theme_settings.google_analytics_code}{literal}');
		</script>				
	{/literal}
{/if}
{if !empty($hostx_theme_settings.facebook_pixel_code)}
	{literal}
	<!-- Facebook Pixel Code -->
	<script>
	 !function(f,b,e,v,n,t,s)
	 {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
	 n.callMethod.apply(n,arguments):n.queue.push(arguments)};
	 if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
	 n.queue=[];t=b.createElement(e);t.async=!0;
	 t.src=v;s=b.getElementsByTagName(e)[0];
	 s.parentNode.insertBefore(t,s)}(window, document,'script',
	 'https://connect.facebook.net/en_US/fbevents.js');
	 fbq('init', '{/literal}{$hostx_theme_settings.facebook_pixel_code}{literal}');
	 fbq('track', 'PageView');
	</script>
	<noscript><img height="1" width="1" style="display:none"
	 src="https://www.facebook.com/tr?id={/literal}{$hostx_theme_settings.facebook_pixel_code}{literal}&ev=PageView&noscript=1"
	/></noscript>
	<!-- End Facebook Pixel Code -->
	{/literal}
{/if}
{if !empty($hostx_theme_settings.google_tag_manager_code)}
	<!-- Google Tag Manager (noscript) -->
	<noscript><iframe src="https://www.googletagmanager.com/ns.html?id={$hostx_theme_settings.google_tag_manager_code}"
	height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
	<!-- End Google Tag Manager (noscript) -->
{/if}