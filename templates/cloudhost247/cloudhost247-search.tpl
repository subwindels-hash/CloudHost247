<main id="main-content">
    <header class="ch-legal-hero">
        <div class="ch-wrap">
            <p class="ch-kicker">Find your next step</p>
            <h1>Search CloudHost247</h1>
            {include file="cloudhost247/includes/search-form.tpl"}
        </div>
    </header>
    <section class="ch-section">
        <div class="ch-wrap">
            <h2 class="ch-search-heading">{if $chSearchQuery}Results for “{$chSearchQuery|escape}”{else}What are you looking for?{/if}</h2>
            <div class="ch-grid-3">
                {foreach $chSearchResults as $result}
                    <a class="ch-resource-card" href="{$WEB_ROOT}/{$result.url|escape}">
                        <span>{$result.category|escape}</span>
                        <h3>{$result.title|escape}</h3>
                        <p>{$result.summary|escape}</p>
                        <b aria-hidden="true">↗</b>
                    </a>
                {foreachelse}
                    <p>
                        {if $chSearchUnavailable}
                            Page search is temporarily unavailable. Please try again shortly, or use the knowledgebase below.
                        {elseif $chSearchQuery}
                            {if $chSearchTools}No matching pages — the tools below matched your search.{else}No matching pages. Try a different term, or search the knowledgebase below.{/if}
                        {else}
                            Search products, domains, applications, policies and support resources.
                        {/if}
                    </p>
                {/foreach}
            </div>
            {if $chSearchTools}
            <h2>Tools</h2>
            <div class="ch-grid-3">
                {foreach $chSearchTools as $tool}
                    <a class="ch-resource-card" href="{$WEB_ROOT}/{$tool.url|escape}">
                        <span>Tool</span>
                        <h3>{$tool.title|escape}</h3>
                        <p>{$tool.summary|escape}</p>
                        <b aria-hidden="true">↗</b>
                    </a>
                {/foreach}
            </div>
            {/if}
            <div class="ch-notice" style="margin-top:40px">
                <h2>Looking for an answer?</h2>
                <form method="post" action="{routePath('knowledgebase-search')}" class="ch-search">
                    <input type="hidden" name="token" value="{$token|escape}">
                    <label for="ch-kb-query">Search documentation &amp; knowledgebase</label>
                    <div>
                        <input type="search" id="ch-kb-query" name="search" value="{$chSearchQuery|escape}" required maxlength="100">
                        <button type="submit" class="ch-btn ch-btn-dark">Search Knowledgebase</button>
                    </div>
                </form>
                <a href="{$WEB_ROOT}/announcements.php">Read published news and updates</a>
            </div>
        </div>
    </section>
</main>
