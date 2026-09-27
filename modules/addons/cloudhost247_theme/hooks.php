<?php
if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }
require_once __DIR__ . '/../cloudhost247_core/bootstrap.php';
require_once __DIR__ . '/lib/ThemeRepository.php';

use CloudHost247\Theme\ThemeRepository;
use CloudHost247\Foundation\Support\Logger;

add_hook('ClientAreaPage', 1, function ($vars) {
    try { return array('cloudhost247' => (new ThemeRepository())->clientContext()); }
    catch (\Throwable $e) { Logger::write('cloudhost247_theme', 'error', 'client.context', array('message' => $e->getMessage())); return array('cloudhost247' => array()); }
});

add_hook('ClientAreaHeadOutput', 1, function ($vars) {
    try {
        $settings = (new ThemeRepository())->settings();
        $primary = htmlspecialchars($settings['primary_color'], ENT_QUOTES, 'UTF-8');
        $accent = htmlspecialchars($settings['accent_color'], ENT_QUOTES, 'UTF-8');
        $font = htmlspecialchars($settings['font_family'], ENT_QUOTES, 'UTF-8');
        $width = (int) $settings['layout_width'];
        $meta = '';
        if (!empty($vars['cloudhost247Page']['seo_description'])) $meta .= '<meta name="description" content="' . htmlspecialchars($vars['cloudhost247Page']['seo_description'], ENT_QUOTES, 'UTF-8') . '">';
        return $meta . '<style>:root{--ch247-primary:' . $primary . ';--ch247-accent:' . $accent . ';--ch247-font:' . $font . ';--ch247-width:' . $width . 'px}</style>';
    } catch (\Throwable $e) { return ''; }
});

add_hook('ClientAreaPrimaryNavbar', 30, function ($primaryNavbar) {
    try {
        $items = (new ThemeRepository())->published('navigation');
        $created = array();
        foreach ($items as $item) {
            $options = array('label' => $item['title'], 'uri' => $item['url'] ?: 'cloudhost247-page.php?slug=' . rawurlencode($item['slug']), 'order' => $item['sort_order']);
            if (!empty($item['open_new'])) $options['attributes'] = array('target' => '_blank', 'rel' => 'noopener');
            if (!empty($item['parent_slug']) && isset($created[$item['parent_slug']])) $created[$item['slug']] = $created[$item['parent_slug']]->addChild('ch247-' . $item['slug'], $options);
            else $created[$item['slug']] = $primaryNavbar->addChild('ch247-' . $item['slug'], $options);
        }
    } catch (\Throwable $e) { Logger::write('cloudhost247_theme', 'error', 'navigation.render', array('message' => $e->getMessage())); }
});

add_hook('ClientAreaFooterOutput', 30, function ($vars) {
    try {
        $repository = new ThemeRepository(); $context = $repository->clientContext(); $settings = $context['settings'];
        $brand = htmlspecialchars($settings['brand_name'], ENT_QUOTES, 'UTF-8');
        $text = htmlspecialchars($settings['footer_text'], ENT_QUOTES, 'UTF-8');
        $email = htmlspecialchars($settings['support_email'], ENT_QUOTES, 'UTF-8');
        $logo = htmlspecialchars($settings['logo_url'], ENT_QUOTES, 'UTF-8');
        $extra = '';
        foreach ($context['footer'] as $item) $extra .= '<div><strong>' . htmlspecialchars($item['title'], ENT_QUOTES, 'UTF-8') . '</strong><div>' . $item['body'] . '</div></div>';
        return '<aside class="ch247-footer-extra" aria-label="CloudHost247 information"><div class="ch247-footer-extra__inner"><div>' . ($logo ? '<img src="' . $logo . '" alt="' . $brand . '" style="max-width:180px;max-height:55px">' : '<strong>' . $brand . '</strong>') . '<p>' . $text . '</p></div>' . $extra . ($email ? '<div><a href="mailto:' . $email . '">' . $email . '</a></div>' : '') . '</div></aside>';
    } catch (\Throwable $e) { return ''; }
});
