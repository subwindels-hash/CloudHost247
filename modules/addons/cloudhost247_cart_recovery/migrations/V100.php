<?php
namespace CloudHost247\CartRecovery\Migrations;
use WHMCS\Database\Capsule;

final class V100 {
    public static function run() {
        $s = Capsule::schema();
        if (!$s->hasTable('mod_cloudhost247_cart_recovery_recoveries')) $s->create('mod_cloudhost247_cart_recovery_recoveries', function($t) {
            $t->bigIncrements('id'); $t->unsignedBigInteger('client_id')->nullable()->index();
            $t->string('session_key',128)->nullable()->index(); $t->string('email',254)->nullable()->index();
            $t->string('first_name',100)->nullable(); $t->string('last_name',100)->nullable(); $t->string('currency',8)->default('');
            $t->longText('cart_snapshot'); $t->decimal('cart_total',16,2)->nullable(); $t->string('status',20)->default('active')->index();
            $t->string('token_hash',64)->unique(); $t->text('token_ciphertext')->nullable(); $t->dateTime('token_expires_at')->index(); $t->dateTime('first_seen_at');
            $t->dateTime('last_activity_at')->index(); $t->dateTime('abandoned_at')->nullable()->index();
            $t->unsignedTinyInteger('last_reminder_number')->default(0); $t->dateTime('last_reminder_at')->nullable(); $t->dateTime('next_reminder_at')->nullable()->index();
            $t->dateTime('recovered_at')->nullable(); $t->dateTime('converted_at')->nullable(); $t->unsignedBigInteger('order_id')->nullable()->index();
            $t->decimal('recovered_revenue',16,2)->nullable(); $t->dateTime('unsubscribed_at')->nullable();
            $t->dateTime('created_at'); $t->dateTime('updated_at');
            $t->index(array('client_id','status'),'ch247_cr_client_status');
        });
        if (!$s->hasTable('mod_cloudhost247_cart_recovery_reminder_logs')) $s->create('mod_cloudhost247_cart_recovery_reminder_logs', function($t) {
            $t->bigIncrements('id'); $t->unsignedBigInteger('recovery_id'); $t->unsignedTinyInteger('reminder_number');
            $t->string('email',254); $t->string('template_name',191); $t->string('status',20)->index(); $t->dateTime('sent_at')->nullable();
            $t->dateTime('failed_at')->nullable(); $t->text('error_message')->nullable(); $t->dateTime('created_at'); $t->dateTime('updated_at');
            $t->unique(array('recovery_id','reminder_number'),'ch247_cr_reminder_once'); $t->index('recovery_id');
        });
        if (!$s->hasTable('mod_cloudhost247_cart_recovery_suppressions')) $s->create('mod_cloudhost247_cart_recovery_suppressions', function($t) {
            $t->bigIncrements('id'); $t->string('email',254)->nullable()->index(); $t->unsignedBigInteger('client_id')->nullable()->index();
            $t->string('reason',64)->default('unsubscribe'); $t->dateTime('created_at'); $t->dateTime('updated_at');
            $t->unique(array('email','client_id'),'ch247_cr_suppression_unique');
        });
        if (!$s->hasTable('mod_cloudhost247_cart_recovery_settings')) $s->create('mod_cloudhost247_cart_recovery_settings', function($t) {
            $t->string('setting',64)->primary(); $t->text('value'); $t->dateTime('updated_at');
        });
    }
}
