<?php
/** Meta Pixel WHMCS bridge: read-only, canonical-console link, no second initializer. */
use CloudHost247\Marketing\Http\AdminController;
use CloudHost247\Marketing\Http\AdminView;
use WHMCS\Database\Capsule;

return array(
'Meta Pixel bridge reads the legacy identifier and links to the canonical console' => function () {
    ch247_marketing_admin();
    CH247MarketingFakeSchema::$created['mod_cloudhost247_theme_settings'] = true;
    Capsule::table('mod_cloudhost247_theme_settings')->insert(array('setting_key' => 'facebook_pixel_code', 'setting_value' => '123456789012345'));
    Capsule::table('mod_cloudhost247_theme_settings')->insert(array('setting_key' => 'platform_base_path', 'setting_value' => '/platform/'));
    $_GET = array('view' => 'meta-pixel');
    $data = (new AdminController())->handle();
    if ($data['view'] !== 'meta-pixel' || $data['metaPixel']['legacyId'] !== '123456789012345') { return false; }
    if ($data['metaPixel']['consoleUrl'] !== '/platform/admin/marketing-integrations/meta-pixel') { return false; }
    ob_start(); (new AdminView())->render($data); $html = ob_get_clean();
    foreach (array('Marketing Integrations', 'Meta Pixel', 'read-only bridge', '123456789012345', '/platform/admin/marketing-integrations/meta-pixel') as $needle) {
        if (strpos($html, $needle) === false) { return false; }
    }
    return strpos($html, 'fbevents.js') === false && strpos($html, 'fbq(') === false && strpos($html, 'access_token') === false;
},
'Meta Pixel bridge fails closed for an unsafe mount and never writes theme settings' => function () {
    ch247_marketing_admin();
    CH247MarketingFakeSchema::$created['mod_cloudhost247_theme_settings'] = true;
    Capsule::table('mod_cloudhost247_theme_settings')->insert(array('setting_key' => 'platform_base_path', 'setting_value' => 'https://evil.example/platform'));
    $before = count(ch247_mkt_rows('mod_cloudhost247_theme_settings'));
    $_GET = array('view' => 'meta-pixel');
    $data = (new AdminController())->handle();
    if ($data['metaPixel']['platform'] !== '' || $data['metaPixel']['consoleUrl'] !== '/admin/marketing-integrations/meta-pixel') { return false; }
    ob_start(); (new AdminView())->render($data); $html = ob_get_clean();
    if (strpos($html, 'evil.example') !== false || strpos($html, 'Tracking fails closed') === false) { return false; }
    return count(ch247_mkt_rows('mod_cloudhost247_theme_settings')) === $before;
},
);
