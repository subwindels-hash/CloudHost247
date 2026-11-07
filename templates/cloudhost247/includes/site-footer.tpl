{* Professional corporate footer: brand intro, four balanced columns with labelled
   sub-groups, compact legal bar. The reference is a clean corporate directory — no third-party
   marks or copy. Every destination still comes from the registry-driven $ch247Site.footer. *}
{if !$ch247Builder.footer_html}
<footer class="ch-footer">
 <div class="ch-footer__directory"><div class="ch-wrap">
  <div class="ch-footer__intro">
   <a class="ch-footer__brand" href="{$WEB_ROOT}/index.php" aria-label="CloudHost247 home"><img src="{$WEB_ROOT}/assets/images/cloudhost247/brand/cloudhost247-official.webp" width="204" height="36" alt="CloudHost247"></a>
   <p>Professional cloud hosting and digital infrastructure for businesses, developers and organizations worldwide.</p>
   <div class="ch-footer__intro-actions">
    <a href="{$WEB_ROOT}/serverstatus.php">Platform status <span aria-hidden="true">&rarr;</span></a>
    <a class="ch-btn ch-btn-outline" href="{$WEB_ROOT}/contact.php">Let’s talk <span aria-hidden="true">↗</span></a>
   </div>
  </div>
  <nav class="ch-footer-grid" aria-label="Footer"><div class="ch-footer__col"><h2>Products & Domains</h2><div class="ch-footer__subgroup"><h3>Hosting</h3><ul>{foreach $ch247Site.footer[0].links as $link}<li><a href="{$WEB_ROOT}/{$link.url|escape}">{$link.label|escape}</a></li>{/foreach}</ul></div><div class="ch-footer__subgroup"><h3>Domains</h3><ul>{foreach $ch247Site.footer[2].links as $link}<li><a href="{$WEB_ROOT}/{$link.url|escape}">{$link.label|escape}</a></li>{/foreach}</ul></div></div><div class="ch-footer__col"><h2>Cloud & Resources</h2><div class="ch-footer__subgroup"><h3>Infrastructure</h3><ul>{foreach $ch247Site.footer[1].links as $link}<li><a href="{$WEB_ROOT}/{$link.url|escape}">{$link.label|escape}</a></li>{/foreach}</ul></div><div class="ch-footer__subgroup"><h3>Resources</h3><ul>{foreach $ch247Site.footer[5].links as $link}<li><a href="{$WEB_ROOT}/{$link.url|escape}">{$link.label|escape}</a></li>{/foreach}</ul></div></div><div class="ch-footer__col"><h2>Developers & Tools</h2><div class="ch-footer__subgroup"><h3>Developers</h3><ul>{foreach $ch247Site.footer[3].links as $link}<li><a href="{$WEB_ROOT}/{$link.url|escape}">{$link.label|escape}</a></li>{/foreach}</ul></div><div class="ch-footer__subgroup"><h3>Tools</h3><ul data-ch-tools-footer data-tools-root="{$WEB_ROOT|escape}">{foreach $ch247Site.footer[4].links as $link}<li><a href="{$WEB_ROOT}/{$link.url|escape}">{$link.label|escape}</a></li>{/foreach}</ul></div></div><div class="ch-footer__col"><h2>Company & Legal</h2><div class="ch-footer__subgroup"><h3>Company</h3><ul>{foreach $ch247Site.footer[6].links as $link}<li><a href="{$WEB_ROOT}/{$link.url|escape}">{$link.label|escape}</a></li>{/foreach}</ul></div><div class="ch-footer__subgroup"><h3>Legal</h3><ul>{foreach $ch247Site.footer[7].links as $link}<li><a href="{$WEB_ROOT}/{$link.url|escape}">{$link.label|escape}</a></li>{/foreach}</ul></div></div></nav>
 </div></div>

 <div class="ch-footer__bottom"><div class="ch-wrap ch-footer__bottom-inner">
  <p>© {$date_year|escape} CloudHost247 Isc. All rights reserved.</p>
  <div class="ch-footer__locale" aria-label="Current language, currency and region"><span>{$activeLocale.localisedName|default:'English'|escape}</span><span aria-hidden="true">·</span>{if $activeCurrency.code}<span>{$activeCurrency.code|escape}</span><span aria-hidden="true">·</span>{/if}<span>Worldwide</span></div>
  <nav class="ch-footer__legal-links" aria-label="Legal">
   <a href="{$WEB_ROOT}/privacy-policy.php">Privacy Notice</a>
   <a href="{$WEB_ROOT}/cookie-policy.php">Cookie Policy</a>
   <a href="{$WEB_ROOT}/legal.php">Conditions of Use</a>
   <a href="{$WEB_ROOT}/acceptable-use-policy.php">Acceptable Use</a>
   <a href="{$WEB_ROOT}/serverstatus.php">Platform Status</a>
   <a href="{$WEB_ROOT}/help-center.php">Help</a>
   <a href="{$WEB_ROOT}/contact.php">Contact</a>
  </nav>
  <a class="ch-footer__top" href="#ch247-top">Back to top ↑</a>
 </div></div>
</footer>
{/if}
