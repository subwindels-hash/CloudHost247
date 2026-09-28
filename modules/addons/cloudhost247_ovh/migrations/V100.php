<?php
namespace CloudHost247\Ovh\Migrations;
use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;
final class OvhInitialMigration implements Migration
{
    public function version() { return '1.0.0'; }
    public function description() { return 'Create independent endpoints/mappings/jobs tables'; }
    public function up()
    {
        if (!Capsule::schema()->hasTable('mod_cloudhost247_ovh_endpoints')) Capsule::schema()->create('mod_cloudhost247_ovh_endpoints', function ($t) { $t->bigIncrements('id'); $t->string('name', 100); $t->string('region', 32); $t->string('api_endpoint', 255); $t->unsignedInteger('server_id')->nullable(); $t->boolean('enabled')->default(false); $t->dateTime('updated_at')->nullable(); });
        if (!Capsule::schema()->hasTable('mod_cloudhost247_ovh_mappings')) Capsule::schema()->create('mod_cloudhost247_ovh_mappings', function ($t) { $t->bigIncrements('id'); $t->string('mapping_type', 32); $t->string('remote_id', 191); $t->unsignedBigInteger('whmcs_id')->nullable(); $t->text('metadata_json')->nullable(); $t->dateTime('last_seen_at')->nullable(); $t->unique(array('mapping_type','remote_id'), 'ch247_ovh_mapping_unique'); });
        if (!Capsule::schema()->hasTable('mod_cloudhost247_ovh_jobs')) Capsule::schema()->create('mod_cloudhost247_ovh_jobs', function ($t) { $t->bigIncrements('id'); $t->string('job_type', 64); $t->string('status', 20)->index(); $t->string('idempotency_key', 64)->unique(); $t->text('payload_json')->nullable(); $t->unsignedInteger('attempts')->default(0); $t->dateTime('available_at'); $t->dateTime('locked_at')->nullable(); $t->dateTime('finished_at')->nullable(); $t->text('last_error')->nullable(); });
    }
}
