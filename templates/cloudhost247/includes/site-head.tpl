{* Stylesheets, in order.
   `site.css` is the theme's original system; `design-system.css` is generated from
   shared/site/design-system.css and must load AFTER it. Both files style the same
   `ch-*` class names, so load order decides which wins — and the design system is
   the one that has to win, because it is what keeps this site and the CloudHost247
   application on one palette, one type scale and one focus treatment.
   Do not reorder these two lines. *}
<link rel="stylesheet" href="{$WEB_ROOT}/templates/cloudhost247/css/site.css?v=20261006">
<link rel="stylesheet" href="{$WEB_ROOT}/templates/cloudhost247/css/design-system.css?v=20261006">
<link rel="icon" href="{$WEB_ROOT}/assets/images/cloudhost247/favicon/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="{$WEB_ROOT}/assets/images/cloudhost247/brand/icon-mark.svg">
<link rel="apple-touch-icon" sizes="180x180" href="{$WEB_ROOT}/assets/images/cloudhost247/favicon/apple-touch-icon.png">
<link rel="manifest" href="{$WEB_ROOT}/assets/images/cloudhost247/favicon/site.webmanifest">
<meta name="theme-color" content="#0a1620">
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
