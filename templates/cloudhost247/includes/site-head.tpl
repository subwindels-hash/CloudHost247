<link rel="stylesheet" href="{$WEB_ROOT}/templates/cloudhost247/css/site.css?v=20261006">
<link rel="icon" href="{$WEB_ROOT}/assets/images/cloudhost247/favicon/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="{$WEB_ROOT}/assets/images/cloudhost247/brand/icon-mark.svg">
<link rel="apple-touch-icon" sizes="180x180" href="{$WEB_ROOT}/assets/images/cloudhost247/favicon/apple-touch-icon.png">
<link rel="manifest" href="{$WEB_ROOT}/assets/images/cloudhost247/favicon/site.webmanifest">
<meta name="theme-color" content="#101e2c">
{if !$ch247Builder}
<meta name="description" content="{$ch247Site.description|escape}">
{if $ch247Site.canonical}<link rel="canonical" href="{$ch247Site.canonical|escape}">{/if}
<meta property="og:title" content="{$pagetitle|escape} | CloudHost247">
<meta property="og:description" content="{$ch247Site.description|escape}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CloudHost247">
<meta property="og:image" content="{$ch247Site.social|escape}">
{if $ch247Site.canonical}<meta property="og:url" content="{$ch247Site.canonical|escape}">{/if}
{if $ch247Site.schema_json}<script type="application/ld+json">{$ch247Site.schema_json nofilter}</script>{/if}
<meta name="twitter:card" content="summary_large_image">
{if !$ch247Site.public || $cloudhost247Page.missing || $ch247Site.path == 'site-search.php' || $ch247Site.path == 'service-error.php'}<meta name="robots" content="noindex,follow">{/if}
{/if}
<script src="{$WEB_ROOT}/templates/cloudhost247/js/site.js?v=20261006" defer></script>
