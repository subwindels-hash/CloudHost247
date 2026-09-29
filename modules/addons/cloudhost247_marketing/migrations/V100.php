<?php
namespace CloudHost247\Marketing\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

/**
 * Marketing 1.0.0 — the complete campaign-platform schema
 * (mod_cloudhost247_marketing_*). Every CREATE is hasTable-guarded, so
 * re-running activation is a no-op; nothing is dropped or renamed, and no
 * WHMCS core table is ever touched.
 */
final class InitialMigration implements Migration
{
    public function version() { return '1.0.0'; }
    public function description() { return 'Create email marketing campaign platform tables'; }

    public function up()
    {
        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_campaigns')) Capsule::schema()->create('mod_cloudhost247_marketing_campaigns', function ($t) {
            $t->bigIncrements('id');
            $t->string('name', 128);
            $t->string('subject', 255)->default('');
            $t->string('preview_text', 255)->default('');
            $t->string('from_name', 128)->default('');
            $t->string('from_email', 190)->default('');
            $t->string('reply_to', 190)->default('');
            $t->unsignedBigInteger('template_id')->nullable();
            $t->longText('design_json')->nullable();
            $t->longText('html')->nullable();
            $t->longText('text')->nullable();
            $t->string('audience_type', 16)->default('list'); // list|segment|all_subscribers
            $t->unsignedBigInteger('audience_id')->nullable();
            $t->string('status', 16)->default('draft')->index();
            $t->dateTime('scheduled_at')->nullable()->index();
            $t->string('scheduled_timezone', 64)->default('UTC');
            $t->dateTime('started_at')->nullable();
            $t->dateTime('completed_at')->nullable();
            $t->dateTime('failed_at')->nullable();
            $t->string('failure_reason', 255)->default('');
            $t->unsignedBigInteger('created_by')->default(0);
            $t->string('idempotency_key', 100)->unique();
            $t->dateTime('created_at');
            $t->dateTime('updated_at');
            $t->index(array('status', 'scheduled_at'), 'ch247_mkt_campaigns_dispatch');
        });

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_subscribers')) Capsule::schema()->create('mod_cloudhost247_marketing_subscribers', function ($t) {
            $t->bigIncrements('id');
            $t->string('email', 190)->unique();
            $t->string('first_name', 64)->default('');
            $t->string('last_name', 64)->default('');
            $t->string('company', 128)->default('');
            $t->string('phone', 32)->default('');
            $t->string('country', 2)->default('');
            $t->text('fields_json')->nullable();
            $t->string('status', 16)->default('subscribed')->index();
            $t->string('consent_status', 16)->default('unknown'); // granted|revoked|unknown
            $t->dateTime('consent_at')->nullable();
            $t->string('consent_source', 64)->default('');
            $t->unsignedBigInteger('client_id')->nullable()->index();
            $t->string('source', 32)->default('manual'); // manual|import|whmcs_client
            $t->string('bounce_type', 8)->default('');   // hard|soft|''
            $t->unsignedInteger('bounce_count')->default(0);
            $t->dateTime('bounced_at')->nullable();
            $t->dateTime('last_activity_at')->nullable();
            $t->dateTime('created_at');
            $t->dateTime('updated_at');
        });

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_lists')) Capsule::schema()->create('mod_cloudhost247_marketing_lists', function ($t) {
            $t->bigIncrements('id');
            $t->string('list_key', 64)->unique();
            $t->string('name', 128);
            $t->string('description', 255)->default('');
            $t->string('status', 16)->default('active')->index(); // active|archived
            $t->dateTime('created_at');
            $t->dateTime('updated_at');
        });

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_list_members')) Capsule::schema()->create('mod_cloudhost247_marketing_list_members', function ($t) {
            $t->bigIncrements('id');
            $t->unsignedBigInteger('list_id');
            $t->unsignedBigInteger('subscriber_id');
            $t->dateTime('added_at');
            $t->unique(array('list_id', 'subscriber_id'), 'ch247_mkt_members_unique');
            $t->index('subscriber_id', 'ch247_mkt_members_subscriber');
        });

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_segments')) Capsule::schema()->create('mod_cloudhost247_marketing_segments', function ($t) {
            $t->bigIncrements('id');
            $t->string('segment_key', 64)->unique();
            $t->string('name', 128);
            $t->string('description', 255)->default('');
            $t->text('definition_json')->nullable();
            $t->string('status', 16)->default('active')->index(); // active|archived
            $t->integer('cached_count')->nullable();
            $t->dateTime('cached_at')->nullable();
            $t->dateTime('created_at');
            $t->dateTime('updated_at');
        });

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_templates')) Capsule::schema()->create('mod_cloudhost247_marketing_templates', function ($t) {
            $t->bigIncrements('id');
            $t->string('template_key', 64)->unique();
            $t->string('name', 128);
            $t->string('category', 32)->default('general');
            $t->longText('design_json')->nullable();
            $t->longText('html')->nullable();
            $t->longText('text')->nullable();
            $t->string('source', 16)->default('custom'); // builtin|custom|campaign
            $t->unsignedBigInteger('source_campaign_id')->nullable();
            $t->dateTime('created_at');
            $t->dateTime('updated_at');
        });

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_campaign_recipients')) Capsule::schema()->create('mod_cloudhost247_marketing_campaign_recipients', function ($t) {
            $t->bigIncrements('id');
            $t->unsignedBigInteger('campaign_id');
            $t->unsignedBigInteger('subscriber_id')->nullable();
            $t->string('email', 190);
            $t->text('personal_json')->nullable(); // pre-resolved personalization values, whitelisted fields only
            $t->string('status', 16)->default('pending')->index(); // pending|queued|sent|failed|skipped
            $t->string('skip_reason', 64)->default('');
            $t->dateTime('created_at');
            $t->unique(array('campaign_id', 'email'), 'ch247_mkt_recipients_unique');
            $t->index('subscriber_id', 'ch247_mkt_recipients_subscriber');
        });

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_email_queue')) Capsule::schema()->create('mod_cloudhost247_marketing_email_queue', function ($t) {
            $t->bigIncrements('id');
            $t->unsignedBigInteger('campaign_id');
            $t->unsignedBigInteger('recipient_id')->nullable();
            $t->unsignedBigInteger('subscriber_id')->nullable();
            $t->string('email', 190);
            $t->string('idempotency_key', 100)->unique();
            $t->string('provider_key', 32)->default('cpanel_smtp');
            $t->string('status', 16)->default('queued');
            $t->unsignedInteger('attempts')->default(0);
            $t->unsignedInteger('max_attempts')->default(3);
            $t->dateTime('next_attempt_at')->nullable();
            $t->dateTime('locked_until')->nullable();
            $t->string('locked_by', 64)->default('');
            $t->string('tracking_token', 64)->unique();
            $t->string('message_id', 255)->default('');
            $t->dateTime('sent_at')->nullable();
            $t->dateTime('failed_at')->nullable();
            $t->string('last_error_kind', 32)->default('');
            $t->string('last_error', 255)->default('');
            $t->dateTime('scheduled_at');
            $t->dateTime('created_at');
            $t->dateTime('updated_at');
            $t->index(array('status', 'next_attempt_at'), 'ch247_mkt_queue_pick');
            $t->index(array('campaign_id', 'status'), 'ch247_mkt_queue_campaign');
            $t->index('email', 'ch247_mkt_queue_email');
        });

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_email_events')) Capsule::schema()->create('mod_cloudhost247_marketing_email_events', function ($t) {
            $t->bigIncrements('id');
            $t->unsignedBigInteger('campaign_id')->nullable();
            $t->unsignedBigInteger('queue_id')->nullable();
            $t->unsignedBigInteger('subscriber_id')->nullable();
            $t->string('type', 24);
            $t->text('meta_json')->nullable(); // sanitized only: kinds, sanitized link ids/hashes, token-derived refs
            $t->dateTime('occurred_at');
            $t->index(array('campaign_id', 'type'), 'ch247_mkt_events_campaign');
            $t->index(array('type', 'occurred_at'), 'ch247_mkt_events_timeline');
            $t->index('queue_id', 'ch247_mkt_events_queue');
            $t->index('subscriber_id', 'ch247_mkt_events_subscriber');
        });

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_suppressions')) Capsule::schema()->create('mod_cloudhost247_marketing_suppressions', function ($t) {
            $t->bigIncrements('id');
            $t->string('email', 190)->unique();
            $t->string('reason', 24)->index();
            $t->string('source', 32)->default('system'); // system|admin|bounce|recipient
            $t->string('detail', 255)->default('');
            $t->dateTime('created_at')->index();
            $t->dateTime('updated_at');
        });

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_automations')) Capsule::schema()->create('mod_cloudhost247_marketing_automations', function ($t) {
            $t->bigIncrements('id');
            $t->string('automation_key', 64)->unique();
            $t->string('name', 128);
            $t->string('trigger_key', 48)->index();
            $t->string('status', 16)->default('draft')->index(); // draft|active|paused|archived
            $t->dateTime('created_at');
            $t->dateTime('updated_at');
        });

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_automation_steps')) Capsule::schema()->create('mod_cloudhost247_marketing_automation_steps', function ($t) {
            $t->bigIncrements('id');
            $t->unsignedBigInteger('automation_id');
            $t->unsignedInteger('step_no');
            $t->string('type', 16); // email|wait
            $t->text('params_json')->nullable();
            $t->unique(array('automation_id', 'step_no'), 'ch247_mkt_steps_unique');
        });

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_automation_runs')) Capsule::schema()->create('mod_cloudhost247_marketing_automation_runs', function ($t) {
            $t->bigIncrements('id');
            $t->unsignedBigInteger('automation_id');
            $t->string('context_key', 64);
            $t->text('context_json')->nullable();
            $t->unsignedInteger('step_no')->default(0);
            $t->string('status', 16)->default('active')->index(); // active|waiting|completed|stopped|failed
            $t->dateTime('due_at')->nullable()->index();
            $t->dateTime('created_at');
            $t->dateTime('updated_at');
            $t->unique(array('automation_id', 'context_key'), 'ch247_mkt_runs_unique');
        });

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_imports')) Capsule::schema()->create('mod_cloudhost247_marketing_imports', function ($t) {
            $t->bigIncrements('id');
            $t->string('source_label', 190)->default('');
            $t->text('mapping_json')->nullable();
            $t->text('totals_json')->nullable();
            $t->string('status', 16)->default('started')->index(); // started|mapped|imported|failed
            $t->unsignedBigInteger('admin_id')->default(0);
            $t->dateTime('created_at');
            $t->dateTime('finished_at')->nullable();
        });

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_links')) Capsule::schema()->create('mod_cloudhost247_marketing_links', function ($t) {
            $t->bigIncrements('id');
            $t->unsignedBigInteger('campaign_id');
            $t->string('url_hash', 64);
            $t->string('url', 255);
            $t->string('label', 255)->default('');
            $t->dateTime('created_at');
            $t->unique(array('campaign_id', 'url_hash'), 'ch247_mkt_links_unique');
        });

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_settings')) Capsule::schema()->create('mod_cloudhost247_marketing_settings', function ($t) {
            $t->bigIncrements('id');
            $t->string('setting_key', 64)->unique();
            $t->text('setting_value')->nullable();
            $t->dateTime('updated_at');
        });
    }
}
