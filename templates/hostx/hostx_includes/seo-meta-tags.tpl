<meta charset="{$charset}" />
<meta http-equiv="X-UA-Compatible" content="IE=edge">       
{if $seo_data_only && $templatefile neq 'knowledgebase' && $templatefile  neq 'knowledgebasearticle' && $templatefile neq 'announcements' && $templatefile neq 'viewannouncement'}
{if !empty($seo_data_only->meta_title)}
	<title>{$seo_data_only->meta_title}</title>
{else}
	<title>{eval var=$seodata->pagetitle}</title>
{/if}
{if !empty($seo_data_only->meta_desc)}
	<meta name="description" content="{$seo_data_only->meta_desc}">
{/if}
{if !empty($seo_data_only->meta_keyword)}
	<meta name="keywords" content="{$seo_data_only->meta_keyword}">
{/if}
{if $seo_data_only->followindex eq '1'}
	<meta name="robots" content="index,follow" />
{else}
	<meta name="robots" content="noindex" />
{/if}
{if !empty($seo_data_only->og_title)}
	<meta property="og:title" content="{$seo_data_only->og_title}" />
{/if}
{if !empty($seo_data_only->og_desc)}
	<meta property="og:description" content="{$seo_data_only->og_desc}" />
{/if}
{if !empty($seo_data_only->og_image)}
	<meta property="og:image" content="{$systemurlsget}/templates/{$template}/og_images/{$seo_data_only->og_image}" />
{/if}
{if $seo_data_only->colonical_tag eq '1'}
	{if $templatefile eq 'homepage'}
		<link rel="canonical" href="{$systemurl}"/>
	{else if $breadcrumb[2].link}
		<link rel="canonical" href="{$systemurl}{$breadcrumb[2].link|ltrim:'/'}"/>
	{else}
		<link rel="canonical" href="{$systemurl}{$filename}.php"/>
	{/if}
{/if}
{else}
	<title>{if $kbarticle.title}{$kbarticle.title} - {/if}{$pagetitle} - {$companyname}</title>
{/if}
{if empty($hostx_theme_settings.favicon)}
  <link rel="shortcut icon" href="{$WEB_ROOT}/templates/{$template}/images/favicon.ico" type="image/x-icon">
  <link rel="icon" href="{$WEB_ROOT}/templates/{$template}/images/favicon.ico" type="image/x-icon">
{else}
  <link rel="shortcut icon" href="{$hostx_theme_settings.favicon}" type="image/x-icon">
  <link rel="icon" href="{$hostx_theme_settings.favicon}" type="image/x-icon">
{/if}
<meta name="viewport" content="width=device-width, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no">