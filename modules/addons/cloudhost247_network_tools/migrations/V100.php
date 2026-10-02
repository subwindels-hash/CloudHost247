<?php
namespace CloudHost247\NetworkTools\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

/**
 * Additive schema for the CloudHost247 native tools platform.
 *
 * Design rules that this migration follows deliberately:
 *
 *  - every table is prefixed mod_cloudhost247_nt_ and created only when it does
 *    not exist, so the migration is safe to re-run and never touches WHMCS core
 *    tables;
 *  - no drop, rename or destructive operation of any kind;
 *  - no column in any table may hold a plaintext secret. Credentials stay in
 *    the integrations centre's encrypted store; the tools tables only ever keep
 *    non-secret selections such as an endpoint, a zone name or a provider key.
 */
final class NetworkToolsInitialMigration implements Migration
{
    public function version() { return '1.0.0'; }

    public function description() { return 'Create the native DNS, IP, network and developer tools tables'; }

    public function up()
    {
        $schema = Capsule::schema();

        if (!$schema->hasTable('mod_cloudhost247_nt_tools')) {
            $schema->create('mod_cloudhost247_nt_tools', function ($table) {
                $table->bigIncrements('id');
                $table->string('slug', 96)->unique('ch247_nt_tools_slug');
                $table->string('name', 191);
                $table->string('category', 32)->index('ch247_nt_tools_category');
                $table->string('description', 500)->default('');
                $table->string('status', 32)->default('ACTIVE')->index('ch247_nt_tools_status');
                $table->string('visibility', 16)->default('public');
                $table->string('rate_tier', 16)->default('standard');
                $table->text('rate_limits_json')->nullable();
                $table->unsignedInteger('timeout_seconds')->default(10);
                $table->unsignedInteger('cache_seconds')->default(0);
                $table->string('provider_keys', 255)->default('');
                $table->text('configuration_json')->nullable();
                $table->dateTime('created_at');
                $table->dateTime('updated_at');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_nt_settings')) {
            $schema->create('mod_cloudhost247_nt_settings', function ($table) {
                $table->bigIncrements('id');
                $table->string('setting_key', 96)->unique('ch247_nt_settings_key');
                $table->text('setting_value')->nullable();
                $table->dateTime('updated_at');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_nt_resolvers')) {
            $schema->create('mod_cloudhost247_nt_resolvers', function ($table) {
                $table->bigIncrements('id');
                $table->string('name', 96);
                $table->string('provider', 96)->default('');
                $table->string('ip_address', 45);
                $table->string('protocol', 8)->default('udp');
                $table->string('version', 4)->default('v4');
                $table->string('country_code', 4)->default('');
                $table->string('region', 96)->default('');
                $table->string('city', 96)->default('');
                $table->decimal('latitude', 9, 6)->nullable();
                $table->decimal('longitude', 9, 6)->nullable();
                $table->string('endpoint', 255)->default('');
                $table->boolean('enabled')->default(true);
                $table->unsignedInteger('priority')->default(100);
                $table->string('health_status', 32)->default('UNKNOWN');
                $table->dateTime('last_checked_at')->nullable();
                $table->unsignedInteger('last_latency_ms')->nullable();
                $table->string('last_error', 255)->nullable();
                $table->dateTime('created_at');
                $table->dateTime('updated_at');
                $table->unique(array('ip_address', 'protocol'), 'ch247_nt_resolvers_address_protocol');
                $table->index(array('enabled', 'priority'), 'ch247_nt_resolvers_enabled_priority');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_nt_checks')) {
            $schema->create('mod_cloudhost247_nt_checks', function ($table) {
                $table->bigIncrements('id');
                $table->string('tool_slug', 96)->index('ch247_nt_checks_tool');
                $table->string('target', 191)->index('ch247_nt_checks_target');
                $table->string('record_type', 16)->default('');
                $table->string('resolver_name', 96)->default('');
                $table->string('resolver_ip', 45)->default('');
                $table->string('status', 32)->default('UNKNOWN');
                $table->text('value_json')->nullable();
                $table->unsignedInteger('latency_ms')->nullable();
                $table->string('error', 255)->nullable();
                $table->dateTime('checked_at')->index('ch247_nt_checks_checked');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_nt_executions')) {
            $schema->create('mod_cloudhost247_nt_executions', function ($table) {
                $table->bigIncrements('id');
                $table->string('tool_slug', 96)->index('ch247_nt_executions_tool');
                $table->string('category', 32)->default('');
                $table->string('actor_type', 16)->default('guest');
                $table->unsignedBigInteger('client_id')->default(0)->index('ch247_nt_executions_client');
                $table->unsignedBigInteger('admin_id')->default(0);
                $table->string('ip_address', 45)->default('');
                $table->string('target_label', 191)->default('');
                $table->string('result_code', 48)->default('');
                $table->boolean('ok')->default(false);
                $table->unsignedInteger('duration_ms')->default(0);
                $table->boolean('cached')->default(false);
                $table->string('provider_used', 64)->default('');
                $table->dateTime('created_at')->index('ch247_nt_executions_created');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_nt_history')) {
            $schema->create('mod_cloudhost247_nt_history', function ($table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('client_id')->index('ch247_nt_history_client');
                $table->string('tool_slug', 96);
                $table->string('target_label', 191)->default('');
                $table->string('result_code', 48)->default('');
                $table->boolean('ok')->default(false);
                $table->string('summary', 500)->default('');
                $table->dateTime('created_at')->index('ch247_nt_history_created');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_nt_favorites')) {
            $schema->create('mod_cloudhost247_nt_favorites', function ($table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('client_id');
                $table->string('tool_slug', 96);
                $table->dateTime('created_at');
                $table->dateTime('updated_at');
                $table->unique(array('client_id', 'tool_slug'), 'ch247_nt_favorites_unique');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_nt_reports')) {
            $schema->create('mod_cloudhost247_nt_reports', function ($table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('client_id')->index('ch247_nt_reports_client');
                $table->string('tool_slug', 96)->index('ch247_nt_reports_tool');
                $table->string('target_label', 191)->default('');
                $table->string('title', 191)->default('');
                $table->string('status', 32)->default('recorded');
                $table->string('result_code', 48)->default('OK');
                $table->longText('payload_json')->nullable();
                $table->dateTime('created_at');
                $table->dateTime('updated_at');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_nt_rate_limits')) {
            $schema->create('mod_cloudhost247_nt_rate_limits', function ($table) {
                $table->bigIncrements('id');
                $table->string('dimension', 32);
                $table->string('bucket', 191);
                $table->unsignedBigInteger('window_start');
                $table->unsignedInteger('counter')->default(0);
                $table->dateTime('created_at');
                $table->unique(array('dimension', 'bucket', 'window_start'), 'ch247_nt_rate_limits_unique');
                $table->index('window_start', 'ch247_nt_rate_limits_window');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_nt_cache')) {
            $schema->create('mod_cloudhost247_nt_cache', function ($table) {
                $table->bigIncrements('id');
                $table->string('cache_key', 96)->unique('ch247_nt_cache_key');
                $table->longText('payload_json')->nullable();
                $table->dateTime('expires_at')->index('ch247_nt_cache_expires');
                $table->dateTime('created_at');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_nt_providers')) {
            $schema->create('mod_cloudhost247_nt_providers', function ($table) {
                $table->bigIncrements('id');
                $table->string('provider_key', 96)->unique('ch247_nt_providers_key');
                $table->string('label', 191)->default('');
                $table->string('type', 16)->default('integration')->index('ch247_nt_providers_type');
                $table->string('endpoint', 255)->default('');
                $table->text('configuration_json')->nullable();
                $table->boolean('enabled')->default(false)->index('ch247_nt_providers_enabled');
                $table->unsignedInteger('priority')->default(100);
                $table->unsignedInteger('timeout_seconds')->default(5);
                $table->unsignedInteger('rate_limit_per_minute')->default(30);
                $table->string('health_status', 32)->default('UNKNOWN');
                $table->dateTime('last_checked_at')->nullable();
                $table->string('last_error', 255)->nullable();
                $table->dateTime('created_at');
                $table->dateTime('updated_at');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_nt_health')) {
            $schema->create('mod_cloudhost247_nt_health', function ($table) {
                $table->bigIncrements('id');
                $table->string('subject_type', 24);
                $table->string('subject_key', 128);
                $table->string('status', 32)->default('UNKNOWN');
                $table->unsignedInteger('latency_ms')->nullable();
                $table->string('detail', 500)->default('');
                $table->dateTime('checked_at')->index('ch247_nt_health_checked');
                $table->index(array('subject_type', 'subject_key'), 'ch247_nt_health_subject');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_nt_monitors')) {
            $schema->create('mod_cloudhost247_nt_monitors', function ($table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('client_id')->index('ch247_nt_monitors_client');
                $table->string('tool_slug', 96);
                $table->string('monitor_type', 32)->index('ch247_nt_monitors_type');
                $table->string('target', 191);
                $table->string('record_type', 16)->default('');
                $table->text('expected_json')->nullable();
                $table->longText('last_state_json')->nullable();
                $table->unsignedInteger('interval_hours')->default(6);
                $table->boolean('enabled')->default(true);
                $table->dateTime('last_run_at')->nullable();
                $table->string('last_status', 32)->default('NOT_CHECKED');
                $table->dateTime('last_alert_at')->nullable();
                $table->dateTime('created_at');
                $table->dateTime('updated_at');
                $table->index(array('enabled', 'last_run_at'), 'ch247_nt_monitors_due');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_nt_monitor_events')) {
            $schema->create('mod_cloudhost247_nt_monitor_events', function ($table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('monitor_id')->index('ch247_nt_monitor_events_monitor');
                $table->string('event_type', 48);
                $table->text('previous_json')->nullable();
                $table->text('current_json')->nullable();
                $table->string('severity', 16)->default('warning');
                $table->boolean('notified')->default(false);
                $table->dateTime('created_at');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_nt_abuse_events')) {
            $schema->create('mod_cloudhost247_nt_abuse_events', function ($table) {
                $table->bigIncrements('id');
                $table->string('event_type', 48);
                $table->string('ip_address', 45)->index('ch247_nt_abuse_ip');
                $table->unsignedBigInteger('client_id')->default(0);
                $table->string('tool_slug', 96)->default('');
                $table->string('detail', 255)->default('');
                $table->dateTime('created_at')->index('ch247_nt_abuse_created');
            });
        }

        return true;
    }
}
