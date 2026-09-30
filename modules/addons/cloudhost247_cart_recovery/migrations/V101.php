<?php
/**
 * V101 — column guard for installations created by an earlier build of this
 * addon. Each column is added only when missing, so the migration is safe to
 * run repeatedly and never recreates or drops anything.
 */

namespace CloudHost247\CartRecovery\Migrations;

use CloudHost247\CartRecovery\Schema;
use WHMCS\Database\Capsule;

final class V101
{
    const VERSION = 101;
    const DESCRIPTION = 'Add cart fingerprint, unsubscribe hash and reminder attempt columns when missing';

    /** Repository-wide migration convention (see scripts/validate-migrations.py). */
    public function version() { return '1.0.1'; }

    public function description() { return self::DESCRIPTION; }

    public function up() { self::run(); }

    public static function run()
    {
        $schema = Capsule::schema();

        if ($schema->hasTable(Schema::RECOVERIES)) {
            if (!$schema->hasColumn(Schema::RECOVERIES, 'cart_fingerprint')) {
                $schema->table(Schema::RECOVERIES, function ($table) {
                    $table->string('cart_fingerprint', 64)->nullable();
                });
            }
            if (!$schema->hasColumn(Schema::RECOVERIES, 'unsubscribe_hash')) {
                $schema->table(Schema::RECOVERIES, function ($table) {
                    $table->string('unsubscribe_hash', 64)->nullable();
                });
            }
            if (!$schema->hasColumn(Schema::RECOVERIES, 'session_key')) {
                $schema->table(Schema::RECOVERIES, function ($table) {
                    $table->string('session_key', 128)->nullable();
                });
            }
        }

        if ($schema->hasTable(Schema::REMINDER_LOGS) && !$schema->hasColumn(Schema::REMINDER_LOGS, 'attempts')) {
            $schema->table(Schema::REMINDER_LOGS, function ($table) {
                $table->unsignedSmallInteger('attempts')->default(0);
            });
        }
    }
}
