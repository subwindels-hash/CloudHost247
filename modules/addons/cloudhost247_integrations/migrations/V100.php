<?php
namespace CloudHost247\Integrations\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

/**
 * Additive schema for the central API & Integrations registry.
 *
 * Credential material is stored only in the encrypted envelope column of
 * mod_cloudhost247_integration_secrets. No plaintext credential column exists
 * anywhere in this schema.
 */
final class IntegrationsInitialMigration implements Migration
{
    public function version() { return '1.0.0'; }

    public function description() { return 'Create central integration registry, encrypted credential store and health event log'; }

    public function up()
    {
        $schema = Capsule::schema();

        if (!$schema->hasTable('mod_cloudhost247_integrations')) {
            $schema->create('mod_cloudhost247_integrations', function ($table) {
                $table->bigIncrements('id');
                $table->string('provider_key', 64)->index();
                $table->string('environment', 16)->index();
                $table->string('display_name', 128)->default('');
                $table->boolean('enabled')->default(false);
                $table->string('base_url', 255)->default('');
                $table->string('api_version', 32)->default('');
                $table->string('account_id', 191)->default('');
                $table->string('region', 64)->default('');
                $table->string('username', 191)->default('');
                $table->unsignedInteger('timeout_seconds')->default(20);
                $table->unsignedInteger('connect_timeout_seconds')->default(5);
                $table->unsignedInteger('retry_attempts')->default(1);
                $table->unsignedInteger('retry_backoff_ms')->default(250);
                $table->text('options_json')->nullable();
                $table->string('status', 32)->default('unknown')->index();
                $table->string('last_result_code', 48)->nullable();
                $table->string('last_failure_reason', 255)->nullable();
                $table->dateTime('last_checked_at')->nullable();
                $table->dateTime('last_success_at')->nullable();
                $table->dateTime('last_failure_at')->nullable();
                $table->unsignedInteger('created_by')->nullable();
                $table->unsignedInteger('updated_by')->nullable();
                $table->dateTime('created_at');
                $table->dateTime('updated_at');
                $table->unique(array('provider_key', 'environment'), 'ch247_integration_environment_unique');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_integration_secrets')) {
            $schema->create('mod_cloudhost247_integration_secrets', function ($table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('integration_id')->index();
                $table->string('field_key', 64);
                $table->text('envelope');
                $table->string('cipher', 32)->default('aes-256-gcm');
                $table->string('key_fingerprint', 32);
                $table->string('value_fingerprint', 32);
                $table->unsignedInteger('rotated_by')->nullable();
                $table->dateTime('rotated_at');
                $table->dateTime('updated_at');
                $table->unique(array('integration_id', 'field_key'), 'ch247_integration_secret_unique');
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_integration_events')) {
            $schema->create('mod_cloudhost247_integration_events', function ($table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('integration_id')->nullable()->index();
                $table->string('provider_key', 64)->index();
                $table->string('environment', 16)->index();
                $table->string('event_type', 32)->index();
                $table->string('result_code', 48)->index();
                $table->string('outcome', 16)->index();
                $table->unsignedInteger('latency_ms')->nullable();
                $table->string('detail', 255)->nullable();
                $table->string('correlation_id', 64)->index();
                $table->unsignedInteger('admin_id')->nullable();
                $table->dateTime('created_at')->index();
            });
        }
    }
}
