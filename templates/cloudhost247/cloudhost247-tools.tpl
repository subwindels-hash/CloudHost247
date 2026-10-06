<main id="ch-tools-content">
{if $chToolsReady}
    <link rel="stylesheet" href="{$WEB_ROOT}/assets/cloudhost247-tools/tools.css">
    <div id="ch247-tools-root" data-web-root="{$chToolsBase|escape}" data-api-base="{$chToolsPlatform|escape}" data-platform="{$chToolsPlatform|escape}">
        <div class="ch-wrap ch-section"><h1>{$cloudhost247ToolsPage.name|escape}</h1><p>{$cloudhost247ToolsPage.summary|escape}</p><p role="status">Loading CloudHost247 Tools…</p><noscript>Interactive tools require JavaScript. No lookup is performed until you submit a check.</noscript></div>
    </div>
    <script type="module" src="{$WEB_ROOT}/assets/cloudhost247-tools/tools.js"></script>
{else}
    <div class="ch-wrap ch-section"><h1>{if $cloudhost247ToolsPage}Tools temporarily unavailable{else}Tool not found{/if}</h1><p>{if $cloudhost247ToolsPage}The tools interface is not available on this installation yet. Please try again later or contact support.{else}This tool is not registered. Explore the available tools instead.{/if}</p><a href="{$WEB_ROOT}/tools">All Tools →</a></div>
{/if}
</main>
