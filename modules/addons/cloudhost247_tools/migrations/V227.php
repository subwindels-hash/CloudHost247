<?php
namespace CloudHost247\Tools\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

/**
 * Initial schema for the CloudHost247 Tools Platform (v2.2.7 hardening release).
 *
 * Non-destructive by design:
 *  - creates only mod_cloudhost247_tools_* tables;
 *  - every create is guarded by hasTable so re-running is a no-op — this also
 *    makes the migration safe on installs that already created the tables via
 *    the pre-2.2.7 inline activation (existing data is preserved and the
 *    migration is simply recorded as applied);
 *  - no table is ever dropped or renamed here.
 */
final class InitialMigration implements Migration
{
    public function version() { return '2.2.7'; }

    public function description() { return 'Create tools settings/status/logs/cache/rate-limit tables'; }

    public function up()
    {
        if (!Capsule::schema()->hasTable('mod_cloudhost247_tools_settings')) {
            Capsule::schema()->create('mod_cloudhost247_tools_settings', function ($table) {
                $table->increments('id');
                $table->string('setting_name', 100)->unique();
                $table->text('setting_value')->nullable();
                $table->timestamps();
            });
        }

        if (!Capsule::schema()->hasTable('mod_cloudhost247_tools_status')) {
            Capsule::schema()->create('mod_cloudhost247_tools_status', function ($table) {
                $table->increments('id');
                $table->string('tool_id', 100)->unique();
                $table->string('tool_name', 255);
                $table->string('category', 100);
                $table->tinyInteger('enabled')->default(1);
                $table->integer('usage_count')->default(0);
                $table->timestamps();
            });
        }

        if (!Capsule::schema()->hasTable('mod_cloudhost247_tools_logs')) {
            Capsule::schema()->create('mod_cloudhost247_tools_logs', function ($table) {
                $table->increments('id');
                $table->string('tool_id', 100);
                $table->string('input', 500)->nullable();
                $table->string('ip_address', 50);
                $table->integer('user_id')->default(0);
                $table->text('result')->nullable();
                $table->string('status', 20)->default('success');
                $table->text('error_message')->nullable();
                $table->timestamp('created_at')->useCurrent();
            });
        }

        if (!Capsule::schema()->hasTable('mod_cloudhost247_tools_cache')) {
            Capsule::schema()->create('mod_cloudhost247_tools_cache', function ($table) {
                $table->increments('id');
                $table->string('cache_key', 255)->unique();
                $table->longText('cache_value');
                $table->timestamp('expires_at');
                $table->timestamp('created_at')->useCurrent();
            });
        }

        if (!Capsule::schema()->hasTable('mod_cloudhost247_tools_rate_limit')) {
            Capsule::schema()->create('mod_cloudhost247_tools_rate_limit', function ($table) {
                $table->increments('id');
                $table->string('ip_address', 50);
                $table->integer('request_count')->default(0);
                $table->timestamp('window_start')->useCurrent();
            });
        }
    }
}
