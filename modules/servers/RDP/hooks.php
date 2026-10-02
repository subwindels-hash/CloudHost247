<?php

use WHMCS\Database\Capsule;

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}
add_hook('AdminProductConfigFieldsSave', 1, function ($vars) {

    try {
        if (!isset($vars['pid'])) {
            return;
        }
        // Fetch configoption1 from tblproducts
        $result = Capsule::table('tblproducts')
            ->where('id', $vars['pid'])
            ->where('servertype', 'RDP')
            ->value('configoption1');

        if ($result) {
            $quantity = explode('|', $result);

            if (isset($quantity[1])) { // Ensure index 1 exists
                Capsule::table('tblproducts')
                    ->where('id', $vars['pid'])
                    ->where('servertype', 'RDP')
                    ->update(['qty' => $quantity[1]]);
            }
        }
    } catch (Exception $e) {
        logModuleCall(
            'RDPmodule',
            __FUNCTION__,
            $params,
            $e->getMessage(),
            $e->getTraceAsString()
        );
    }
});
