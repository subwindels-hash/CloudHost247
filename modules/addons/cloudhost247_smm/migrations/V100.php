<?php
namespace CloudHost247\Smm\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

/**
 * Initial schema for the SMM marketplace integration.
 *
 * Non-destructive by design:
 *  - creates only mod_cloudhost247_smm_* tables (no WHMCS core tables are
 *    touched, no foreign keys are declared — references are indexed integers
 *    so MySQL versions/configurations without FK enforcement stay supported
 *    and history can never be cascade-deleted);
 *  - every create is guarded by hasTable so re-running is a no-op;
 *  - no table is ever dropped or renamed here.
 */
final class InitialMigration implements Migration
{
    public function version() { return '1.0.0'; }

    public function description() { return 'Create SMM providers/services/mappings/orders/events/api-log/sync-history/locks/settings tables'; }

    public function up()
    {
        if (!Capsule::schema()->hasTable('mod_cloudhost247_smm_providers')) {
            Capsule::schema()->create('mod_cloudhost247_smm_providers', function ($t) {
                $t->bigIncrements('id');
                $t->string('name', 120)->unique('ch247_smm_provider_name_unique');
                $t->string('adapter', 32)->default('generic');
                $t->string('api_url', 2048);
                $t->text('api_key_encrypted');                 // encrypted envelope; plaintext never persisted
                $t->string('api_key_hint', 32)->default('');   // masked display hint only
                $t->integer('priority')->default(100);
                $t->boolean('enabled')->default(false);
                $t->string('currency', 8)->default('');
                $t->integer('request_timeout')->default(20);
                $t->boolean('refill_supported')->nullable();   // null = probe from catalog
                $t->boolean('cancel_supported')->nullable();
                $t->string('connection_status', 16)->default('unknown');
                $t->string('balance', 32)->default('');
                $t->dateTime('balance_updated_at')->nullable();
                $t->dateTime('last_sync_at')->nullable();
                $t->dateTime('last_success_at')->nullable();
                $t->string('last_error', 500)->default('');
                $t->dateTime('last_error_at')->nullable();
                $t->dateTime('created_at')->nullable();
                $t->dateTime('updated_at')->nullable();
            });
        }
        if (!Capsule::schema()->hasTable('mod_cloudhost247_smm_services')) {
            Capsule::schema()->create('mod_cloudhost247_smm_services', function ($t) {
                $t->bigIncrements('id');
                $t->unsignedBigInteger('provider_id')->index('ch247_smm_service_provider_idx');
                $t->string('provider_service_id', 64);
                $t->string('name', 250);
                $t->string('category', 120)->default('')->index('ch247_smm_service_category_idx');
                $t->text('description')->nullable();
                $t->string('type', 64)->default('');
                $t->integer('min_quantity')->nullable();
                $t->integer('max_quantity')->nullable();
                $t->decimal('rate', 12, 4)->nullable();
                $t->string('currency', 8)->default('');
                $t->boolean('refill')->default(false);
                $t->boolean('cancel')->default(false);
                $t->string('provider_status', 24)->default('active');
                $t->boolean('available')->default(true)->index('ch247_smm_service_available_idx');
                $t->dateTime('last_seen_at')->nullable();
                $t->dateTime('created_at')->nullable();
                $t->dateTime('updated_at')->nullable();
                $t->unique(array('provider_id', 'provider_service_id'), 'ch247_smm_service_provider_service_unique');
            });
        }
        if (!Capsule::schema()->hasTable('mod_cloudhost247_smm_mappings')) {
            Capsule::schema()->create('mod_cloudhost247_smm_mappings', function ($t) {
                $t->bigIncrements('id');
                $t->unsignedBigInteger('provider_id')->index('ch247_smm_mapping_provider_idx');
                $t->unsignedBigInteger('service_id')->index('ch247_smm_mapping_service_idx');
                $t->unsignedBigInteger('product_id')->unique('ch247_smm_mapping_product_unique'); // one product = one provider service
                $t->string('provider_service_id', 64);
                $t->string('name', 250);
                $t->integer('min_quantity')->nullable();
                $t->integer('max_quantity')->nullable();
                $t->decimal('provider_cost', 12, 4)->nullable();
                $t->decimal('sell_price', 12, 4)->nullable();
                $t->decimal('margin_percent', 6, 2)->nullable();
                $t->string('currency', 8)->default('');
                $t->boolean('enabled')->default(true);
                $t->dateTime('created_at')->nullable();
                $t->dateTime('updated_at')->nullable();
            });
        }
        if (!Capsule::schema()->hasTable('mod_cloudhost247_smm_orders')) {
            Capsule::schema()->create('mod_cloudhost247_smm_orders', function ($t) {
                $t->bigIncrements('id');
                $t->unsignedBigInteger('whmcs_service_id')->unique('ch247_smm_order_service_unique'); // idempotency anchor
                $t->unsignedBigInteger('whmcs_order_id')->default(0);
                $t->unsignedBigInteger('whmcs_client_id')->index('ch247_smm_order_client_idx');
                $t->unsignedBigInteger('whmcs_product_id')->default(0);
                $t->unsignedBigInteger('mapping_id')->default(0);
                $t->unsignedBigInteger('provider_id')->index('ch247_smm_order_provider_idx');
                $t->string('provider_service_id', 64)->default('');
                $t->string('provider_name', 120)->default('');  // snapshot: survives provider removal
                $t->string('service_name', 250)->default('');   // snapshot: survives mapping removal
                $t->string('provider_order_id', 64)->default('')->index('ch247_smm_order_provider_order_idx');
                $t->string('target_url', 512)->default('');
                $t->integer('quantity')->default(0);
                $t->integer('start_count')->nullable();
                $t->integer('remains')->nullable();
                $t->decimal('customer_price', 12, 4)->nullable();
                $t->decimal('provider_cost', 12, 4)->nullable();
                $t->string('currency', 8)->default('');
                $t->string('submission_state', 24)->default('awaiting_submission')->index('ch247_smm_order_state_idx');
                $t->string('order_status', 24)->nullable()->index('ch247_smm_order_status_idx');
                $t->string('provider_status_raw', 64)->default('');
                $t->boolean('needs_review')->default(false)->index('ch247_smm_order_review_idx');
                $t->boolean('suspended')->default(false);
                $t->boolean('refill_supported')->default(false);
                $t->boolean('cancel_supported')->default(false);
                $t->string('last_refill_id', 64)->default('');
                $t->string('last_refill_status', 64)->default('');
                $t->string('error_message', 500)->default('');
                $t->string('correlation_id', 64)->default('');
                $t->dateTime('submitted_at')->nullable();
                $t->dateTime('last_status_at')->nullable();
                $t->dateTime('last_sync_at')->nullable();
                $t->dateTime('created_at')->nullable();
                $t->dateTime('updated_at')->nullable();
            });
        }
        if (!Capsule::schema()->hasTable('mod_cloudhost247_smm_order_events')) {
            Capsule::schema()->create('mod_cloudhost247_smm_order_events', function ($t) {
                $t->bigIncrements('id');
                $t->unsignedBigInteger('order_id')->index('ch247_smm_event_order_idx');
                $t->string('event', 40);
                $t->string('from_status', 24)->nullable();
                $t->string('to_status', 24)->nullable();
                $t->string('submission_state', 24)->nullable();
                $t->string('note', 500)->default('');
                $t->string('actor', 16)->default('system');
                $t->unsignedBigInteger('actor_id')->default(0);
                $t->string('correlation_id', 64)->default('');
                $t->dateTime('created_at')->nullable();
            });
        }
        if (!Capsule::schema()->hasTable('mod_cloudhost247_smm_api_log')) {
            Capsule::schema()->create('mod_cloudhost247_smm_api_log', function ($t) {
                $t->bigIncrements('id');
                $t->unsignedBigInteger('provider_id')->nullable()->index('ch247_smm_api_provider_idx');
                $t->string('operation', 32)->index('ch247_smm_api_operation_idx');
                $t->string('result', 12)->index('ch247_smm_api_result_idx');
                $t->integer('http_status')->default(0);
                $t->integer('duration_ms')->default(0);
                $t->text('request_json')->nullable();          // credentials redacted before insert
                $t->text('response_json')->nullable();         // truncated excerpt, secrets scrubbed
                $t->string('correlation_id', 64)->default('')->index('ch247_smm_api_correlation_idx');
                $t->dateTime('created_at')->index('ch247_smm_api_created_idx');
            });
        }
        if (!Capsule::schema()->hasTable('mod_cloudhost247_smm_sync_history')) {
            Capsule::schema()->create('mod_cloudhost247_smm_sync_history', function ($t) {
                $t->bigIncrements('id');
                $t->unsignedBigInteger('provider_id')->nullable()->index('ch247_smm_sync_provider_idx');
                $t->string('trigger', 16)->default('cron');
                $t->string('result', 12)->default('success');
                $t->integer('services_seen')->default(0);
                $t->integer('services_added')->default(0);
                $t->integer('services_updated')->default(0);
                $t->integer('services_deactivated')->default(0);
                $t->integer('services_unchanged')->default(0);
                $t->string('error_message', 500)->default('');
                $t->dateTime('started_at')->nullable();
                $t->dateTime('finished_at')->nullable();
                $t->dateTime('created_at')->nullable();
            });
        }
        if (!Capsule::schema()->hasTable('mod_cloudhost247_smm_locks')) {
            Capsule::schema()->create('mod_cloudhost247_smm_locks', function ($t) {
                $t->bigIncrements('id');
                $t->string('lock_name', 64)->unique('ch247_smm_lock_name_unique');
                $t->string('owner', 40);
                $t->dateTime('locked_until')->nullable();
                $t->dateTime('updated_at')->nullable();
            });
        }
        if (!Capsule::schema()->hasTable('mod_cloudhost247_smm_settings')) {
            Capsule::schema()->create('mod_cloudhost247_smm_settings', function ($t) {
                $t->bigIncrements('id');
                $t->string('setting_key', 64)->unique('ch247_smm_setting_key_unique');
                $t->text('setting_value')->nullable();
                $t->dateTime('updated_at')->nullable();
                $t->unsignedBigInteger('updated_by')->default(0);
            });
        }
    }
}
