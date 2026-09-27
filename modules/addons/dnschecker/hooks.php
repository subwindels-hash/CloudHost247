<?php

/**
 * WHMCS DNS Checker Addon Module - Hooks
 *
 * This file is included by WHMCS during hook loading.
 * Currently no active hooks are required for core functionality.
 * Add custom hooks here as needed (e.g., client area navigation).
 *
 * @package    WHMCS
 * @author     DNS Checker Module
 * @version    1.0
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

// No required hooks for core DNS checking functionality.
// You may uncomment and customize the example below to add a sidebar menu item.

/*
add_hook('ClientAreaPrimarySidebar', 1, function ($sidebar) {
    if (!is_null($sidebar->getChild('Service Details Actions'))) {
        $sidebar->getChild('Service Details Actions')
            ->addChild('DNS Checker', array(
                'label' => 'DNS Checker',
                'uri' => 'index.php?m=dnschecker',
                'icon' => 'fa-globe',
                'order' => 99,
            ));
    }
});
*/
