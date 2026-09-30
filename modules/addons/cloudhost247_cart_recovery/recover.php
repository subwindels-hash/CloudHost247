<?php
// Public endpoint intentionally does not require a WHMCS login.
require_once dirname(dirname(dirname(__DIR__))).'/init.php';
require_once __DIR__.'/bootstrap.php';
use CloudHost247\CartRecovery\RecoveryService;
$token=isset($_GET['token'])?(string)$_GET['token']:''; $action=isset($_GET['action'])?(string)$_GET['action']:'';
$ok=$action==='unsubscribe'?RecoveryService::unsubscribe($token):RecoveryService::recover($token);
if($ok){ if($action==='unsubscribe'){ echo '<!doctype html><title>CloudHost247</title><div style="max-width:640px;margin:80px auto;font:16px sans-serif"><h1>You are unsubscribed</h1><p>You will not receive further abandoned-cart reminders.</p></div>'; } else { header('Location: /cart.php?a=view'); } } else { http_response_code(404); echo '<!doctype html><title>Cart link unavailable</title><div style="max-width:640px;margin:80px auto;font:16px sans-serif"><h1>This cart link is unavailable</h1><p>It may have expired or already been used. Please return to the store to start a new cart.</p></div>'; }
