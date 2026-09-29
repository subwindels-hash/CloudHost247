<?php
/**
 * CloudHost247 Marketing — WHMCS hooks.
 *
 * Adds the Admin → Marketing top-level menu (spec #3). WHMCS loads this file
 * only while the addon is active; everything is defensive so a hook can never
 * break the admin area.
 */
if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }

add_hook('AdminAreaMainMenu', 1, function ($menuManager) {
    try {
        if (!is_object($menuManager) || !method_exists($menuManager, 'addChild')) { return; }
        if (isset($_SESSION['adminid']) === false || !(int) $_SESSION['adminid']) { return; }

        $base = 'addonmodules.php?module=cloudhost247_marketing';
        $root = $menuManager->getChild('Marketing');
        if (!$root) {
            $root = $menuManager->addChild('Marketing', array(
                'label' => 'Marketing',
                'icon' => 'far fa-envelope',
                'order' => 85,
            ));
        }
        if (!$root) { return; }

        $items = array(
            'email-campaigns' => array('label' => 'Email Campaigns', 'uri' => $base),
            'create-campaign' => array('label' => 'Create Campaign', 'uri' => $base . '&view=campaigns&action=create'),
            'subscribers' => array('label' => 'Subscribers', 'uri' => $base . '&view=subscribers'),
            'lists' => array('label' => 'Lists', 'uri' => $base . '&view=lists'),
            'segments' => array('label' => 'Segments', 'uri' => $base . '&view=segments'),
            'templates' => array('label' => 'Templates', 'uri' => $base . '&view=templates'),
            'automations' => array('label' => 'Automations', 'uri' => $base . '&view=automations'),
            'analytics' => array('label' => 'Analytics', 'uri' => $base . '&view=analytics'),
            'delivery-settings' => array('label' => 'Delivery Settings', 'uri' => $base . '&view=settings'),
            'suppression-list' => array('label' => 'Suppression List', 'uri' => $base . '&view=suppressions'),
        );
        foreach ($items as $key => $item) {
            if (!$root->getChild($key)) {
                $root->addChild($key, array('label' => $item['label'], 'uri' => $item['uri']));
            }
        }
    } catch (\Throwable $error) {
        // Navigation is cosmetic; never surface a hook failure in the admin UI.
    }
});
