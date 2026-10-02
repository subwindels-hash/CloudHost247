<?php
namespace CloudHost247\Ovh\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

/**
 * Caches which catalog specification fields the module could prove for a WHMCS
 * hosting product, so the product screen can render the same store it would save.
 *
 * The saved value stays authoritative; this column is the evidence behind it.
 */
final class ProductSpecificationEvidenceMigration implements Migration
{
    public function version() { return '1.8.0'; }

    public function description() { return 'Store the provenance of each auto-filled product specification field'; }

    public function up()
    {
        $schema = Capsule::schema();
        if (!$schema->hasTable('mod_cloudhost247_hosting_products')) {
            throw new \RuntimeException('The hosting-product table must exist before 1.8.0.');
        }
        if (!$schema->hasColumn('mod_cloudhost247_hosting_products', 'specification_sources_json')) {
            $schema->table('mod_cloudhost247_hosting_products', function ($t) {
                $t->text('specification_sources_json')->nullable();
            });
        }
    }
}
