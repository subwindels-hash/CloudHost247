{*
    CloudHost247 illustration frame.

    `$visual` is the SVG diagram key (always present, always the <img> src so a crawler and the
    fixture tests see a file that exists). `$visual3d` is the optional 3D scene key. When it is set
    the browser picks the smallest of the AVIF / WebP / JPEG encodings — a 640w AVIF of the
    homepage scene is 12 KB against the 72 KB JPEG, and a phone never has to fetch the 1280w
    master to paint a 390px column. A browser that understands none of it still gets the SVG.

    The three widths are literal because the files are: `scripts/generate-raster-formats.py`
    writes `-640`, `-960` and `-1280` for every scene and fails the build if one is missing.
    Change the ladder there and here together.
*}
{if !isset($alt)}{assign var=alt value='CloudHost247 conceptual infrastructure illustration'}{/if}
{if !isset($sizes)}{assign var=sizes value='(max-width: 900px) 100vw, 660px'}{/if}
{if $visual3d}
<picture>
  <source type="image/avif" sizes="{$sizes|escape}" srcset="{$WEB_ROOT}/assets/images/cloudhost247/{$visual3d|escape}-640.avif 640w, {$WEB_ROOT}/assets/images/cloudhost247/{$visual3d|escape}-960.avif 960w, {$WEB_ROOT}/assets/images/cloudhost247/{$visual3d|escape}-1280.avif 1280w">
  <source type="image/webp" sizes="{$sizes|escape}" srcset="{$WEB_ROOT}/assets/images/cloudhost247/{$visual3d|escape}-640.webp 640w, {$WEB_ROOT}/assets/images/cloudhost247/{$visual3d|escape}-960.webp 960w, {$WEB_ROOT}/assets/images/cloudhost247/{$visual3d|escape}-1280.webp 1280w">
  <source type="image/jpeg" srcset="{$WEB_ROOT}/assets/images/cloudhost247/{$visual3d|escape}.jpg">
  <img src="{$WEB_ROOT}/assets/images/cloudhost247/{$visual|escape}.svg" width="{$width|default:660}" height="{$height|default:520}" alt="{$alt|escape}"{if $eager} fetchpriority="high"{else} loading="lazy"{/if} decoding="async">
</picture>
{else}
<img src="{$WEB_ROOT}/assets/images/cloudhost247/{$visual|escape}.svg" width="{$width|default:660}" height="{$height|default:520}" alt="{$alt|escape}"{if $eager} fetchpriority="high"{else} loading="lazy"{/if} decoding="async">
{/if}
