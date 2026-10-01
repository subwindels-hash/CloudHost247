<?php
namespace CloudHost247\Marketing\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

/**
 * Marketing 1.2.0 — template library lifecycle.
 *
 * SESSION 4 needs templates that can be retired without being destroyed: a
 * campaign copied a template's HTML into its own row, but the library entry may
 * still be referenced by analytics and by an operator's mental model of what was
 * sent. The 1.0.0 `templates` table therefore gains one nullable-safe status
 * column, defaulting to `active`, added only when it is missing.
 *
 * Additive only: no table is dropped, renamed or altered beyond this column, no
 * WHMCS core table is touched, and deactivating the module retains everything.
 */
final class TemplateMigration implements Migration
{
    public function version() { return '1.2.0'; }
    public function description() { return 'Add template status column'; }

    public function up()
    {
        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_templates')) { return; }
        if (!Capsule::schema()->hasColumn('mod_cloudhost247_marketing_templates', 'status')) {
            Capsule::schema()->table('mod_cloudhost247_marketing_templates', function ($t) {
                $t->string('status', 16)->default('active')->index();
            });
        }
    }
}
