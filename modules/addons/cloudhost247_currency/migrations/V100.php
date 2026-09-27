<?php
namespace CloudHost247\Currency\Migrations;
use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;
final class CurrencyInitialMigration implements Migration
{
    public function version() { return '1.0.0'; }
    public function description() { return 'Create independent providers/runs/rates tables'; }
    public function up()
    {
        if (!Capsule::schema()->hasTable('mod_cloudhost247_currency_providers')) Capsule::schema()->create('mod_cloudhost247_currency_providers', function ($t) { $t->bigIncrements('id'); $t->string('provider_key', 64)->unique(); $t->string('display_name', 128); $t->boolean('enabled')->default(false); $t->text('configuration_json')->nullable(); $t->integer('priority')->default(100); $t->dateTime('updated_at')->nullable(); });
        if (!Capsule::schema()->hasTable('mod_cloudhost247_currency_runs')) Capsule::schema()->create('mod_cloudhost247_currency_runs', function ($t) { $t->bigIncrements('id'); $t->string('trigger_type', 20); $t->string('status', 20)->index(); $t->string('base_currency', 3); $t->integer('rate_count')->default(0); $t->text('error_message')->nullable(); $t->dateTime('started_at'); $t->dateTime('finished_at')->nullable(); });
        if (!Capsule::schema()->hasTable('mod_cloudhost247_currency_rates')) Capsule::schema()->create('mod_cloudhost247_currency_rates', function ($t) { $t->bigIncrements('id'); $t->unsignedBigInteger('run_id'); $t->string('currency_code', 3); $t->decimal('provider_rate', 24, 12); $t->decimal('effective_rate', 24, 12); $t->decimal('margin_percent', 10, 4)->default(0); $t->integer('precision_digits')->default(6); $t->dateTime('observed_at'); $t->index(array('currency_code','observed_at'), 'ch247_currency_history'); });
    }
}
