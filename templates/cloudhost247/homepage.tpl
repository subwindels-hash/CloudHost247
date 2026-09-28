<a class="ch247-skip" href="#main-content">Skip to main content</a>
{if $cloudhost247.settings.show_announcement eq '1' && $cloudhost247.settings.announcement_text}
<div class="ch247-announcement" role="status">{$cloudhost247.settings.announcement_text|escape}</div>
{/if}
<main id="main-content">
<section class="ch247-hero"><div class="ch247-hero__inner">
<h1>{$cloudhost247.settings.hero_title|escape}</h1>
<p>{$cloudhost247.settings.hero_text|escape}</p>
<a class="ch247-button" href="{$cloudhost247.settings.hero_cta_url|escape:'html'}">{$cloudhost247.settings.hero_cta_label|escape}</a>
</div></section>
{if $cloudhost247.banners}
<section class="ch247-section" aria-label="Featured services"><div class="ch247-grid">{foreach $cloudhost247.banners as $banner}<article class="ch247-card">{if $banner.image_url}<img src="{$banner.image_url|escape:'html'}" alt="">{/if}<h2>{$banner.title|escape}</h2><p>{$banner.summary|escape}</p>{if $banner.url}<a href="{$banner.url|escape:'html'}">Learn more <span aria-hidden="true">→</span></a>{/if}</article>{/foreach}</div></section>
{/if}
{foreach $cloudhost247.sections as $section}<section class="ch247-section"><div class="ch247-page"><h2>{$section.title|escape}</h2>{$section.body nofilter}</div></section>{/foreach}
{if $cloudhost247.testimonials}<section class="ch247-section" aria-labelledby="customer-stories"><div class="ch247-page"><h2 id="customer-stories">Customer stories</h2><div class="ch247-grid">{foreach $cloudhost247.testimonials as $item}<blockquote class="ch247-card"><p>{$item.summary|escape}</p><footer>— {$item.title|escape}</footer></blockquote>{/foreach}</div></div></section>{/if}
</main>
