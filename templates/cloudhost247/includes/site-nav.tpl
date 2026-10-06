<a class="ch-skip" href="#ch-main">Skip to main content</a>
<header class="ch-header">
{if $cloudhost247.settings.show_announcement == '1' && $cloudhost247.settings.announcement_text}<div class="ch247-announcement">{$cloudhost247.settings.announcement_text|escape}</div>{/if}
  <div class="ch-top"><div class="ch-wrap"><span>Built for your next chapter.</span><div><a href="{$WEB_ROOT}/help-center.php">Support</a><a href="{$WEB_ROOT}/site-search.php">Search</a>{if $languagechangeenabled || (!$loggedin && $currencies)}<button type="button" data-toggle="modal" data-target="#modalChooseLanguage">{$activeLocale.localisedName|default:'Language'|escape}{if $activeCurrency.code} / {$activeCurrency.code|escape}{/if} <span aria-hidden="true">⌄</span></button>{/if}</div></div></div>
  <div class="ch-nav ch-wrap">
    <a class="ch-brand" href="{$WEB_ROOT}/index.php" aria-label="CloudHost247 home"><img src="{if $cloudhost247.settings.logo_url}{$cloudhost247.settings.logo_url|escape}{else}{$WEB_ROOT}/assets/images/cloudhost247/brand/logo-horizontal-dark.svg{/if}" width="204" height="36" alt="CloudHost247"></a>
    <button class="ch-menu-toggle" type="button" aria-expanded="false" aria-controls="ch-navigation">Menu <span aria-hidden="true">☰</span></button>
    <nav id="ch-navigation" aria-label="Main navigation">
      <form class="ch-nav-search" action="{$WEB_ROOT}/site-search.php" method="get" role="search"><label class="ch-sr" for="ch-nav-q">Search</label><input id="ch-nav-q" name="q" type="search" placeholder="Search CloudHost247" maxlength="100"></form>
      <div class="ch-nav-items">
      {foreach $ch247Site.navigation as $menu}
        <details class="ch-nav-item"{if $menu.title == 'Tools'} data-ch-tools-menu data-tools-api="{$ch247Site.platform|escape}" data-tools-root="{$WEB_ROOT|escape}"{/if}><summary>{$menu.title|escape} <span aria-hidden="true">⌄</span></summary>
          <div class="ch-mega{if $menu.title == 'Tools'} ch-mega-tools{/if}"><div class="ch-mega-intro"><span class="ch-kicker">Explore CloudHost247</span><h2>{$menu.title|escape}</h2><p>{$menu.description|escape}</p>{if $menu.title == 'Tools'}<label class="ch-sr" for="ch-tools-filter">Search tools</label><input id="ch-tools-filter" type="search" data-ch-tools-filter placeholder="Search tools" autocomplete="off">{/if}<a href="{$WEB_ROOT}/{if $menu.title == 'Tools'}tools{else}cloudhost247-hosting.php{/if}">{if $menu.title == 'Tools'}View All CloudHost247 Tools{else}View Plans{/if} <span aria-hidden="true">↗</span></a></div>
          {if $menu.title == 'Tools'}{* Server-rendered category floor. `site.js` appends live tools from /api/tools/navigation into this same panel when the catalogue answers; with JavaScript disabled, or if that request fails, the panel still lists every category instead of being empty. *}{foreach $ch247Site.toolCategories as $category}<div class="ch-mega-group"><h3>{$category.label|escape}</h3><ul><li><a href="{$WEB_ROOT}/{$category.url|escape}">{$category.desc|escape}<span aria-hidden="true">↗</span></a></li></ul></div>{/foreach}{/if}{foreach $menu.groups as $group}<div class="ch-mega-group"><h3>{$group.title|escape}</h3><ul>{foreach $group.links as $link}<li><a href="{$WEB_ROOT}/{$link.url|escape}">{$link.label|escape}<span aria-hidden="true">↗</span></a></li>{/foreach}</ul></div>{/foreach}
          </div>
        </details>
      {/foreach}
      </div>
      <div class="ch-account">
      {if $loggedin}<a href="{$WEB_ROOT}/clientarea.php">Dashboard</a><a href="{$WEB_ROOT}/clientarea.php?action=details">Account</a><a href="{$WEB_ROOT}/logout.php">Log Out</a>
      {else}<a href="{$WEB_ROOT}/help-center.php">Support</a><a href="{$WEB_ROOT}/clientarea.php">Login</a><a class="ch-mobile-only" href="{$WEB_ROOT}/register.php">Create Account</a><a href="{$WEB_ROOT}/clientarea.php">Client Area</a><a class="ch-btn ch-btn-small" href="{$WEB_ROOT}/cloudhost247-hosting.php">Get Started <span aria-hidden="true">↗</span></a>{/if}
      </div>
    </nav>
  </div>
</header>
