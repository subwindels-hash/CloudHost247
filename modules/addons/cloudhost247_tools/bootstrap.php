<?php
/**
 * CloudHost247 Tools Platform bootstrap.
 *
 * Wires the module into the shared CloudHost247 foundation so it uses the
 * same versioned-migration infrastructure as the other platform modules.
 */

if (!defined('WHMCS')) { die('Direct access denied'); }

require_once __DIR__ . '/../cloudhost247_core/bootstrap.php';
