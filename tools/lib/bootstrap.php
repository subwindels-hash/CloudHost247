<?php
/**
 * Public tools engine bootstrap. No WHMCS constant required.
 * Credentials are read from the environment only and are never returned.
 */
namespace CloudHost247\Tools;

if (!defined('CH247_TOOLS_ROOT')) {
    define('CH247_TOOLS_ROOT', dirname(__DIR__, 2));
}

require_once __DIR__ . '/Catalog.php';
require_once __DIR__ . '/Guard.php';
require_once __DIR__ . '/Net.php';
require_once __DIR__ . '/Engine.php';
require_once __DIR__ . '/View.php';
