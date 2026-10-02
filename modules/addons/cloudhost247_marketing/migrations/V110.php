<?php
namespace CloudHost247\Marketing\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

/**
 * Marketing 1.1.0 — subscriber tagging.
 *
 * SESSION 2 needs tags (import mapping, list-free organisation, segment rules).
 * The 1.0.0 schema stores free-form subscriber fields but has no tag tables, so
 * this migration adds exactly two, both hasTable-guarded:
 *
 *   mod_cloudhost247_marketing_tags            — one row per tag, unique key
 *   mod_cloudhost247_marketing_subscriber_tags — the assignment join, unique pair
 *
 * Additive only: nothing is dropped, renamed or altered, no WHMCS core table is
 * touched, and deactivating the module retains both tables.
 */
final class TagMigration implements Migration
{
    public function version() { return '1.1.0'; }
    public function description() { return 'Add subscriber tag tables'; }

    public function up()
    {
        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_tags')) Capsule::schema()->create('mod_cloudhost247_marketing_tags', function ($t) {
            $t->bigIncrements('id');
            $t->string('tag_key', 64)->unique();
            $t->string('name', 128);
            $t->dateTime('created_at');
            $t->dateTime('updated_at');
        });

        if (!Capsule::schema()->hasTable('mod_cloudhost247_marketing_subscriber_tags')) Capsule::schema()->create('mod_cloudhost247_marketing_subscriber_tags', function ($t) {
            $t->bigIncrements('id');
            $t->unsignedBigInteger('subscriber_id');
            $t->unsignedBigInteger('tag_id');
            $t->dateTime('assigned_at');
            $t->unique(array('subscriber_id', 'tag_id'), 'ch247_mkt_subscriber_tags_unique');
            $t->index('tag_id', 'ch247_mkt_subscriber_tags_tag');
        });
    }
}
