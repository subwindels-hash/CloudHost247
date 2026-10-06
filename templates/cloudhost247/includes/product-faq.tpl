{* Product FAQs.
   Pages that carry their own questions (generated into site.json from shared/site/content) render
   those; the generic set below is the floor for pages that do not, so this block is never empty and
   never invents product-specific claims. *}
<section class="ch-section ch-soft"><div class="ch-wrap ch-split"><div><p class="ch-kicker">Before you get started</p><h2>A few useful answers.</h2><a class="ch-text-link" href="{$WEB_ROOT}/help-center.php">More help →</a></div><div>
{if $ch247Site.page.faqs}
{foreach $ch247Site.page.faqs as $faq}<details class="ch-faq"><summary>{$faq.q|escape}</summary><p>{$faq.a|escape}</p></details>{/foreach}
{else}
<details class="ch-faq"><summary>Where can I see the exact specifications?</summary><p>Open the current plan in the product catalog. Review the published resources, billing cycle and service terms before placing your order. If a detail is not listed, contact the team to confirm it.</p></details>
<details class="ch-faq"><summary>How do I manage my service?</summary><p>Sign in to the Client Area and open your service details. The management actions you see depend on the product, its provider and your account permissions.</p></details>
<details class="ch-faq"><summary>Can I discuss my requirements first?</summary><p>Yes. Contact the team with your application, capacity and location requirements before selecting a service.</p></details>
{/if}
</div></div></section>
