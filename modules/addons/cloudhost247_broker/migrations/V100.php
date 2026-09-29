<?php
namespace CloudHost247\Broker\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

/**
 * Initial schema for the CloudHost247 Domain Broker Service.
 *
 * Non-destructive by design, matching every other CloudHost247 module:
 *  - only mod_cloudhost247_broker_* tables are created;
 *  - no WHMCS core table is touched and no foreign keys are declared —
 *    references are indexed unsigned integers so history can never be
 *    cascade-deleted and MySQL configurations without FK enforcement stay
 *    supported;
 *  - every create is guarded by hasTable so re-running is a no-op;
 *  - nothing is ever dropped or renamed here.
 *
 * Negotiation offers and case timeline events are intentionally
 * insert-only (no status/updated_at column): "never modify an old offer" is
 * enforced by the schema itself, not just by application code. Current state
 * is always derived by NegotiationService/TimelineService from the full
 * history, never by mutating a row in place.
 */
final class InitialMigration implements Migration
{
    public function version() { return '1.0.0'; }

    public function description() { return 'Create domain brokerage cases/providers/assignments/offers/messages/events/payments/transfers/documents/fees/settings/provider-calls tables'; }

    public function up()
    {
        if (!Capsule::schema()->hasTable('mod_cloudhost247_broker_cases')) {
            Capsule::schema()->create('mod_cloudhost247_broker_cases', function ($t) {
                $t->bigIncrements('id');
                $t->string('case_number', 24)->unique('ch247_broker_case_number_unique');
                $t->unsignedBigInteger('client_id')->index('ch247_broker_case_client_idx');
                $t->string('domain', 255)->index('ch247_broker_case_domain_idx');
                $t->string('tld', 24)->default('');
                $t->string('registrar', 120)->nullable();
                $t->string('registry_status', 191)->nullable();
                $t->string('domain_status', 24)->default('unknown');
                $t->boolean('privacy_protected')->nullable();
                $t->string('acquisition_route', 12)->default('unassigned')->index('ch247_broker_case_route_idx');
                $t->string('provider_key', 32)->default('');
                $t->string('status', 32)->default('request_submitted')->index('ch247_broker_case_status_idx');
                $t->unsignedBigInteger('assigned_admin_id')->nullable()->index('ch247_broker_case_assigned_idx');
                $t->decimal('max_budget', 14, 2);
                $t->string('currency', 8)->default('USD');
                $t->decimal('opening_offer', 14, 2)->nullable();
                $t->boolean('disclose_budget_to_seller')->default(false);
                $t->dateTime('deadline')->nullable();
                $t->text('customer_message')->nullable();
                $t->text('negotiation_instructions')->nullable();
                $t->dateTime('terms_accepted_at')->nullable();
                $t->string('payment_status', 24)->default('pending')->index('ch247_broker_case_payment_status_idx');
                $t->string('transfer_status', 24)->default('not_started')->index('ch247_broker_case_transfer_status_idx');
                $t->boolean('disputed')->default(false)->index('ch247_broker_case_disputed_idx');
                $t->string('cancelled_reason', 255)->nullable();
                $t->string('failure_reason', 255)->nullable();
                $t->string('idempotency_key', 80)->nullable()->unique('ch247_broker_case_idempotency_unique');
                $t->dateTime('created_at')->index('ch247_broker_case_created_idx');
                $t->dateTime('updated_at')->nullable();
                $t->dateTime('deleted_at')->nullable();
            });
        }

        if (!Capsule::schema()->hasTable('mod_cloudhost247_broker_providers')) {
            Capsule::schema()->create('mod_cloudhost247_broker_providers', function ($t) {
                $t->bigIncrements('id');
                $t->string('provider_key', 32)->unique('ch247_broker_provider_key_unique');
                $t->integer('priority')->default(100);
                $t->boolean('enabled')->default(false);
                $t->boolean('partner_agreement_confirmed')->default(false);
                $t->string('agreement_reference', 191)->default('');
                $t->text('notes')->nullable();
                $t->dateTime('created_at')->nullable();
                $t->dateTime('updated_at')->nullable();
            });
        }

        if (!Capsule::schema()->hasTable('mod_cloudhost247_broker_assignments')) {
            Capsule::schema()->create('mod_cloudhost247_broker_assignments', function ($t) {
                $t->bigIncrements('id');
                $t->unsignedBigInteger('case_id')->index('ch247_broker_assign_case_idx');
                $t->unsignedBigInteger('admin_id')->index('ch247_broker_assign_admin_idx');
                $t->unsignedBigInteger('assigned_by_admin_id')->default(0);
                $t->string('action', 16)->default('assigned'); // assigned|unassigned
                $t->string('note', 500)->default('');
                $t->dateTime('created_at')->index('ch247_broker_assign_created_idx');
            });
        }

        if (!Capsule::schema()->hasTable('mod_cloudhost247_broker_offers')) {
            Capsule::schema()->create('mod_cloudhost247_broker_offers', function ($t) {
                $t->bigIncrements('id');
                $t->unsignedBigInteger('case_id')->index('ch247_broker_offer_case_idx');
                $t->decimal('amount', 14, 2);
                $t->string('currency', 8);
                $t->string('kind', 16)->default('offer'); // offer|counteroffer
                $t->string('from_party', 16); // customer|broker|seller|provider|system
                $t->string('to_party', 16);
                $t->string('source', 16)->default('broker'); // customer|broker|seller|provider|system
                $t->string('provider_key', 32)->default('');
                $t->unsignedBigInteger('created_by_admin_id')->nullable();
                $t->unsignedBigInteger('created_by_client_id')->nullable();
                $t->dateTime('expires_at')->nullable();
                $t->string('correlation_id', 64)->default('');
                $t->string('idempotency_key', 80)->nullable()->unique('ch247_broker_offer_idempotency_unique');
                $t->dateTime('created_at')->index('ch247_broker_offer_created_idx');
            });
        }

        if (!Capsule::schema()->hasTable('mod_cloudhost247_broker_messages')) {
            Capsule::schema()->create('mod_cloudhost247_broker_messages', function ($t) {
                $t->bigIncrements('id');
                $t->unsignedBigInteger('case_id')->index('ch247_broker_msg_case_idx');
                $t->string('author_type', 16); // customer|broker|system
                $t->unsignedBigInteger('author_id')->nullable();
                $t->text('body');
                $t->string('visibility', 16)->default('customer')->index('ch247_broker_msg_visibility_idx'); // customer|internal
                $t->unsignedBigInteger('attachment_document_id')->nullable();
                $t->dateTime('created_at')->index('ch247_broker_msg_created_idx');
            });
        }

        if (!Capsule::schema()->hasTable('mod_cloudhost247_broker_events')) {
            Capsule::schema()->create('mod_cloudhost247_broker_events', function ($t) {
                $t->bigIncrements('id');
                $t->unsignedBigInteger('case_id')->index('ch247_broker_event_case_idx');
                $t->string('event_type', 64)->index('ch247_broker_event_type_idx');
                $t->string('visibility', 16)->default('customer'); // customer|internal
                $t->string('actor_type', 16)->default('system'); // system|customer|admin|provider
                $t->unsignedBigInteger('actor_id')->nullable();
                $t->string('summary', 500);
                $t->text('metadata_json')->nullable();
                $t->dateTime('created_at')->index('ch247_broker_event_created_idx');
            });
        }

        if (!Capsule::schema()->hasTable('mod_cloudhost247_broker_payments')) {
            Capsule::schema()->create('mod_cloudhost247_broker_payments', function ($t) {
                $t->bigIncrements('id');
                $t->unsignedBigInteger('case_id')->index('ch247_broker_payment_case_idx');
                $t->unsignedBigInteger('whmcs_invoice_id')->nullable()->unique('ch247_broker_payment_invoice_unique');
                $t->decimal('acquisition_price', 14, 2)->default(0);
                $t->decimal('brokerage_fee', 14, 2)->default(0);
                $t->decimal('transfer_fee', 14, 2)->default(0);
                $t->decimal('service_fee', 14, 2)->default(0);
                $t->decimal('amount_total', 14, 2)->default(0);
                $t->string('currency', 8);
                $t->string('status', 24)->default('pending')->index('ch247_broker_payment_status_idx'); // pending|initiated|authorized|paid|failed|refunded|cancelled
                $t->string('gateway', 64)->default('');
                $t->string('idempotency_key', 80)->unique('ch247_broker_payment_idempotency_unique');
                $t->string('failure_reason', 255)->default('');
                $t->dateTime('paid_at')->nullable();
                $t->dateTime('refunded_at')->nullable();
                $t->dateTime('created_at')->nullable();
                $t->dateTime('updated_at')->nullable();
            });
        }

        if (!Capsule::schema()->hasTable('mod_cloudhost247_broker_transfers')) {
            Capsule::schema()->create('mod_cloudhost247_broker_transfers', function ($t) {
                $t->bigIncrements('id');
                $t->unsignedBigInteger('case_id')->index('ch247_broker_transfer_case_idx');
                $t->string('registrar', 120)->nullable();
                $t->string('provider_key', 32)->default('');
                $t->string('status', 24)->default('not_started')->index('ch247_broker_transfer_status_idx');
                $t->string('auth_code_status', 24)->default('not_required'); // not_required|pending|received|invalid
                $t->string('provider_reference', 120)->default('');
                $t->string('destination_account', 120)->default('');
                $t->dateTime('initiated_at')->nullable();
                $t->dateTime('provider_confirmed_at')->nullable();
                $t->dateTime('verified_at')->nullable();
                $t->dateTime('completed_at')->nullable();
                $t->string('failure_reason', 255)->default('');
                $t->string('idempotency_key', 80)->nullable()->unique('ch247_broker_transfer_idempotency_unique');
                $t->dateTime('created_at')->nullable();
                $t->dateTime('updated_at')->nullable();
            });
        }

        if (!Capsule::schema()->hasTable('mod_cloudhost247_broker_documents')) {
            Capsule::schema()->create('mod_cloudhost247_broker_documents', function ($t) {
                $t->bigIncrements('id');
                $t->unsignedBigInteger('case_id')->index('ch247_broker_doc_case_idx');
                $t->string('uploaded_by_type', 16); // customer|admin
                $t->unsignedBigInteger('uploaded_by_id')->nullable();
                $t->string('label', 191);
                $t->string('stored_name', 191);
                $t->string('mime_type', 120)->default('');
                $t->unsignedBigInteger('size_bytes')->default(0);
                $t->string('visibility', 16)->default('customer');
                $t->string('sha256', 64)->default('');
                $t->dateTime('created_at')->nullable();
            });
        }

        if (!Capsule::schema()->hasTable('mod_cloudhost247_broker_fees')) {
            Capsule::schema()->create('mod_cloudhost247_broker_fees', function ($t) {
                $t->bigIncrements('id');
                $t->string('name', 120);
                $t->string('fee_type', 16); // fixed|percentage
                $t->string('applies_to', 24); // brokerage_fee|transfer_fee|service_fee
                $t->decimal('amount', 14, 4);
                $t->decimal('min_amount', 14, 2)->nullable();
                $t->string('currency', 8)->nullable();
                $t->string('provider_key', 32)->nullable();
                $t->boolean('enabled')->default(true);
                $t->dateTime('created_at')->nullable();
                $t->dateTime('updated_at')->nullable();
            });
        }

        if (!Capsule::schema()->hasTable('mod_cloudhost247_broker_settings')) {
            Capsule::schema()->create('mod_cloudhost247_broker_settings', function ($t) {
                $t->bigIncrements('id');
                $t->string('setting_key', 120)->unique('ch247_broker_setting_key_unique');
                $t->text('setting_value')->nullable();
                $t->dateTime('updated_at')->nullable();
            });
        }

        if (!Capsule::schema()->hasTable('mod_cloudhost247_broker_provider_calls')) {
            Capsule::schema()->create('mod_cloudhost247_broker_provider_calls', function ($t) {
                $t->bigIncrements('id');
                $t->unsignedBigInteger('case_id')->default(0)->index('ch247_broker_call_case_idx');
                $t->string('provider_key', 32);
                $t->string('operation', 64);
                $t->string('idempotency_key', 100);
                $t->string('correlation_id', 64)->default('');
                $t->string('result_code', 32)->default('');
                $t->integer('http_status')->nullable();
                $t->integer('latency_ms')->nullable();
                $t->dateTime('created_at')->index('ch247_broker_call_created_idx');
                $t->unique(array('provider_key', 'operation', 'idempotency_key'), 'ch247_broker_call_idempotency_unique');
            });
        }
    }
}
