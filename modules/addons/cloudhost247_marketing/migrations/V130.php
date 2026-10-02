<?php
namespace CloudHost247\Marketing\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

/**
 * Marketing 1.2.0 — automation (SESSION 10).
 *
 * Three new tables (automations, their steps, and one run per enrolled
 * subscriber), plus two additive columns on existing tables:
 *
 *  * `campaigns.origin` — an automation needs somewhere to keep its links and
 *    its ledger rows. Rather than inventing a second delivery engine, every
 *    automation owns one long-lived container campaign (`origin='automation'`,
 *    status `sending`) whose queue, tracking, suppression and analytics paths
 *    are the ones the module already proves. `origin` defaults to `campaign`, so
 *    every pre-existing row keeps its meaning and the Campaigns screen can hide
 *    containers it never asked for.
 *  * `email_queue.automation_run_id` + `automation_step_position` — the queue row
 *    knows which run and which step it belongs to, so the delivery pass composes
 *    that step's own template (instead of the container's empty content) whatever
 *    the run has done since, and the automation report can attribute every
 *    message.
 *
 * Additive only: no table is dropped or renamed, no column changes type, every
 * statement is guarded by hasTable/hasColumn, and deactivating the module
 * retains all of it.
 */
final class AutomationMigration implements Migration
{
    public function version() { return '1.3.0'; }
    public function description() { return 'Add automation tables, campaign origin and queue run linkage'; }

    public function up()
    {
        if (Capsule::schema()->hasTable('mod_cloudhost247_marketing_campaigns')
            && !Capsule::schema()->hasColumn('mod_cloudhost247_marketing_campaigns', 'origin')) {
            Capsule::schema()->table('mod_cloudhost247_marketing_campaigns', function ($t) {
                $t->string('origin', 16)->default('campaign')->index();
            });
        }

        if (Capsule::schema()->hasTable('mod_cloudhost247_marketing_email_queue')
            && !Capsule::schema()->hasColumn('mod_cloudhost247_marketing_email_queue', 'automation_run_id')) {
            Capsule::schema()->table('mod_cloudhost247_marketing_email_queue', function ($t) {
                $t->unsignedBigInteger('automation_run_id')->default(0)->index();
                // The step the message belongs to, frozen at enqueue time: a run
                // that has since moved on must still send the email it queued.
                $t->unsignedInteger('automation_step_position')->default(0);
            });
        }

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_automations')) {
            Capsule::schema()->create('mod_cloudhost247_marketing_automations', function ($t) {
                $t->bigIncrements('id');
                $t->string('name', 128);
                $t->string('description', 255)->default('');
                $t->string('status', 16)->default('draft')->index();
                $t->string('trigger_type', 32)->default('manual');
                $t->unsignedBigInteger('list_id')->nullable();
                $t->unsignedInteger('trigger_delay_minutes')->default(0);
                $t->tinyInteger('reenrollable')->default(0);
                // The container campaign that owns links, queue rows and events.
                $t->unsignedBigInteger('campaign_id')->default(0);
                $t->unsignedBigInteger('created_by')->default(0);
                $t->dateTime('activated_at')->nullable();
                $t->dateTime('paused_at')->nullable();
                $t->dateTime('archived_at')->nullable();
                $t->string('idempotency_key', 100)->unique();
                $t->dateTime('created_at');
                $t->dateTime('updated_at');
                $t->index(array('status', 'trigger_type'), 'ch247_mkt_auto_trigger');
            });
        }

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_automation_steps')) {
            Capsule::schema()->create('mod_cloudhost247_marketing_automation_steps', function ($t) {
                $t->bigIncrements('id');
                $t->unsignedBigInteger('automation_id');
                $t->unsignedInteger('position')->default(1);
                $t->string('step_type', 16); // wait|send_email
                $t->unsignedInteger('wait_minutes')->default(0);
                $t->unsignedBigInteger('template_id')->nullable();
                $t->string('subject', 255)->default('');
                $t->string('from_name', 128)->default('');
                $t->string('from_email', 190)->default('');
                $t->text('config_json')->nullable();
                $t->dateTime('created_at');
                $t->dateTime('updated_at');
                $t->unique(array('automation_id', 'position'), 'ch247_mkt_auto_step_order');
            });
        }

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_automation_runs')) {
            Capsule::schema()->create('mod_cloudhost247_marketing_automation_runs', function ($t) {
                $t->bigIncrements('id');
                $t->unsignedBigInteger('automation_id');
                $t->unsignedBigInteger('subscriber_id');
                $t->string('email', 190);
                $t->string('status', 16)->default('running')->index();
                $t->unsignedInteger('position')->default(0);
                $t->unsignedInteger('sent_count')->default(0);
                $t->dateTime('next_run_at')->nullable();
                $t->dateTime('enrolled_at');
                $t->dateTime('completed_at')->nullable();
                $t->dateTime('cancelled_at')->nullable();
                $t->string('last_error', 255)->default('');
                $t->string('enrolment_key', 190)->unique();
                $t->dateTime('created_at');
                $t->dateTime('updated_at');
                $t->index(array('status', 'next_run_at'), 'ch247_mkt_auto_due');
                $t->index(array('automation_id', 'status'), 'ch247_mkt_auto_report');
            });
        }
    }
}
