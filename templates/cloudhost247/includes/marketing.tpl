{* Canonical Node-backed marketing/consent. No legacy Pixel ID is executable here.
   platform_base_path must be the verified same-origin Node mount. Empty = fail closed. *}
<link rel="stylesheet" href="{$WEB_ROOT}/templates/cloudhost247/css/marketing.css?v=20261108">
{if $ch247Site.platform}
<script src="{$WEB_ROOT}/templates/cloudhost247/js/marketing.js?v=20261108" data-marketing-api="{$ch247Site.platform|escape}/api/v1/marketing" defer></script>
<script src="{$WEB_ROOT}/templates/cloudhost247/js/tiktok.js?v=20261108" data-marketing-api="{$ch247Site.platform|escape}/api/v1/marketing" defer></script>
{/if}
