<?php
namespace CloudHost247\Ovh\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

/**
 * Records whether a confirmed configurable-option mapping was *proved* by the
 * discovered OVH catalog value list, or was entered by an administrator against
 * a payload shape the module could not read.
 *
 * Additive and defaulted: existing rows keep their meaning (unknown provenance)
 * and are reported as not verified rather than silently upgraded to proven.
 */
final class OptionVerificationMigration implements Migration
{
    public function version() { return '1.7.0'; }

    public function description() { return 'Track whether configurable-option mappings were verified against the discovered catalog'; }

    public function up()
    {
        $schema = Capsule::schema();
        if (!$schema->hasTable('mod_cloudhost247_ovh_option_mappings')) {
            throw new \RuntimeException('The option-mapping table must exist before 1.7.0.');
        }
        if (!$schema->hasColumn('mod_cloudhost247_ovh_option_mappings', 'verified')) {
            $schema->table('mod_cloudhost247_ovh_option_mappings', function ($t) {
                $t->boolean('verified')->default(false);
            });
        }
    }
}
