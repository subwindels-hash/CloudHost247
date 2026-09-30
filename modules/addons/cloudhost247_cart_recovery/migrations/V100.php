<?php
/**
 * V100 — initial schema. Idempotent and repeatable: every table and index is
 * created only when it does not already exist.
 *
 * Table names are written literally here so the migration stays readable and
 * verifiable by scripts/validate-migrations.py; application code uses the
 * Schema constants instead.
 */

namespace CloudHost247\CartRecovery\Migrations;

use WHMCS\Database\Capsule;

final class V100
{
    const VERSION = 100;
    const DESCRIPTION = 'Cart recovery, reminder log, suppression and settings tables';

    /** Repository-wide migration convention (see scripts/validate-migrations.py). */
    public function version() { return '1.0.0'; }

    public function description() { return self::DESCRIPTION; }

    public function up() { self::run(); }

    public static function run()
    {
        $schema = Capsule::schema();

        if (!$schema->hasTable('mod_cloudhost247_cart_recovery_recoveries')) {
            $schema->create('mod_cloudhost247_cart_recovery_recoveries', function ($table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('client_id')->nullable();
                $table->string('session_key', 128)->nullable();
                $table->string('email', 254)->nullable();
                $table->string('first_name', 100)->nullable();
                $table->string('last_name', 100)->nullable();
                $table->string('currency', 8)->default('');
                $table->longText('cart_snapshot');
                $table->string('cart_fingerprint', 64)->nullable();
                $table->decimal('cart_total', 16, 2)->nullable();
                $table->string('status', 20)->default('active');
                $table->string('token_hash', 64);
                $table->text('token_ciphertext')->nullable();
                $table->string('unsubscribe_hash', 64)->nullable();
                $table->dateTime('token_expires_at');
                $table->dateTime('first_seen_at');
                $table->dateTime('last_activity_at');
                $table->dateTime('abandoned_at')->nullable();
                $table->unsignedTinyInteger('last_reminder_number')->default(0);
                $table->dateTime('last_reminder_at')->nullable();
                $table->dateTime('next_reminder_at')->nullable();
                $table->dateTime('recovered_at')->nullable();
                $table->dateTime('converted_at')->nullable();
                $table->unsignedBigInteger('order_id')->nullable();
                $table->decimal('recovered_revenue', 16, 2)->nullable();
                $table->dateTime('unsubscribed_at')->nullable();
                $table->dateTime('created_at');
                $table->dateTime('updated_at');

                $table->unique('token_hash', 'ch247cr_token_unique');
                $table->unique('unsubscribe_hash', 'ch247cr_unsub_unique');
                $table->index('client_id', 'ch247cr_client');
                $table->index('session_key', 'ch247cr_session');
                $table->index('email', 'ch247cr_email');
                $table->index('status', 'ch247cr_status');
                $table->index('next_reminder_at', 'ch247cr_next_reminder');
                $table->index('last_activity_at', 'ch247cr_last_activity');
                $table->index('token_expires_at', 'ch247cr_token_expires');
                $table->index('order_id', 'ch247cr_order');
                $table->index('created_at', 'ch247cr_created');
                $table->index('updated_at', 'ch247cr_updated');
                $table->index(array('status', 'next_reminder_at'), 'ch247cr_status_due');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_cart_recovery_reminder_logs')) {
            $schema->create('mod_cloudhost247_cart_recovery_reminder_logs', function ($table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('recovery_id');
                $table->unsignedTinyInteger('reminder_number');
                $table->string('email', 254)->nullable();
                $table->string('template_name', 191)->nullable();
                $table->string('status', 20)->default('pending');
                $table->unsignedSmallInteger('attempts')->default(0);
                $table->dateTime('sent_at')->nullable();
                $table->dateTime('failed_at')->nullable();
                $table->text('error_message')->nullable();
                $table->dateTime('created_at');
                $table->dateTime('updated_at');

                // Idempotency key: one row per (recovery, reminder number).
                $table->unique(array('recovery_id', 'reminder_number'), 'ch247cr_reminder_once');
                $table->index('status', 'ch247cr_log_status');
                $table->index('created_at', 'ch247cr_log_created');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_cart_recovery_suppressions')) {
            $schema->create('mod_cloudhost247_cart_recovery_suppressions', function ($table) {
                $table->bigIncrements('id');
                $table->string('email', 254)->nullable();
                $table->unsignedBigInteger('client_id')->nullable();
                $table->string('reason', 64)->default('unsubscribe');
                $table->dateTime('created_at');
                $table->dateTime('updated_at');

                $table->unique(array('email', 'client_id'), 'ch247cr_suppression_unique');
                $table->index('client_id', 'ch247cr_suppression_client');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_cart_recovery_settings')) {
            $schema->create('mod_cloudhost247_cart_recovery_settings', function ($table) {
                $table->string('setting', 64)->primary();
                $table->text('value');
                $table->dateTime('updated_at');
            });
        }
    }
}
