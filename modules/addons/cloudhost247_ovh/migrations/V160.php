<?php
namespace CloudHost247\Ovh\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

/**
 * Let an OVH endpoint resolve its credentials from the central CloudHost247
 * API & Integrations vault instead of the WHMCS server record.
 *
 * Additive and opt-in: existing endpoints keep the legacy resolution path
 * until an administrator selects a central integration for them.
 */
final class CentralCredentialMigration implements Migration
{
    public function version() { return '1.6.0'; }

    public function description() { return 'Allow OVH endpoints to resolve credentials from the central integration vault'; }

    public function up()
    {
        $schema = Capsule::schema();
        if (!$schema->hasTable('mod_cloudhost247_ovh_endpoints')) {
            throw new \RuntimeException('OVH endpoint table must exist before 1.6.0.');
        }
        if (!$schema->hasColumn('mod_cloudhost247_ovh_endpoints', 'integration_key')) {
            $schema->table('mod_cloudhost247_ovh_endpoints', function ($t) {
                $t->string('integration_key', 64)->nullable()->index();
            });
        }
        if (!$schema->hasColumn('mod_cloudhost247_ovh_endpoints', 'integration_environment')) {
            $schema->table('mod_cloudhost247_ovh_endpoints', function ($t) {
                $t->string('integration_environment', 16)->nullable();
            });
        }
    }
}
