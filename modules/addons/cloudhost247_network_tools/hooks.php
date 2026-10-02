<?php
/**
 * CloudHost247 Network Tools — WHMCS hooks.
 *
 * The hooks are deliberately thin: they register navigation, assets and the
 * contextual shortcuts on the customer's own domain pages. Every permalink
 * points at the single front controller (tools.php), which re-checks identity,
 * ownership and permissions on each request — a hook never grants access.
 *
 * The domain shortcuts are built only from the domain the client is already
 * viewing, so a customer can never be shown another customer's domain.
 */

use CloudHost247\NetworkTools\Core\Controller\ToolController;
use CloudHost247\NetworkTools\Core\Repository\SettingsRepository;

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

add_hook('ClientAreaPrimaryNavbar', 30, function ($primaryNavbar) {
    try {
        $settings = new SettingsRepository();
        if (!$settings->bool('enabled')) {
            return;
        }
        $toolsItem = array(
            'label' => 'Network Tools',
            'uri' => 'tools.php',
            'icon' => 'fa-network-wired',
            'order' => 95,
        );
        if (!is_null($primaryNavbar->getChild('Services'))) {
            $primaryNavbar->getChild('Services')->addChild('Network Tools', $toolsItem);
            return;
        }
        $primaryNavbar->addChild('Network Tools', $toolsItem);
    } catch (\Throwable $unavailable) {
        // Navigation must never take the client area down.
    }
});

add_hook('AdminAreaMainMenu', 30, function ($menuManager) {
    // The control centre is reachable from Addons like any WHMCS addon; this
    // adds it to the main admin navigation as well, next to the other
    // CloudHost247 control centres.
    try {
        if (!is_object($menuManager) || !method_exists($menuManager, 'addChild')) {
            return;
        }
        if (empty($_SESSION['adminid']) || !(int) $_SESSION['adminid']) {
            return;
        }
        $base = 'addonmodules.php?module=cloudhost247_network_tools';
        $root = $menuManager->getChild('Network Tools');
        if (!$root) {
            $root = $menuManager->addChild('Network Tools', array(
                'label' => 'Network Tools',
                'icon' => 'fas fa-network-wired',
                'order' => 88,
            ));
        }
        if (!$root) {
            return;
        }
        $views = array(
            'overview' => 'Overview',
            'tools' => 'Tools',
            'resolvers' => 'Resolvers',
            'providers' => 'Providers',
            'health' => 'Health',
            'analytics' => 'Analytics',
            'abuse' => 'Abuse',
            'settings' => 'Settings',
        );
        foreach ($views as $view => $label) {
            if (!$root->getChild($view)) {
                $root->addChild($view, array('label' => $label, 'uri' => $base . '&ch247view=' . $view));
            }
        }
    } catch (\Throwable $unavailable) {
        // The admin area must never be taken down by a navigation hook.
    }
});

add_hook('ClientAreaHeadOutput', 30, function ($vars) {
    $script = isset($_SERVER['SCRIPT_NAME']) ? basename((string) $_SERVER['SCRIPT_NAME']) : '';
    if ($script !== 'tools.php') {
        return '';
    }
    $version = defined('CH247_NETWORK_TOOLS_VERSION') ? CH247_NETWORK_TOOLS_VERSION : '1';
    // Relative to tools.php, which lives beside modules/ — that resolves
    // correctly in a document-root install and in a sub-directory install.
    // WHMCS's configured SystemURL is preferred when it is available because it
    // is the only value that also works when the customer area is served from a
    // different host or path than the page that was requested.
    $base = 'modules/addons/cloudhost247_network_tools/assets/';
    if (isset($vars['systemurl']) && is_string($vars['systemurl']) && $vars['systemurl'] !== '') {
        $base = rtrim($vars['systemurl'], '/') . '/' . $base;
    }
    $stylesheet = $base . 'css/cloudhost247-tools.css?v=' . rawurlencode($version);
    $script = $base . 'js/cloudhost247-tools.js?v=' . rawurlencode($version);
    return '<link rel="stylesheet" href="' . htmlspecialchars($stylesheet, ENT_QUOTES, 'UTF-8') . '">' . "\n"
        . '<script defer src="' . htmlspecialchars($script, ENT_QUOTES, 'UTF-8') . '"></script>';
});

add_hook('ClientAreaFooterOutput', 30, function ($vars) {
    $script = isset($_SERVER['SCRIPT_NAME']) ? basename((string) $_SERVER['SCRIPT_NAME']) : '';
    if ($script === 'tools.php') {
        return '<script>window.CH247_TOOLS = ' . json_encode(array(
            'baseUrl' => 'tools.php',
            'csrf' => function_exists('generate_token') ? generate_token('plain') : '',
        )) . ';</script>';
    }
    // On every other customer page, remember the current page so a "Report a
    // problem with this result" link can be built later without guessing.
    return '';
});

add_hook('ClientAreaPage', 20, function ($vars) {
    try {
        $settings = new SettingsRepository();
        if (!$settings->bool('enabled')) {
            return $vars;
        }
        $domain = '';
        if (isset($vars['domain']) && is_array($vars['domain']) && !empty($vars['domain']['domainname'])) {
            $domain = (string) $vars['domain']['domainname'];
        } elseif (!empty($vars['domainname'])) {
            $domain = (string) $vars['domainname'];
        }
        $template = isset($vars['templatefile']) ? strtolower((string) $vars['templatefile']) : '';
        $isDomainPage = $domain !== '' && (strpos($template, 'domain') !== false || strpos($template, 'dns') !== false);
        if (!$isDomainPage) {
            $GLOBALS['ch247_nt_domain_context'] = '';
            return $vars;
        }
        $GLOBALS['ch247_nt_domain_context'] = $domain;
        if (!empty($_SESSION['uid'])) {
            $controller = new ToolController();
            $vars['ch247_tools_domain_shortcuts'] = $controller->domainShortcuts($domain);
        }
        return $vars;
    } catch (\Throwable $unavailable) {
        return $vars;
    }
});

add_hook('ClientAreaPrimarySidebar', 30, function ($primarySidebar) {
    try {
        $domain = isset($GLOBALS['ch247_nt_domain_context']) ? (string) $GLOBALS['ch247_nt_domain_context'] : '';
        if ($domain === '' || empty($_SESSION['uid'])) {
            return;
        }
        $settings = new SettingsRepository();
        if (!$settings->bool('enabled')) {
            return;
        }
        $controller = new ToolController();
        $panel = $primarySidebar->addChild('ch247-network-tools', array(
            'label' => 'Network Tools',
            'uri' => 'tools.php?domain=' . rawurlencode($domain),
            'icon' => 'fa-network-wired',
            'order' => 20,
        ));
        foreach ($controller->domainShortcuts($domain) as $shortcut) {
            $panel->addChild('ch247-tool-' . str_replace('/', '-', $shortcut['slug']), array(
                'label' => $shortcut['label'] . ($shortcut['state'] === 'ACTIVE' ? '' : ' (' . $shortcut['state'] . ')'),
                'uri' => $shortcut['url'],
                'order' => 10,
            ));
        }
    } catch (\Throwable $unavailable) {
        // A sidebar must never break a page.
    }
});
