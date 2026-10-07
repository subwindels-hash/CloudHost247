<main id="main-content">
{if $cloudhost247Page.missing}
<section class="ch-section"><div class="ch-wrap ch-empty"><p class="ch-kicker">CloudHost247</p><h1>{if $ch247Site.path == 'notfound.php'}We couldn't find that page.{else}{$cloudhost247Page.title|escape}{/if}</h1><p>{if $ch247Site.path == 'notfound.php'}The address may have changed. Let’s get you back to the right place.{else}Content for this page is not currently published. Browse the available services or contact the team for help.{/if}</p>{include file="cloudhost247/includes/search-form.tpl"}<div class="ch-actions"><a class="ch-btn ch-btn-dark" href="{$WEB_ROOT}/index.php">Back to Home</a><a href="{$WEB_ROOT}/web-hosting.php">Hosting</a><a href="{$WEB_ROOT}/domain.php">Domains</a><a href="{$WEB_ROOT}/help-center.php">Support</a></div></div></section>
{else}
{if $ch247Site.page && $ch247Site.page.category != 'Legal'}{include file="cloudhost247/includes/product-hero.tpl"}
{else}<header class="ch-legal-hero"><div class="ch-wrap"><p class="ch-kicker">CloudHost247 / {$ch247Site.page.category|default:'Resources'|escape}</p><h1>{$cloudhost247Page.title|escape}</h1><p>{$cloudhost247Page.summary|escape}</p></div></header>{/if}
<section class="ch-section"><div class="ch-wrap ch-prose">{$cloudhost247Page.body nofilter}</div></section>
{if $ch247Site.page.features}<section class="ch-section ch-soft"><div class="ch-wrap"><p class="ch-kicker">Designed around your requirements</p><h2>A considered foundation.</h2><div class="ch-grid-3">{foreach $ch247Site.page.features as $feature}<article class="ch-feature"><span class="ch-feature-mark" aria-hidden="true">↗</span><h3>{$feature[0]|escape}</h3><p>{$feature[1]|escape}</p></article>{/foreach}</div></div></section>{/if}
{if $ch247Site.page.uses || $cloudhost247Page.product_component}{include file="cloudhost247/includes/product-plans.tpl"}{/if}
{if $ch247Site.page.uses}<section class="ch-section"><div class="ch-wrap ch-split"><div><p class="ch-kicker">Made for what you do</p><h2>Bring your next<br>project to life.</h2></div><div class="ch-use-cases">{foreach $ch247Site.page.uses as $use}<h3><span aria-hidden="true">↗</span> {$use|escape}</h3>{/foreach}</div></div></section>{/if}
{if $ch247Site.page.uses || $ch247Site.page.faqs}{include file="cloudhost247/includes/product-faq.tpl"}{/if}
{if $ch247Site.page.related}<section class="ch-section"><div class="ch-wrap"><p class="ch-kicker">Connect the pieces</p><h2>Better together.</h2><div class="ch-grid-3">{foreach $ch247Site.page.related as $related}<a class="ch-resource-card" href="{$WEB_ROOT}/{$related|escape}"><h3>{$ch247Site.pages[$related].title|escape}</h3><p>{$ch247Site.pages[$related].summary|escape}</p><b aria-hidden="true">↗</b></a>{/foreach}</div></div></section>{/if}
{if $ch247Site.page.category != 'Legal'}{include file="cloudhost247/includes/site-cta.tpl"}{/if}
{/if}
</main>
