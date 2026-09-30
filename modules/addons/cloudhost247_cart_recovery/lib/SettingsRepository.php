<?php
namespace CloudHost247\CartRecovery;
use WHMCS\Database\Capsule;
final class SettingsRepository {
    public static function defaults() { return array('enabled'=>'1','enable_reminder_1'=>'1','enable_reminder_2'=>'1','enable_reminder_3'=>'1','abandonment_threshold'=>'3600','reminder_1_delay'=>'3600','reminder_2_delay'=>'86400','reminder_3_delay'=>'259200','maximum_reminders'=>'3','token_lifetime'=>'604800','guest_recovery'=>'1','unsubscribe'=>'1','batch_size'=>'50'); }
    public static function get($key) { $row=Capsule::table('mod_cloudhost247_cart_recovery_settings')->where('setting',$key)->first(); $d=self::defaults(); return $row ? (string)$row->value : (isset($d[$key])?$d[$key]:''); }
    public static function all() { $d=self::defaults(); foreach(Capsule::table('mod_cloudhost247_cart_recovery_settings')->get() as $r) $d[$r->setting]=(string)$r->value; return $d; }
    public static function seed() { foreach(self::defaults() as $k=>$v) Capsule::table('mod_cloudhost247_cart_recovery_settings')->insertOrIgnore(array('setting'=>$k,'value'=>$v,'updated_at'=>date('Y-m-d H:i:s'))); }
    public static function save($values) { foreach(self::defaults() as $k=>$default) if(array_key_exists($k,$values)) Capsule::table('mod_cloudhost247_cart_recovery_settings')->updateOrInsert(array('setting'=>$k),array('value'=>(string)$values[$k],'updated_at'=>date('Y-m-d H:i:s'))); }
}
