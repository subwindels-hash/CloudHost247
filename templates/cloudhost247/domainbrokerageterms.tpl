{*
 * CloudHost247 independent theme — Domain Brokerage Terms page.
 * Rendered by domain-brokerage-terms.php; data arrives as $brokerageTerms.
 *}
<a class="ch247-skip" href="#main-content">Skip to main content</a>
<main id="main-content">
<section class="ch247-hero"><div class="ch247-hero__inner">
<h1>{$brokerageTerms.hero.title|escape}</h1>
<p>{$brokerageTerms.hero.subtitle|escape}</p>
</div></section>
<section class="ch247-section"><div class="ch247-page">
<p>These terms govern the CloudHost247 Domain Brokerage service, under which CloudHost247 attempts to acquire an already-registered domain on your behalf. By submitting a brokerage request you accept these terms together with the general CloudHost247 Terms of Service.</p>
{foreach $brokerageTerms.sections as $section}
<h2 id="{$section.id|escape:'html'}">{$section.title|escape}</h2>
{if $section.content}<p>{$section.content|escape}</p>{/if}
{/foreach}
{if $brokerageTerms.contact}
<h2 id="contact">{$brokerageTerms.contact.title|escape}</h2>
<p>{$brokerageTerms.contact.content|escape}</p>
<ul>
<li><strong>Email:</strong> <a href="mailto:{$brokerageTerms.contact.email|escape:'html'}">{$brokerageTerms.contact.email|escape}</a></li>
<li><strong>Website:</strong> <a href="https://{$brokerageTerms.contact.website|escape:'html'}" target="_blank" rel="noopener">{$brokerageTerms.contact.website|escape}</a></li>
<li><strong>Support:</strong> Open a ticket through our client <a href="{$WEB_ROOT}/submitticket.php">support portal</a>.</li>
</ul>
{/if}
</div></section>
</main>
