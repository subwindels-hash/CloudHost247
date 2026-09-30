<?php
/**
 * Versioned, idempotent migration runner for this addon only.
 *
 * It records applied versions in its own small repository table so future
 * migrations can be appended without re-running earlier ones; every
 * migration is itself written to be safe if executed twice.
 */

namespace CloudHost247\CartRecovery;

use WHMCS\Database\Capsule;

final class MigrationRunner
{
    /** Ordered list of migration classes. Append new versions to the end. */
    public static function migrations()
    {
        return array(
            'CloudHost247\\CartRecovery\\Migrations\\V100',
            'CloudHost247\\CartRecovery\\Migrations\\V101',
        );
    }

    /**
     * @return array list of versions applied during this run
     */
    public static function migrate()
    {
        self::ensureRepository();
        $applied = array();
        foreach (self::migrations() as $class) {
            if (!class_exists($class)) {
                continue;
            }
            $version = (int) constant($class . '::VERSION');
            if (self::hasRun($version)) {
                continue;
            }
            call_user_func(array($class, 'run'));
            self::record($version, (string) constant($class . '::DESCRIPTION'));
            $applied[] = $version;
            Log::info('migration.applied', array('version' => $version));
        }
        return $applied;
    }

    public static function appliedVersions()
    {
        self::ensureRepository();
        $versions = array();
        foreach (Capsule::table(Schema::MIGRATIONS)->orderBy('version')->get() as $row) {
            $versions[] = (int) $row->version;
        }
        return $versions;
    }

    public static function pending()
    {
        $applied = self::appliedVersions();
        $pending = array();
        foreach (self::migrations() as $class) {
            if (!class_exists($class)) {
                continue;
            }
            $version = (int) constant($class . '::VERSION');
            if (!in_array($version, $applied, true)) {
                $pending[] = $version;
            }
        }
        return $pending;
    }

    private static function hasRun($version)
    {
        return Capsule::table(Schema::MIGRATIONS)->where('version', (int) $version)->count() > 0;
    }

    private static function record($version, $description)
    {
        Capsule::table(Schema::MIGRATIONS)->updateOrInsert(
            array('version' => (int) $version),
            array('description' => substr($description, 0, 191), 'applied_at' => date('Y-m-d H:i:s'))
        );
    }

    private static function ensureRepository()
    {
        $schema = Capsule::schema();
        if (!$schema->hasTable(Schema::MIGRATIONS)) {
            $schema->create(Schema::MIGRATIONS, function ($table) {
                $table->unsignedInteger('version')->primary();
                $table->string('description', 191)->nullable();
                $table->dateTime('applied_at');
            });
        }
    }
}
