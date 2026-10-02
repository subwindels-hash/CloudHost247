<?php
/**
 * First-party bootstrap for the public landing pages.
 *
 * Replaces the retired vendor theme-helper include that the landing pages used
 * to require. It supplies exactly the four variables the pages and the
 * block-loop template consume:
 *   $defaultPData  fallback product copy when a product has no page row
 *   $seodata       object exposing ->page_blocks (ordered block slugs)
 *   $block_layouts map of block slug to block template filename
 *   $has_no_block  true when the page has no blocks assigned
 *
 * All content comes from the independent CloudHost247 theme tables through
 * ThemeRepository, so no vendor code or vendor identifiers are involved.
 */
if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }
require_once __DIR__ . '/../cloudhost247_core/bootstrap.php';
require_once __DIR__ . '/lib/Content/ProductComponents.php';
require_once __DIR__ . '/lib/View/PreviewRenderer.php';
require_once __DIR__ . '/lib/ThemeRepository.php';

use CloudHost247\Theme\ThemeRepository;
use CloudHost247\Foundation\Support\Logger;

$cloudhost247ThemeRepository = new ThemeRepository();
$defaultPData = $cloudhost247ThemeRepository->defaultProductCopy();

$pageNameForLayout = isset($pageName) ? $pageName : basename($_SERVER['PHP_SELF']);
try {
    $cloudhost247PageLayout = $cloudhost247ThemeRepository->pageLayout($pageNameForLayout);
} catch (\Throwable $e) {
    Logger::write('cloudhost247_theme', 'error', 'landing.layout', array('message' => $e->getMessage()));
    $cloudhost247PageLayout = array('page_blocks' => array(), 'block_layouts' => array(), 'has_no_block' => true);
}
$seodata = (object) $cloudhost247PageLayout;
$block_layouts = $cloudhost247PageLayout['block_layouts'];
$has_no_block = $cloudhost247PageLayout['has_no_block'];
