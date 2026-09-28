<?php
/**
 * Website Builder client-area hooks.
 *
 * These only ever add to the page. They write the meta tags and stylesheet for
 * a builder page into the theme head, and the runtime script into the footer.
 * No HostX template file is read or modified, and on every page that is not a
 * builder page the hooks return an empty string, so the rest of the site --
 * the cart, checkout, login, registration and the client area -- renders
 * exactly as it did before the module existed.
 */
if (!defined('WHMCS')) { die('Direct access denied'); }

/** Assets are served by the web server straight from the module directory. */
function cloudhost247_builder_asset_base()
{
    return '/modules/addons/cloudhost247_builder/assets';
}

function cloudhost247_builder_escape($value)
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

/**
 * Head output for a builder page.
 *
 * The render result is published by builder-page.php in a global; when it is
 * absent this hook does nothing at all.
 */
add_hook('ClientAreaHeadOutput', 1, function ($vars) {
    if (empty($GLOBALS['ch247_builder_render']) || !is_array($GLOBALS['ch247_builder_render'])) { return ''; }
    $render = $GLOBALS['ch247_builder_render'];
    $meta = isset($render['meta']) && is_array($render['meta']) ? $render['meta'] : array();

    $out = '<link rel="stylesheet" href="' . cloudhost247_builder_asset_base() . '/css/runtime.css" />';

    if (!empty($meta['description'])) {
        $out .= '<meta name="description" content="' . cloudhost247_builder_escape($meta['description']) . '" />';
    }
    if (!empty($meta['robots'])) {
        $out .= '<meta name="robots" content="' . cloudhost247_builder_escape($meta['robots']) . '" />';
    }
    if (!empty($meta['canonical'])) {
        $out .= '<link rel="canonical" href="' . cloudhost247_builder_escape($meta['canonical']) . '" />';
    }
    if (!empty($meta['title'])) {
        $out .= '<meta property="og:title" content="' . cloudhost247_builder_escape($meta['title']) . '" />';
        $out .= '<meta property="og:type" content="website" />';
    }
    if (!empty($meta['description'])) {
        $out .= '<meta property="og:description" content="' . cloudhost247_builder_escape($meta['description']) . '" />';
    }
    if (!empty($meta['og_image'])) {
        $out .= '<meta property="og:image" content="' . cloudhost247_builder_escape($meta['og_image']) . '" />';
    }

    if (!empty($render['css'])) {
        // The compiler only emits values StyleSchema approved; this strips any
        // sequence that could close the element early, as a second line.
        $css = str_ireplace(array('</style', '<script', '<!--', '-->'), '', (string) $render['css']);
        $out .= '<style id="ch247-builder-css">' . $css . '</style>';
    }
    return $out;
});

add_hook('ClientAreaFooterOutput', 1, function ($vars) {
    if (empty($GLOBALS['ch247_builder_render']) || !is_array($GLOBALS['ch247_builder_render'])) { return ''; }
    if (empty($GLOBALS['ch247_builder_render']['found'])) { return ''; }
    return '<script src="' . cloudhost247_builder_asset_base() . '/js/runtime.js" defer></script>';
});
