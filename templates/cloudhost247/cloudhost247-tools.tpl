{if $chToolsHtml}
<link rel="stylesheet" href="{$WEB_ROOT}/templates/cloudhost247/css/tools.css?v=20261006">
{$chToolsHtml nofilter}
<script type="module" src="{$WEB_ROOT}/templates/cloudhost247/js/tools.js?v=20261006"></script>
{else}
<main id="ch-tools-content">
    <div class="ch-wrap ch-section"><h1>{if $cloudhost247ToolsPage}{$cloudhost247ToolsPage.name|escape}{else}Tool not found{/if}</h1>
    {if $cloudhost247ToolsPage && $cloudhost247ToolsPage.unserved}
    <p>{$cloudhost247ToolsPage.summary|escape}</p>
    <p>This tool runs in the CloudHost247 platform application. The page you are on is a signpost, so it is not indexed and it does not pretend to be the working tool.</p>
    {if $ch247Site.platform && $chToolsPlatformUrl}<a class="ch-btn" href="{$WEB_ROOT}{$ch247Site.platform|escape}{$chToolsPlatformUrl|escape}">Open the tool in the platform <span aria-hidden="true">↗</span></a>{else}<p>Sign in to your CloudHost247 account to open the connected platform.</p>{/if}
    {else}
    <p>{if $cloudhost247ToolsPage}This tool route is registered, but the interactive page is not available in this view.{else}This tool is not registered. Explore the available tools instead.{/if}</p>
    {/if}
    <p><a class="ch-text-link" href="{$WEB_ROOT}/tools">All Tools <span aria-hidden="true">→</span></a></p></div>
</main>
{/if}
