{*
    CloudHost247 illustration frame.

    `$visual` is the SVG diagram key (always present, always the <img> src so a crawler and the
    fixture tests see a file that exists). `$visual3d` is the optional 3D JPEG key. When it is set
    the browser prefers the raster; when it is not, the SVG diagram is the whole picture.
*}
{if !isset($alt)}{assign var=alt value='CloudHost247 conceptual infrastructure illustration'}{/if}
{if $visual3d}
<picture>
  <source type="image/jpeg" srcset="{$WEB_ROOT}/assets/images/cloudhost247/{$visual3d|escape}.jpg">
  <img src="{$WEB_ROOT}/assets/images/cloudhost247/{$visual|escape}.svg" width="{$width|default:660}" height="{$height|default:520}" alt="{$alt|escape}"{if $eager} fetchpriority="high"{else} loading="lazy"{/if} decoding="async">
</picture>
{else}
<img src="{$WEB_ROOT}/assets/images/cloudhost247/{$visual|escape}.svg" width="{$width|default:660}" height="{$height|default:520}" alt="{$alt|escape}"{if $eager} fetchpriority="high"{else} loading="lazy"{/if} decoding="async">
{/if}
