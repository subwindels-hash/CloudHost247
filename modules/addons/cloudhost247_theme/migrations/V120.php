<?php
namespace CloudHost247\Theme\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

/**
 * Landing-page content tables.
 *
 * Installations that previously ran the retired vendor page builder receive
 * these tables by rename from scripts/migrate-legacy-names-to-cloudhost247.sql,
 * which preserves every row and the vendor column layout. Fresh installations
 * have no vendor tables, so this migration creates the same names empty and the
 * public landing pages resolve against an empty set instead of erroring.
 */
final class ThemeLandingContentMigration implements Migration
{
    public function version() { return '1.2.0'; }
    public function description() { return 'Create landing-page content tables for fresh installations'; }
    public function up()
    {
        if (!Capsule::schema()->hasTable('mod_cloudhost247_theme_pages')) {
            Capsule::schema()->create('mod_cloudhost247_theme_pages', function ($t) {
                $t->bigIncrements('id');
                $t->string('pageTitle', 191)->unique();
                $t->integer('productGroup')->default(0);
                $t->text('metaDescription')->nullable();
                $t->dateTime('created_at')->nullable();
                $t->dateTime('updated_at')->nullable();
            });
        }
        if (!Capsule::schema()->hasTable('mod_cloudhost247_theme_page_products')) {
            Capsule::schema()->create('mod_cloudhost247_theme_page_products', function ($t) {
                $t->bigIncrements('id');
                $t->integer('pageId')->default(0);
                $t->integer('productId')->default(0);
                $t->text('pHeadSortDesc')->nullable();
                $t->text('pDescription')->nullable();
                $t->text('pFootCaption')->nullable();
                $t->text('pFootSortDesc')->nullable();
                $t->index(array('pageId', 'productId'), 'ch247_theme_page_product');
            });
        }
        if (!Capsule::schema()->hasTable('mod_cloudhost247_theme_dynamic_translation')) {
            Capsule::schema()->create('mod_cloudhost247_theme_dynamic_translation', function ($t) {
                $t->bigIncrements('id');
                $t->string('related_type', 191);
                $t->string('related_id', 191);
                $t->string('language', 40);
                $t->text('value')->nullable();
                $t->index(array('related_type', 'related_id', 'language'), 'ch247_theme_translation_lookup');
            });
        }
    }
}
