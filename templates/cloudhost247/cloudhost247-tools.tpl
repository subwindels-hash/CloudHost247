{if $chToolsHtml}
<link rel="stylesheet" href="{$WEB_ROOT}/templates/cloudhost247/css/tools.css?v=20261006">
{$chToolsHtml nofilter}
<script type="module" src="{$WEB_ROOT}/templates/cloudhost247/js/tools.js?v=20261006"></script>
{else}
<main id="ch-tools-content">
    <div class="ch-wrap ch-section"><h1>{if $cloudhost247ToolsPage}{$cloudhost247ToolsPage.name|escape}{else}Tool not found{/if}</h1><p>{if $cloudhost247ToolsPage}This tool route is registered, but the interactive page is not available in this view.{else}This tool is not registered. Explore the available tools instead.{/if}</p><a href="{$WEB_ROOT}/tools">All Tools →</a></div>
</main>
{/if}
