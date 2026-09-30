<?php
/**
 * V100 — initial Passkey schema. Idempotent and repeatable: every table,
 * column and index is created only when it does not already exist, and the
 * migration never drops or renames anything.
 *
 * Table names are written literally so the migration stays verifiable by
 * scripts/validate-migrations.py; application code uses the Schema constants.
 */

namespace CloudHost247\Passkey\Migrations;

use WHMCS\Database\Capsule;

final class V100
{
    const VERSION = 100;
    const DESCRIPTION = 'Passkey credentials, challenges, events, policies, identities, rate limits and settings';

    /** Repository-wide migration convention (see scripts/validate-migrations.py). */
    public function version() { return '1.0.0'; }

    public function description() { return self::DESCRIPTION; }

    public function up() { self::run(); }

    public static function run()
    {
        $schema = Capsule::schema();

        // ---------------------------------------------------------------- credentials
        // Holds public keys only. A private key, biometric template or device
        // PIN never leaves the authenticator and has no column here.
        if (!$schema->hasTable('mod_cloudhost247_passkey_credentials')) {
            $schema->create('mod_cloudhost247_passkey_credentials', function ($table) {
                $table->bigIncrements('id');
                $table->string('user_type', 10);
                $table->unsignedBigInteger('user_id');
                $table->text('credential_id');
                $table->string('credential_id_hash', 64);
                $table->text('public_key');
                $table->integer('algorithm');
                $table->string('credential_type', 20)->default('public-key');
                $table->unsignedBigInteger('sign_count')->default(0);
                $table->string('transports', 120)->default('');
                $table->string('aaguid', 36)->default('');
                $table->string('attestation_format', 32)->default('none');
                $table->string('device_name', 64)->default('Passkey');
                $table->unsignedTinyInteger('backup_eligible')->default(0);
                $table->unsignedTinyInteger('backup_state')->default(0);
                $table->unsignedTinyInteger('user_verified')->default(0);
                $table->string('status', 20)->default('active');
                $table->string('registration_ip', 45)->default('');
                $table->string('registration_user_agent', 255)->default('');
                $table->dateTime('last_used_at')->nullable();
                $table->string('last_used_ip', 45)->nullable();
                $table->dateTime('revoked_at')->nullable();
                $table->dateTime('disabled_at')->nullable();
                $table->dateTime('created_at');
                $table->dateTime('updated_at');
                // One authenticator credential maps to exactly one account.
                $table->unique('credential_id_hash', 'ch247pk_cred_hash_unq');
                $table->index(array('user_type', 'user_id', 'status'), 'ch247pk_cred_owner_idx');
                $table->index('last_used_at', 'ch247pk_cred_used_idx');
            });
        }

        // ---------------------------------------------------------------- challenges
        // Single-use nonces for every ceremony, plus the short-lived
        // authorizations minted after an action or reset confirmation.
        if (!$schema->hasTable('mod_cloudhost247_passkey_challenges')) {
            $schema->create('mod_cloudhost247_passkey_challenges', function ($table) {
                $table->bigIncrements('id');
                $table->string('challenge_hash', 64);
                $table->string('challenge', 255);
                $table->string('user_type', 10)->nullable();
                $table->unsignedBigInteger('user_id')->nullable();
                $table->string('challenge_type', 32);
                $table->string('action', 64)->nullable();
                $table->string('session_id', 64);
                $table->string('rp_id', 191)->default('');
                $table->text('metadata')->nullable();
                $table->dateTime('expires_at');
                $table->dateTime('consumed_at')->nullable();
                $table->dateTime('created_at');
                $table->unique('challenge_hash', 'ch247pk_chal_hash_unq');
                $table->index('expires_at', 'ch247pk_chal_exp_idx');
                $table->index(array('user_type', 'user_id'), 'ch247pk_chal_owner_idx');
            });
        }

        // ---------------------------------------------------------------- events
        // Append-only security activity log. Metadata is scrubbed before it is
        // written, so no secret can land in this table.
        if (!$schema->hasTable('mod_cloudhost247_passkey_events')) {
            $schema->create('mod_cloudhost247_passkey_events', function ($table) {
                $table->bigIncrements('id');
                $table->string('user_type', 10)->nullable();
                $table->unsignedBigInteger('user_id')->nullable();
                $table->unsignedBigInteger('passkey_id')->nullable();
                $table->string('event_type', 64);
                $table->unsignedTinyInteger('success')->default(0);
                $table->string('reason', 64)->nullable();
                $table->string('ip_address', 45)->default('');
                $table->string('user_agent', 255)->default('');
                $table->text('metadata')->nullable();
                $table->dateTime('created_at');
                $table->index(array('user_type', 'user_id', 'created_at'), 'ch247pk_evt_owner_idx');
                $table->index(array('event_type', 'created_at'), 'ch247pk_evt_type_idx');
                $table->index('created_at', 'ch247pk_evt_created_idx');
            });
        }

        // ---------------------------------------------------------------- policies
        if (!$schema->hasTable('mod_cloudhost247_passkey_policies')) {
            $schema->create('mod_cloudhost247_passkey_policies', function ($table) {
                $table->bigIncrements('id');
                $table->string('user_type', 10);
                $table->unsignedBigInteger('user_id');
                $table->string('policy', 20)->default('default');
                $table->unsignedBigInteger('updated_by')->default(0);
                $table->dateTime('created_at');
                $table->dateTime('updated_at');
                $table->unique(array('user_type', 'user_id'), 'ch247pk_pol_owner_unq');
            });
        }

        // ---------------------------------------------------------------- identities
        // Optional Microsoft Entra ID links. Stores the immutable object id,
        // never a token: access and refresh tokens are used in-request only.
        if (!$schema->hasTable('mod_cloudhost247_passkey_identities')) {
            $schema->create('mod_cloudhost247_passkey_identities', function ($table) {
                $table->bigIncrements('id');
                $table->string('provider', 32)->default('entra');
                $table->string('user_type', 10);
                $table->unsignedBigInteger('user_id');
                $table->string('subject', 128);
                $table->string('tenant_id', 64)->default('');
                $table->string('upn', 191)->default('');
                $table->dateTime('linked_at');
                $table->dateTime('last_login_at')->nullable();
                $table->dateTime('created_at');
                $table->dateTime('updated_at');
                $table->unique(array('provider', 'subject'), 'ch247pk_idn_subject_unq');
                $table->index(array('user_type', 'user_id'), 'ch247pk_idn_owner_idx');
            });
        }

        // ---------------------------------------------------------------- rate limits
        if (!$schema->hasTable('mod_cloudhost247_passkey_rate_limits')) {
            $schema->create('mod_cloudhost247_passkey_rate_limits', function ($table) {
                $table->bigIncrements('id');
                $table->string('bucket', 32);
                $table->string('subject_hash', 64);
                $table->unsignedInteger('attempts')->default(0);
                $table->dateTime('window_started_at');
                $table->dateTime('locked_until')->nullable();
                $table->dateTime('updated_at');
                $table->unique('subject_hash', 'ch247pk_rl_subject_unq');
                $table->index('updated_at', 'ch247pk_rl_updated_idx');
            });
        }

        // ---------------------------------------------------------------- settings
        if (!$schema->hasTable('mod_cloudhost247_passkey_settings')) {
            $schema->create('mod_cloudhost247_passkey_settings', function ($table) {
                $table->bigIncrements('id');
                $table->string('setting_key', 64);
                $table->text('setting_value')->nullable();
                $table->dateTime('created_at');
                $table->dateTime('updated_at');
                $table->unique('setting_key', 'ch247pk_set_key_unq');
            });
        }
    }
}
