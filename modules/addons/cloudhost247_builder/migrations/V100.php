<?php
namespace CloudHost247\Builder\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

/**
 * Additive schema for the Website Builder.
 *
 * Eleven namespaced tables: pages, revisions, reusable templates, theme parts,
 * navigation menus, the media library, forms, form submissions, builder
 * settings, draft preview tokens and the builder event log. No WHMCS core
 * table is created, altered or dropped, every create is guarded by hasTable so
 * the migration is safe to re-run, and nothing here stores credential
 * material: module and provider secrets stay in the API & Integrations vault.
 */
final class BuilderInitialMigration implements Migration
{
    public function version() { return '1.0.0'; }

    public function description()
    {
        return 'Create the page, revision, template, theme part, menu, media, form, submission, settings, preview token and event tables';
    }

    public function up()
    {
        $schema = Capsule::schema();

        if (!$schema->hasTable('mod_cloudhost247_builder_pages')) {
            $schema->create('mod_cloudhost247_builder_pages', function ($table) {
                $table->bigIncrements('id');
                $table->string('slug', 120)->unique('ch247_builder_page_slug');
                $table->string('title', 200)->default('');
                // draft | scheduled | published | archived
                $table->string('status', 16)->default('draft')->index();
                // public | clients | admins
                $table->string('visibility', 16)->default('public');
                $table->string('template_key', 64)->default('');
                $table->longText('document_json')->nullable();
                $table->longText('published_json')->nullable();
                $table->unsignedBigInteger('published_revision_id')->default(0);
                $table->unsignedInteger('schema_version')->default(1);
                $table->string('seo_title', 200)->default('');
                $table->string('meta_description', 320)->default('');
                $table->string('meta_robots', 40)->default('index,follow');
                $table->string('canonical_url', 300)->default('');
                $table->unsignedBigInteger('featured_media_id')->default(0);
                $table->unsignedBigInteger('og_media_id')->default(0);
                $table->string('header_part', 64)->default('inherit');
                $table->string('footer_part', 64)->default('inherit');
                $table->boolean('is_home')->default(false);
                $table->string('draft_checksum', 64)->default('');
                $table->string('published_checksum', 64)->default('');
                $table->dateTime('publish_at')->nullable();
                $table->dateTime('published_at')->nullable();
                $table->unsignedInteger('created_by')->default(0);
                $table->unsignedInteger('updated_by')->default(0);
                $table->dateTime('created_at')->nullable();
                $table->dateTime('updated_at')->nullable();
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_builder_revisions')) {
            $schema->create('mod_cloudhost247_builder_revisions', function ($table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('page_id')->default(0)->index();
                $table->string('part_key', 64)->default('')->index();
                $table->unsignedInteger('revision_no')->default(1);
                $table->longText('document_json')->nullable();
                $table->string('title', 200)->default('');
                $table->string('status_at_save', 16)->default('draft');
                $table->string('note', 200)->default('');
                $table->string('checksum', 64)->default('');
                $table->boolean('is_autosave')->default(false);
                $table->boolean('is_published_snapshot')->default(false);
                $table->unsignedInteger('author_id')->default(0);
                $table->dateTime('created_at')->nullable();
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_builder_templates')) {
            $schema->create('mod_cloudhost247_builder_templates', function ($table) {
                $table->bigIncrements('id');
                $table->string('template_key', 64)->unique('ch247_builder_template_key');
                $table->string('name', 160)->default('');
                // page | section | header | footer | hero | pricing | contact | landing
                $table->string('category', 24)->default('section')->index();
                $table->string('description', 300)->default('');
                $table->longText('document_json')->nullable();
                $table->string('checksum', 64)->default('');
                $table->boolean('is_builtin')->default(false);
                $table->unsignedInteger('created_by')->default(0);
                $table->dateTime('created_at')->nullable();
                $table->dateTime('updated_at')->nullable();
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_builder_parts')) {
            $schema->create('mod_cloudhost247_builder_parts', function ($table) {
                $table->bigIncrements('id');
                $table->string('part_key', 64)->unique('ch247_builder_part_key');
                $table->string('name', 160)->default('');
                // header | footer | homepage | landing | blog | archive | service | error404 | auth_banner
                $table->string('part_type', 24)->default('header')->index();
                $table->longText('document_json')->nullable();
                $table->longText('published_json')->nullable();
                $table->string('status', 16)->default('draft')->index();
                $table->text('conditions_json')->nullable();
                $table->unsignedInteger('priority')->default(10);
                $table->string('draft_checksum', 64)->default('');
                $table->string('published_checksum', 64)->default('');
                $table->unsignedInteger('updated_by')->default(0);
                $table->dateTime('published_at')->nullable();
                $table->dateTime('created_at')->nullable();
                $table->dateTime('updated_at')->nullable();
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_builder_menus')) {
            $schema->create('mod_cloudhost247_builder_menus', function ($table) {
                $table->bigIncrements('id');
                $table->string('menu_key', 64)->unique('ch247_builder_menu_key');
                $table->string('name', 160)->default('');
                $table->text('items_json')->nullable();
                $table->unsignedInteger('updated_by')->default(0);
                $table->dateTime('created_at')->nullable();
                $table->dateTime('updated_at')->nullable();
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_builder_media')) {
            $schema->create('mod_cloudhost247_builder_media', function ($table) {
                $table->bigIncrements('id');
                $table->string('file_name', 200)->default('');
                $table->string('stored_path', 300)->default('');
                $table->string('url_path', 300)->default('');
                $table->string('mime', 100)->default('');
                $table->string('extension', 12)->default('');
                $table->unsignedBigInteger('size_bytes')->default(0);
                $table->unsignedInteger('width')->default(0);
                $table->unsignedInteger('height')->default(0);
                $table->string('checksum', 64)->default('')->index();
                $table->string('alt_text', 250)->default('');
                $table->string('title', 200)->default('');
                $table->string('category', 40)->default('general')->index();
                $table->unsignedInteger('uploaded_by')->default(0);
                $table->dateTime('created_at')->nullable();
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_builder_forms')) {
            $schema->create('mod_cloudhost247_builder_forms', function ($table) {
                $table->bigIncrements('id');
                $table->string('form_key', 64)->unique('ch247_builder_form_key');
                $table->string('name', 160)->default('');
                $table->text('fields_json')->nullable();
                $table->text('settings_json')->nullable();
                $table->boolean('enabled')->default(true);
                $table->unsignedInteger('submission_count')->default(0);
                $table->unsignedInteger('created_by')->default(0);
                $table->dateTime('created_at')->nullable();
                $table->dateTime('updated_at')->nullable();
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_builder_submissions')) {
            $schema->create('mod_cloudhost247_builder_submissions', function ($table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('form_id')->default(0)->index();
                $table->unsignedBigInteger('page_id')->default(0);
                $table->text('payload_json')->nullable();
                $table->unsignedInteger('client_id')->default(0);
                $table->unsignedInteger('ticket_id')->default(0);
                $table->string('status', 24)->default('received')->index();
                $table->string('notify_result', 120)->default('');
                // Hashed, never the address itself: enough to rate limit, not to profile.
                $table->string('ip_hash', 64)->default('');
                $table->string('user_agent', 200)->default('');
                $table->dateTime('created_at')->nullable();
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_builder_settings')) {
            $schema->create('mod_cloudhost247_builder_settings', function ($table) {
                $table->bigIncrements('id');
                $table->string('setting_key', 64)->unique('ch247_builder_setting_key');
                $table->longText('setting_value')->nullable();
                $table->string('value_type', 16)->default('string');
                $table->unsignedInteger('updated_by')->default(0);
                $table->dateTime('updated_at')->nullable();
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_builder_preview_tokens')) {
            $schema->create('mod_cloudhost247_builder_preview_tokens', function ($table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('page_id')->default(0)->index();
                $table->string('part_key', 64)->default('');
                // Only the hash is stored, so a leaked database row cannot be replayed.
                $table->string('token_hash', 64)->unique('ch247_builder_preview_token');
                $table->dateTime('expires_at')->nullable();
                $table->unsignedInteger('created_by')->default(0);
                $table->dateTime('created_at')->nullable();
            });
        }

        if (!$schema->hasTable('mod_cloudhost247_builder_events')) {
            $schema->create('mod_cloudhost247_builder_events', function ($table) {
                $table->bigIncrements('id');
                $table->string('event_type', 40)->default('')->index();
                $table->string('entity_type', 24)->default('');
                $table->string('entity_id', 64)->default('');
                $table->string('summary', 300)->default('');
                $table->text('metadata_json')->nullable();
                $table->string('result', 16)->default('success');
                $table->unsignedInteger('admin_id')->default(0);
                $table->string('ip_hash', 64)->default('');
                $table->string('correlation_id', 64)->default('');
                $table->dateTime('created_at')->nullable();
            });
        }
    }
}
