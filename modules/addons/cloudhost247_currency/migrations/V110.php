<?php
namespace CloudHost247\Currency\Migrations;
use CloudHost247\Foundation\Contracts\Migration; use WHMCS\Database\Capsule;
final class CurrencyOperationalMigration implements Migration
{
 public function version(){return '1.1.0';} public function description(){return 'Create currency configuration and execution lock tables';}
 public function up(){
  if(!Capsule::schema()->hasTable('mod_cloudhost247_currency_settings'))Capsule::schema()->create('mod_cloudhost247_currency_settings',function($t){$t->string('setting_key',64)->primary();$t->text('setting_value')->nullable();$t->dateTime('updated_at');});
  if(!Capsule::schema()->hasTable('mod_cloudhost247_currency_config'))Capsule::schema()->create('mod_cloudhost247_currency_config',function($t){$t->bigIncrements('id');$t->unsignedInteger('whmcs_currency_id')->unique();$t->string('currency_code',3)->index();$t->boolean('enabled')->default(true);$t->decimal('margin_percent',10,4)->default(0);$t->unsignedInteger('precision_digits')->default(6);$t->string('rounding_mode',16)->default('nearest');$t->dateTime('updated_at');});
  if(!Capsule::schema()->hasTable('mod_cloudhost247_currency_locks'))Capsule::schema()->create('mod_cloudhost247_currency_locks',function($t){$t->string('lock_name',64)->primary();$t->string('owner',64);$t->dateTime('locked_until');$t->dateTime('updated_at');});
  foreach(array('base_currency'=>'USD','update_frequency_minutes'=>'360','provider_order'=>'frankfurter,ecb','last_cron_at'=>'','last_cron_attempt_at'=>'') as $k=>$v)Capsule::table('mod_cloudhost247_currency_settings')->updateOrInsert(array('setting_key'=>$k),array('setting_value'=>$v,'updated_at'=>date('Y-m-d H:i:s')));
  foreach(array(array('provider_key'=>'frankfurter','display_name'=>'Frankfurter','priority'=>10),array('provider_key'=>'ecb','display_name'=>'European Central Bank','priority'=>20)) as $p)Capsule::table('mod_cloudhost247_currency_providers')->updateOrInsert(array('provider_key'=>$p['provider_key']),array('display_name'=>$p['display_name'],'enabled'=>1,'configuration_json'=>'{}','priority'=>$p['priority'],'updated_at'=>date('Y-m-d H:i:s')));
 }
}
