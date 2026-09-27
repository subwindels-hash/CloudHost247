<?php
namespace CloudHost247\Theme\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

final class ThemeLocalizationMigration implements Migration
{
    public function version() { return '1.1.0'; }
    public function description() { return 'Create localized CMS content repository'; }
    public function up()
    {
        if (!Capsule::schema()->hasTable('mod_cloudhost247_theme_translations')) {
            Capsule::schema()->create('mod_cloudhost247_theme_translations', function ($table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('content_id');
                $table->string('locale', 20);
                $table->string('title', 255);
                $table->text('payload_json')->nullable();
                $table->dateTime('updated_at');
                $table->unique(array('content_id', 'locale'), 'ch247_theme_translation_unique');
            });
        }
    }
}
