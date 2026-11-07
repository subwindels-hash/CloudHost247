{*
    CloudHost247 illustration frame — authentic infrastructure photography first.

    `$visual` is the SVG diagram key (always the <img> src, so crawlers, fixtures and the raster
    ladder tests still see a file that exists). `$visual3d` is the legacy 3D scene key. Both are
    still emitted: the photography is a *presentation upgrade*, not a replacement of the asset
    contract, so no published page loses its declared artwork.

    `photo-map.tpl` is generated from shared/site/photography.json and assigns $photoId / $photoAlt
    for the scene. Real, licensed data-centre photography is offered first in AVIF / WebP / JPEG;
    the original 3D ladder stays underneath as a second fallback, and the SVG <img> remains the
    last resort. A browser with no modern codec still renders the diagram, never a blank box.

    Widths are literal (640/960/1280) because scripts/generate-raster-formats.py writes exactly
    that ladder for every JPEG in the library, photography included. Change both together.
*}
{* `scope=parent` is required: a normal {include} has its own variable scope, so $photoId /
   $photoAlt assigned in the generated lookup would not be visible in this template. *}
{include file="cloudhost247/includes/photo-map.tpl" scope=parent}
{if !isset($alt)}{assign var=alt value='CloudHost247 conceptual infrastructure illustration'}{/if}
{if !isset($sizes)}{assign var=sizes value='(max-width: 900px) 100vw, 660px'}{/if}
{if $visual3d}
<picture>
  {if $photoId}
  <source type="image/avif" sizes="{$sizes|escape}" srcset="{$WEB_ROOT}/assets/images/cloudhost247/photography/{$photoId}-640.avif 640w, {$WEB_ROOT}/assets/images/cloudhost247/photography/{$photoId}-960.avif 960w, {$WEB_ROOT}/assets/images/cloudhost247/photography/{$photoId}-1280.avif 1280w">
  <source type="image/webp" sizes="{$sizes|escape}" srcset="{$WEB_ROOT}/assets/images/cloudhost247/photography/{$photoId}-640.webp 640w, {$WEB_ROOT}/assets/images/cloudhost247/photography/{$photoId}-960.webp 960w, {$WEB_ROOT}/assets/images/cloudhost247/photography/{$photoId}-1280.webp 1280w">
  <source type="image/jpeg" srcset="{$WEB_ROOT}/assets/images/cloudhost247/photography/{$photoId}.jpg">
  {/if}
  <source type="image/avif" sizes="{$sizes|escape}" srcset="{$WEB_ROOT}/assets/images/cloudhost247/{$visual3d|escape}-640.avif 640w, {$WEB_ROOT}/assets/images/cloudhost247/{$visual3d|escape}-960.avif 960w, {$WEB_ROOT}/assets/images/cloudhost247/{$visual3d|escape}-1280.avif 1280w">
  <source type="image/webp" sizes="{$sizes|escape}" srcset="{$WEB_ROOT}/assets/images/cloudhost247/{$visual3d|escape}-640.webp 640w, {$WEB_ROOT}/assets/images/cloudhost247/{$visual3d|escape}-960.webp 960w, {$WEB_ROOT}/assets/images/cloudhost247/{$visual3d|escape}-1280.webp 1280w">
  <source type="image/jpeg" srcset="{$WEB_ROOT}/assets/images/cloudhost247/{$visual3d|escape}.jpg">
  <img src="{$WEB_ROOT}/assets/images/cloudhost247/{$visual|escape}.svg" width="{$width|default:660}" height="{$height|default:520}" alt="{if $alt && $photoAlt}{$photoAlt|escape}{else}{$alt|escape}{/if}"{if $eager} fetchpriority="high"{else} loading="lazy"{/if} decoding="async">
</picture>
{else}
<img src="{$WEB_ROOT}/assets/images/cloudhost247/{$visual|escape}.svg" width="{$width|default:660}" height="{$height|default:520}" alt="{$alt|escape}"{if $eager} fetchpriority="high"{else} loading="lazy"{/if} decoding="async">
{/if}
