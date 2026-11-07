{* Amazon-style footer directory: back-to-top strip, dense dark link directory, divided
   brand/locale row, darkest legal band. The reference is the anatomy only — CloudHost247's
   own mark, copy and registry-driven links are used throughout. *}
{if !$ch247Builder.footer_html}
<footer class="ch-footer">
 <a class="ch-footer__top" href="#ch247-top">Back to top</a>

 <div class="ch-footer__directory"><div class="ch-wrap">
  <nav class="ch-footer-grid" aria-label="Footer">{foreach $ch247Site.footer as $group}<div class="ch-footer__col"><h2>{$group.title|escape}</h2><ul{if $group.title == 'Tools'} data-ch-tools-footer data-tools-root="{$WEB_ROOT|escape}"{/if}>{foreach $group.links as $link}<li><a href="{$WEB_ROOT}/{$link.url|escape}">{$link.label|escape}</a></li>{/foreach}</ul></div>{/foreach}</nav>
 </div></div>

 <div class="ch-footer__locale"><div class="ch-wrap ch-footer__locale-inner">
  <a class="ch-footer__brand" href="{$WEB_ROOT}/index.php" aria-label="CloudHost247 home"><img src="{$WEB_ROOT}/assets/images/cloudhost247/brand/logo-horizontal-white.svg" width="204" height="36" alt="CloudHost247"></a>
  <div class="ch-footer__pills" aria-label="Current language, currency and region">
   <span class="ch-footer__pill">{$activeLocale.localisedName|default:'English'|escape}</span>
   {if $activeCurrency.code}<span class="ch-footer__pill">{$activeCurrency.code|escape} — {$activeCurrency.code|escape}</span>{/if}
   <span class="ch-footer__pill">Worldwide</span>
  </div>
  <a class="ch-btn ch-btn-outline" href="{$WEB_ROOT}/contact.php">Let’s talk <span aria-hidden="true">↗</span></a>
 </div></div>

 <div class="ch-footer__legal"><div class="ch-wrap">
  <nav class="ch-footer__legal-links" aria-label="Legal">
   <a href="{$WEB_ROOT}/privacy-policy.php">Privacy Notice</a>
   <a href="{$WEB_ROOT}/cookie-policy.php">Cookie Policy</a>
   <a href="{$WEB_ROOT}/legal.php">Conditions of Use</a>
   <a href="{$WEB_ROOT}/acceptable-use-policy.php">Acceptable Use</a>
   <a href="{$WEB_ROOT}/serverstatus.php">Platform Status</a>
   <a href="{$WEB_ROOT}/help-center.php">Help</a>
   <a href="{$WEB_ROOT}/contact.php">Contact</a>
  </nav>
  <p>© {$date_year|escape} CloudHost247 Isc. All rights reserved. Build. Host. Deploy. Scale.</p>
 </div></div>
</footer>
{/if}
