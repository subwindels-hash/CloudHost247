<link rel="stylesheet" type="text/css" href="{assetPath file='all.min.css'}?v={$versionHash}" />
{assetExists file="custom.css"}
<link rel="stylesheet" type="text/css" href="{$__assetPath__}?v={$versionHash}" />
{/assetExists}
{assetExists file="font-awesome.css"}
<link rel="stylesheet" type="text/css" href="{$__assetPath__}" />
{/assetExists}
{assetExists file="responsive.css"}
<link rel="stylesheet" type="text/css" href="{$__assetPath__}" />
{/assetExists}
{assetExists file="style-design.css"}
<link rel="stylesheet" type="text/css" href="{$__assetPath__}" />
{/assetExists}
{assetExists file="style-ovh.css"}
<link rel="stylesheet" type="text/css" href="{$__assetPath__}" />
{/assetExists}
<script type="text/javascript" src="{assetPath file='scripts.min.js'}?v={$versionHash}"></script>