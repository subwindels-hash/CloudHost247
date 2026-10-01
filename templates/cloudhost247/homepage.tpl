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
<section class="ch247-section ch247-platform-features" aria-labelledby="ch247-platform-features-title">
    <div class="ch247-platform-features__inner">
        <div class="ch247-section-heading">
            <p class="ch247-eyebrow">Platform capabilities</p>
            <h2 id="ch247-platform-features-title">CloudHost247 Platform Features</h2>
            <p>Everything needed to operate a professional WHMCS-powered hosting and digital services business from one responsive customer portal.</p>
        </div>
        <div class="ch247-feature-grid">
            <article class="ch247-feature-card">
                <span class="ch247-feature-card__icon" aria-hidden="true">WH</span>
                <h3>WHMCS Integrated</h3>
                <p>CloudHost247 is fully integrated with WHMCS for automated hosting provisioning, client management, billing, invoicing, service management, domain registration, support tickets, and subscription lifecycle management.</p>
            </article>
            <article class="ch247-feature-card">
                <span class="ch247-feature-card__icon" aria-hidden="true">ML</span>
                <h3>Multi-Language Support</h3>
                <p>Support multiple languages across the CloudHost247 customer portal, hosting marketplace, account dashboard, billing pages, knowledge base, notifications, and administrative interfaces.</p>
            </article>
            <article class="ch247-feature-card">
                <span class="ch247-feature-card__icon" aria-hidden="true">RS</span>
                <h3>Fully Responsive</h3>
                <p>The CloudHost247 platform is designed to work seamlessly across desktop computers, tablets, and mobile devices, providing a consistent and professional experience on every screen size.</p>
            </article>
            <article class="ch247-feature-card">
                <span class="ch247-feature-card__icon" aria-hidden="true">WC</span>
                <h3>Standards-Compliant</h3>
                <p>The frontend is built using modern web standards with a focus on clean, maintainable HTML, CSS, JavaScript, accessibility, and browser compatibility.</p>
            </article>
            <article class="ch247-feature-card">
                <span class="ch247-feature-card__icon" aria-hidden="true">CX</span>
                <h3>Highly Customizable</h3>
                <p>CloudHost247 provides a flexible architecture that allows administrators to customize branding, themes, navigation, pages, hosting products, pricing, payment methods, emails, customer dashboards, marketplace content, and platform settings.</p>
            </article>
            <article class="ch247-feature-card">
                <span class="ch247-feature-card__icon" aria-hidden="true">SEO</span>
                <h3>SEO &amp; Performance Optimized</h3>
                <p>Optimize public-facing CloudHost247 pages for search engines and performance through optimized metadata, structured content, responsive images, caching, compression, efficient asset loading, clean URLs, sitemap generation, and performance-focused frontend architecture.</p>
            </article>
            <article class="ch247-feature-card">
                <span class="ch247-feature-card__icon" aria-hidden="true">MM</span>
                <h3>Mega Menu</h3>
                <p>Provide a powerful mega-menu navigation system for organizing hosting, domains, VPS, dedicated servers, cloud services, email hosting, security products, software, marketplace products, support resources, and other CloudHost247 services.</p>
            </article>
            <article class="ch247-feature-card">
                <span class="ch247-feature-card__icon" aria-hidden="true">PC</span>
                <h3>Privacy &amp; Compliance Ready</h3>
                <p>Provide configurable privacy and compliance features including cookie consent, privacy controls, data-management settings, legal pages, user consent records, and configurable data-retention policies to support applicable privacy regulations.</p>
            </article>
            <article class="ch247-feature-card">
                <span class="ch247-feature-card__icon" aria-hidden="true">RTL</span>
                <h3>RTL Support</h3>
                <p>Support right-to-left languages with appropriate RTL layouts across the customer portal, public website, dashboards, forms, navigation, invoices, account pages, and administrative interfaces.</p>
            </article>
        </div>
    </div>
</section>
{foreach $cloudhost247.sections as $section}<section class="ch247-section"><div class="ch247-page"><h2>{$section.title|escape}</h2>{$section.body nofilter}</div></section>{/foreach}
{if $cloudhost247.testimonials}<section class="ch247-section" aria-labelledby="customer-stories"><div class="ch247-page"><h2 id="customer-stories">Customer stories</h2><div class="ch247-grid">{foreach $cloudhost247.testimonials as $item}<blockquote class="ch247-card"><p>{$item.summary|escape}</p><footer>— {$item.title|escape}</footer></blockquote>{/foreach}</div></div></section>{/if}
</main>
