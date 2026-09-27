<?php
/**
 * CloudHost247 Tools - WHMCS Hooks
 */

use Illuminate\Database\Capsule\Manager as Capsule;

add_hook('ClientAreaPage', 1, function ($vars) {
    // Add custom page variables for CloudHost247_tools module
    if ($vars['filename'] === 'index' && isset($_GET['m']) && $_GET['m'] === 'CloudHost247_tools') {
        // Inject assets
    }
    return $vars;
});

add_hook('ClientAreaHeadOutput', 1, function ($vars) {
    if (isset($_GET['m']) && $_GET['m'] === 'CloudHost247_tools') {
        $assetsUrl = 'modules/addons/CloudHost247_tools/assets/';
        $cssUrl = $assetsUrl . 'css/CloudHost247-tools.css?v=226';
        $jsUrl = $assetsUrl . 'js/CloudHost247-tools.js?v=226';

        return '<link rel="stylesheet" href="' . $cssUrl . '" type="text/css" />
                <script src="' . $jsUrl . '"></script>';
    }
    return '';
});

add_hook('ClientAreaPrimaryNavbar', 1, function ($menu) {
    if (!is_null($menu->getChild('Services'))) {
        $menu->getChild('Services')->addChild(
            'Online Tools',
            [
                'label' => Lang::trans('Online Tools'),
                'uri' => 'index.php?m=CloudHost247_tools',
                'icon' => 'fa-tools',
                'order' => 99,
            ]
        );
    }
});

add_hook('AdminAreaPage', 1, function ($vars) {
    return $vars;
});
