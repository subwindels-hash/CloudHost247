{*
    CloudHost247 - Email Hosting landing page.

    Data contract (assigned by email-hosting.php):
      $emailHero            hero copy (editable content)
      $emailProviderContent per-provider summary + feature bullets
      $emailProviders       provider => {label, plans[], has_plans}
      $emailComparison      comparison rows built from real capabilities
      $emailDnsContent      DNS guidance copy
      $emailFaqs            FAQ list
      $emailCurrency        active currency code
      $emailCatalogError    safe error string, if the catalogue failed

    Everything is escaped. Prices, availability and storage only render when the
    underlying WHMCS records verify them.
*}
<link rel="stylesheet" href="{$WEB_ROOT}/templates/{$template}/css/email-hosting.css">

<main id="main-content" class="ch247-email" aria-labelledby="ch247-email-hero-title">

    {* ================================================================ HERO *}
    <section class="ch247-email-hero">
        <div class="container">
            <div class="row ch247-email-hero__inner">
                <div class="col-md-7 ch247-email-hero__copy">
                    <p class="ch247-email-eyebrow">Business email</p>
                    <h1 id="ch247-email-hero-title">{$emailHero.heading|escape}</h1>
                    <p class="ch247-email-hero__lead">{$emailHero.subheading|escape}</p>

                    <div class="ch247-email-hero__actions">
                        <a class="ch247-btn ch247-btn--primary" href="#ch247-email-plans">
                            {$emailHero.primary_cta|escape}
                        </a>
                        <a class="ch247-btn ch247-btn--ghost" href="#ch247-email-compare">
                            {$emailHero.secondary_cta|escape}
                        </a>
                    </div>

                    <p class="ch247-email-hero__note">{$emailHero.disclaimer|escape}</p>
                </div>

                <div class="col-md-5 ch247-email-hero__visual">
                    <img src="{$WEB_ROOT}/assets/images/cloudhost247/hosting/email-hosting.svg" width="660" height="560" alt="Business email connected to domain and hosting infrastructure">
                </div>
            </div>
        </div>
    </section>

    {* =========================================================== PROVIDERS *}
    <section class="ch247-email-section" aria-labelledby="ch247-email-providers-title">
        <div class="container">
            <header class="ch247-email-section__head">
                <h2 id="ch247-email-providers-title">Choose your email platform</h2>
                <p>Review the provider options and plans currently published in the catalog.</p>
            </header>

            <div class="row">
                {foreach $emailProviders as $key => $group}
                    <div class="col-md-4">
                        <article class="ch247-provider-card ch247-provider-card--{$key|escape}">
                            <header>
                                <h3>{$group.label|escape}</h3>
                                <p class="ch247-provider-card__summary">
                                    {if isset($emailProviderContent[$key])}{$emailProviderContent[$key].summary|escape}{/if}
                                </p>
                            </header>

                            {if isset($emailProviderContent[$key])}
                                <ul class="ch247-provider-card__features">
                                    {foreach $emailProviderContent[$key].features as $feature}
                                        <li>{$feature|escape}</li>
                                    {/foreach}
                                </ul>
                            {/if}

                            <footer>
                                {if $group.has_plans}
                                    <p class="ch247-provider-card__count">
                                        {$group.plans|@count|escape} plan{if $group.plans|@count != 1}s{/if} available
                                    </p>
                                    <a class="ch247-btn ch247-btn--ghost ch247-btn--block" href="#ch247-plans-{$key|escape}">
                                        View {$group.label|escape} plans
                                    </a>
                                {else}
                                    <p class="ch247-provider-card__count ch247-muted">
                                        No plans are currently published for this platform.
                                    </p>
                                    <a class="ch247-btn ch247-btn--ghost ch247-btn--block" href="submitticket.php">
                                        Ask us about {$group.label|escape}
                                    </a>
                                {/if}
                            </footer>
                        </article>
                    </div>
                {/foreach}
            </div>
        </div>
    </section>

    {* =============================================================== PLANS *}
    <section id="ch247-email-plans" class="ch247-email-section ch247-email-section--muted"
             aria-labelledby="ch247-email-plans-title">
        <div class="container">
            <header class="ch247-email-section__head">
                <h2 id="ch247-email-plans-title">Email plans and pricing</h2>
                <p>
                    Live pricing from our catalogue{if $emailCurrency} in {$emailCurrency|escape}{/if}.
                    Plans we have not published are not listed.
                </p>
            </header>

            {if $emailCatalogError}
                <div class="alert alert-warning" role="alert">{$emailCatalogError|escape}</div>
            {/if}

            {if $emailPlanCount == 0 && !$emailCatalogError}
                <div class="ch247-email-empty" role="status">
                    <p><strong>No email plans are published yet.</strong></p>
                    <p>
                        Our team is finalising the catalogue. <a href="submitticket.php">Contact us</a> and we will
                        quote the plan you need directly.
                    </p>
                </div>
            {/if}

            {foreach $emailProviders as $key => $group}
                {if $group.has_plans}
                    <div id="ch247-plans-{$key|escape}" class="ch247-plan-group">
                        <h3 class="ch247-plan-group__title">{$group.label|escape}</h3>

                        <div class="row">
                            {foreach $group.plans as $plan}
                                <div class="col-md-4 col-sm-6">
                                    <article class="ch247-plan-card{if $plan.tier == 'standard'} ch247-plan-card--featured{/if}">
                                        {if $plan.tier == 'standard'}
                                            <span class="ch247-plan-card__flag">Standard plan</span>
                                        {/if}

                                        <header>
                                            <p class="ch247-plan-card__tier">{$plan.tier|capitalize|escape}</p>
                                            <h4>{$plan.name|escape}</h4>
                                        </header>

                                        <p class="ch247-plan-card__price">
                                            {if $plan.price_verified}
                                                <strong>{$plan.price|escape}</strong>
                                                <span class="ch247-plan-card__cycle">{$plan.cycle_label|escape}</span>
                                                {if $plan.setup_fee}
                                                    <span class="ch247-plan-card__setup">+ {$plan.setup_fee|escape}</span>
                                                {/if}
                                            {else}
                                                <strong class="ch247-muted">Pricing not published</strong>
                                            {/if}
                                        </p>

                                        {if $plan.description}
                                            <p class="ch247-plan-card__desc">{$plan.description|truncate:160:"…"|escape}</p>
                                        {/if}

                                        <dl class="ch247-plan-card__specs">
                                            <div>
                                                <dt>Provider</dt>
                                                <dd>{$plan.provider_label|escape}</dd>
                                            </div>
                                            <div>
                                                <dt>Storage</dt>
                                                <dd>
                                                    {if $plan.storage_verified}{$plan.storage_gb|escape} GB per mailbox
                                                    {else}<span class="ch247-muted">Not published</span>{/if}
                                                </dd>
                                            </div>
                                            <div>
                                                <dt>Mailboxes</dt>
                                                <dd>{$plan.mailboxes|escape}</dd>
                                            </div>
                                            <div>
                                                <dt>Custom domain</dt>
                                                <dd>Supported</dd>
                                            </div>
                                            <div>
                                                <dt>Availability</dt>
                                                <dd>
                                                    {if $plan.available}
                                                        <span class="ch247-pill ch247-pill--ok">Available</span>
                                                    {else}
                                                        <span class="ch247-pill ch247-pill--off">Not available</span>
                                                    {/if}
                                                </dd>
                                            </div>
                                        </dl>

                                        {if $plan.available}
                                            <a class="ch247-btn ch247-btn--primary ch247-btn--block"
                                               href="{$plan.cart_url|escape}">Get Started</a>
                                        {else}
                                            <a class="ch247-btn ch247-btn--ghost ch247-btn--block"
                                               href="submitticket.php">Enquire about this plan</a>
                                        {/if}
                                    </article>
                                </div>
                            {/foreach}
                        </div>
                    </div>
                {/if}
            {/foreach}
        </div>
    </section>

    {* ========================================================== COMPARISON *}
    <section id="ch247-email-compare" class="ch247-email-section" aria-labelledby="ch247-email-compare-title">
        <div class="container">
            <header class="ch247-email-section__head">
                <h2 id="ch247-email-compare-title">Compare the platforms</h2>
                <p>
                    Only verified capabilities are listed. "Automated" means CloudHost247 performs the action through
                    the provider's API; anything we cannot automate is shown as a manual step.
                </p>
            </header>

            <div class="table-responsive ch247-compare">
                <table class="table">
                    <caption class="sr-only">Comparison of Professional Email, Microsoft 365 and Google Workspace</caption>
                    <thead>
                        <tr>
                            <th scope="col">Capability</th>
                            {foreach $emailComparison as $row}
                                <th scope="col">{$row.label|escape}</th>
                            {/foreach}
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <th scope="row">Plans published</th>
                            {foreach $emailComparison as $row}<td>{$row.plan_count|escape}</td>{/foreach}
                        </tr>
                        <tr>
                            <th scope="row">Storage per mailbox</th>
                            {foreach $emailComparison as $row}<td>{$row.storage_range|escape}</td>{/foreach}
                        </tr>
                        <tr>
                            <th scope="row">Custom domain</th>
                            {foreach $emailComparison as $row}<td>{$row.custom_domain|escape}</td>{/foreach}
                        </tr>
                        <tr>
                            <th scope="row">Login access</th>
                            {foreach $emailComparison as $row}<td>{$row.webmail|escape}</td>{/foreach}
                        </tr>
                        <tr>
                            <th scope="row">Mailbox creation</th>
                            {foreach $emailComparison as $row}<td>{$row.mailbox_api|escape}</td>{/foreach}
                        </tr>
                        <tr>
                            <th scope="row">Password changes</th>
                            {foreach $emailComparison as $row}<td>{$row.password_change|escape}</td>{/foreach}
                        </tr>
                        <tr>
                            <th scope="row">Suspend / reactivate</th>
                            {foreach $emailComparison as $row}<td>{$row.suspend|escape}</td>{/foreach}
                        </tr>
                        <tr>
                            <th scope="row">Subscription &amp; licence management</th>
                            {foreach $emailComparison as $row}<td>{$row.licence|escape}</td>{/foreach}
                        </tr>
                        <tr>
                            <th scope="row">DNS records</th>
                            {foreach $emailComparison as $row}<td>{$row.dns_records|escape}</td>{/foreach}
                        </tr>
                        <tr>
                            <th scope="row">Storage usage reporting</th>
                            {foreach $emailComparison as $row}<td>{$row.usage_reporting|escape}</td>{/foreach}
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </section>

    {* ================================================================= DNS *}
    <section class="ch247-email-section ch247-email-section--muted" aria-labelledby="ch247-email-dns-title">
        <div class="container">
            <div class="row">
                <div class="col-md-5">
                    <header class="ch247-email-section__head ch247-email-section__head--left">
                        <h2 id="ch247-email-dns-title">Domain verification &amp; DNS</h2>
                        <p>{$emailDnsContent.intro|escape}</p>
                    </header>

                    <ol class="ch247-dns-steps">
                        {foreach $emailDnsContent.steps as $step}
                            <li>{$step|escape}</li>
                        {/foreach}
                    </ol>

                    <p class="ch247-muted small">{$emailDnsContent.note|escape}</p>
                </div>

                <div class="col-md-7">
                    <div class="ch247-dns-panel">
                        <h3>What you will be asked to add</h3>
                        <p class="ch247-muted">
                            The exact hostnames, priorities, selectors and tokens are issued by your provider for your
                            domain and appear in your client area after ordering. We never publish placeholder values
                            here, because pasting the wrong ones breaks mail delivery.
                        </p>

                        <ul class="ch247-dns-kinds">
                            <li><span class="ch247-tag">TXT</span> Domain verification token</li>
                            <li><span class="ch247-tag">MX</span> Mail routing, with the provider's priorities</li>
                            <li><span class="ch247-tag">TXT</span> SPF, authorising the provider to send as your domain</li>
                            <li><span class="ch247-tag">CNAME/TXT</span> DKIM signing keys</li>
                            <li><span class="ch247-tag">TXT</span> DMARC policy guidance</li>
                        </ul>

                        <p class="ch247-muted small">
                            Each record in your client area has its own <strong>Copy</strong> button, plus
                            <strong>Copy all</strong> for the whole set.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    </section>

    {* ================================================================ FAQS *}
    <section class="ch247-email-section" aria-labelledby="ch247-email-faq-title">
        <div class="container">
            <header class="ch247-email-section__head">
                <h2 id="ch247-email-faq-title">Frequently asked questions</h2>
            </header>

            <div class="ch247-faq" id="ch247-email-faq">
                {foreach $emailFaqs as $index => $faq}
                    <details class="ch247-faq__item"{if $index == 0} open{/if}>
                        <summary>{$faq.question|escape}</summary>
                        <div class="ch247-faq__answer"><p>{$faq.answer|escape}</p></div>
                    </details>
                {/foreach}
            </div>

            <div class="ch247-email-cta">
                <p>Still deciding which platform fits?</p>
                <a class="ch247-btn ch247-btn--primary" href="submitticket.php">Talk to our email team</a>
            </div>
        </div>
    </section>
</main>
