<?php
if (PHP_SAPI !== 'cli' && !defined('WHMCS')) { http_response_code(403); exit('CLI only'); }
require_once dirname(dirname(dirname(__DIR__))).'/init.php'; require_once __DIR__.'/bootstrap.php';
use WHMCS\Database\Capsule; use CloudHost247\CartRecovery\ReminderService; use CloudHost247\CartRecovery\SettingsRepository;
$lock=Capsule::table('mod_cloudhost247_cart_recovery_settings')->where('setting','cron_lock')->first(); if($lock && strtotime($lock->value)>time()) exit("locked\n"); Capsule::table('mod_cloudhost247_cart_recovery_settings')->updateOrInsert(array('setting'=>'cron_lock'),array('value'=>date('Y-m-d H:i:s',time()+240),'updated_at'=>date('Y-m-d H:i:s')));
try { $r=ReminderService::process((int)SettingsRepository::get('batch_size')); echo json_encode($r)."\n"; } finally { Capsule::table('mod_cloudhost247_cart_recovery_settings')->where('setting','cron_lock')->delete(); }
