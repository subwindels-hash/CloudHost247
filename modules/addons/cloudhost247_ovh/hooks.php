<?php
if(!defined('WHMCS'))die('Direct access denied');require_once __DIR__.'/bootstrap.php';
// Scheduled synchronization is available through the dedicated CLI worker. Mutating provisioning remains event-driven by the WHMCS server module.
