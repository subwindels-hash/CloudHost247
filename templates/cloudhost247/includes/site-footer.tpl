{if !$ch247Builder.footer_html}
<footer class="ch-footer">
 <div class="ch-wrap">
  <div class="ch-footer-top"><a href="{$WEB_ROOT}/index.php"><img src="{$WEB_ROOT}/assets/images/cloudhost247/brand/logo-horizontal-white.svg" width="204" height="36" alt="CloudHost247"></a><p>Professional cloud hosting and digital infrastructure for businesses, developers and organizations worldwide.</p><a class="ch-btn ch-btn-outline" href="{$WEB_ROOT}/contact.php">Let’s talk <span aria-hidden="true">↗</span></a></div>
  <nav class="ch-footer-grid" aria-label="Footer">{foreach $ch247Site.footer as $group}<div><h2>{$group.title|escape}</h2><ul{if $group.title == 'Tools'} data-ch-tools-footer{/if}>{foreach $group.links as $link}<li><a href="{$WEB_ROOT}/{$link.url|escape}">{$link.label|escape}</a></li>{/foreach}</ul></div>{/foreach}</nav>
  <div class="ch-footer-bottom"><p>© {$date_year|escape} CloudHost247 Isc.</p><p>Build. Host. Deploy. Scale.</p><div><a href="{$WEB_ROOT}/privacy-policy.php">Privacy</a><a href="{$WEB_ROOT}/cookie-policy.php">Cookies</a><a href="{$WEB_ROOT}/legal.php">Legal</a></div></div>
 </div>
</footer>
{/if}
