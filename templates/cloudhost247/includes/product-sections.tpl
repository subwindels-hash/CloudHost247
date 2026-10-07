{*
    One section renderer for every registry-driven page.

    `$ch247Site.page.sections` comes from the same content the application renders
    (scripts/site/generate.mjs), filtered there to the types a server-rendered page can show without
    live data: every card link resolves on the PHP surface, every icon and illustration is a real
    file, and every section has a heading. So this template never has to guess, and an empty section
    can never reach a visitor.

    Section types: features, cards, steps, checks, split, note. `$section.anchor` is set when a
    navigation destination promises a fragment on this page (`deployments.php#environments`); the
    anchor sits on the section the fragment belongs to, so the promise lands where it says.

    MARKUP CONTRACT — only design-system primitives, and nothing else.

    `templates/cloudhost247/includes/site-head.tpl` loads `site.css` and then `design-system.css`,
    and the design system is the layer that wins overlapping `.ch-*` names. A class invented here
    that the design system does not define would therefore be styled by nothing at all, and a class
    redefined here would be silently overridden. Both happened before this file was rewritten, so
    every class below is taken from `shared/site/design-system.css` (grid-3 → grid--3, card boxes →
    ch-card, steps → ch-steps/ch-step, checks → ch-check-list, callout → ch-note, illustration →
    ch-visual) and `tests/website/run.php` fails if a class in this file is not defined there.
*}
{foreach $ch247Site.page.sections as $section}
{assign var=sectionClass value='ch-section'}
{if $section@iteration % 2 == 0}{assign var=sectionClass value="$sectionClass ch-section--soft"}{/if}
{if $section.type == 'split'}
<section class="{$sectionClass}"{if $section.anchor} id="{$section.anchor|escape}"{/if}><div class="ch-wrap ch-split"><div>
{if $section.kicker}<p class="ch-kicker">{$section.kicker|escape}</p>{/if}
<h2>{$section.heading|escape}</h2>
{foreach $section.body as $paragraph}<p>{$paragraph|escape}</p>{/foreach}
{if $section.points}<ul class="ch-points">{foreach $section.points as $point}<li>{$point|escape}</li>{/foreach}</ul>{/if}
{if $section.link}<a class="ch-text-link" href="{$WEB_ROOT}/{$section.link.url|escape}">{$section.link.label|escape} <span aria-hidden="true">→</span></a>{/if}
</div><figure class="ch-visual ch-visual--light"><img src="{$WEB_ROOT}/assets/images/cloudhost247/{$section.visual|escape}.svg" width="660" height="520" loading="lazy" decoding="async" alt="{$section.heading|escape} — conceptual illustration"></figure></div></section>
{elseif $section.type == 'note'}
<section class="{$sectionClass} ch-section--tight"{if $section.anchor} id="{$section.anchor|escape}"{/if}><div class="ch-wrap ch-wrap--prose"><div class="ch-note"><h2>{$section.heading|escape}</h2>{foreach $section.body as $paragraph}<p>{$paragraph|escape}</p>{/foreach}</div></div></section>
{elseif $section.type == 'steps'}
<section class="{$sectionClass}"{if $section.anchor} id="{$section.anchor|escape}"{/if}><div class="ch-wrap">
<div class="ch-section__head"><div>
{if $section.kicker}<p class="ch-kicker">{$section.kicker|escape}</p>{/if}
<h2>{$section.heading|escape}</h2>
{if $section.lede}<p class="ch-lede">{$section.lede|escape}</p>{/if}
</div></div>
<ol class="ch-steps">{foreach $section.items as $item}<li class="ch-step"><span class="ch-step__index" aria-hidden="true">{$item@iteration|string_format:'%02d'}</span><div><h3>{$item.title|escape}</h3>{if $item.body}<p>{$item.body|escape}</p>{/if}{if $item.url}<a class="ch-text-link" href="{$WEB_ROOT}/{$item.url|escape}">{$item.title|escape} <span aria-hidden="true">→</span></a>{/if}</div></li>{/foreach}</ol>
</div></section>
{elseif $section.type == 'checks'}
<section class="{$sectionClass}"{if $section.anchor} id="{$section.anchor|escape}"{/if}><div class="ch-wrap">
{if $section.kicker}<p class="ch-kicker">{$section.kicker|escape}</p>{/if}
<h2>{$section.heading|escape}</h2>
{if $section.lede}<p class="ch-lede">{$section.lede|escape}</p>{/if}
<ul class="ch-check-list">{foreach $section.items as $item}<li><span class="ch-check-list__mark" aria-hidden="true">{if $item.icon}<img src="{$WEB_ROOT}/assets/images/cloudhost247/{$item.icon|escape}" width="14" height="14" alt="" loading="lazy" decoding="async">{else}✓{/if}</span><div><strong>{$item.title|escape}</strong>{if $item.body}<span class="ch-check-list__body">{$item.body|escape}</span>{/if}</div></li>{/foreach}</ul>
</div></section>
{else}
<section class="{$sectionClass}"{if $section.anchor} id="{$section.anchor|escape}"{/if}><div class="ch-wrap">
{if $section.kicker}<p class="ch-kicker">{$section.kicker|escape}</p>{/if}
<h2>{$section.heading|escape}</h2>
{if $section.lede}<p class="ch-lede">{$section.lede|escape}</p>{/if}
<div class="ch-grid ch-grid--3">{foreach $section.items as $item}{if $item.url}<a class="ch-card" href="{$WEB_ROOT}/{$item.url|escape}">{else}<article class="ch-card">{/if}<span class="ch-card__icon" aria-hidden="true">{if $item.icon}<img src="{$WEB_ROOT}/assets/images/cloudhost247/{$item.icon|escape}" width="21" height="21" alt="" loading="lazy" decoding="async">{else}↗{/if}</span><h3>{$item.title|escape}</h3>{if $item.body}<p>{$item.body|escape}</p>{/if}{if $item.url}<span class="ch-card__foot"><span class="ch-card-link">Open <span aria-hidden="true">→</span></span></span>{/if}{if $item.url}</a>{else}</article>{/if}{/foreach}</div>
</div></section>
{/if}
{/foreach}
