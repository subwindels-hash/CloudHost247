<?php
namespace CloudHost247\Theme\Migrations;
use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;
final class ThemeInitialMigration implements Migration
{
    public function version() { return '1.0.0'; }
    public function description() { return 'Create independent theme settings/content tables'; }
    public function up()
    {
        if (!Capsule::schema()->hasTable('mod_cloudhost247_theme_settings')) Capsule::schema()->create('mod_cloudhost247_theme_settings', function ($t) { $t->bigIncrements('id'); $t->string('setting_key', 100)->unique(); $t->text('setting_value')->nullable(); $t->string('value_type', 24)->default('string'); $t->dateTime('updated_at')->nullable(); });
        if (!Capsule::schema()->hasTable('mod_cloudhost247_theme_content')) Capsule::schema()->create('mod_cloudhost247_theme_content', function ($t) { $t->bigIncrements('id'); $t->string('content_type', 32)->index(); $t->string('slug', 191); $t->string('title', 255); $t->text('payload_json')->nullable(); $t->boolean('published')->default(false); $t->integer('sort_order')->default(0); $t->dateTime('created_at'); $t->dateTime('updated_at'); $t->unique(array('content_type','slug'), 'ch247_theme_content_unique'); });
    }
}
