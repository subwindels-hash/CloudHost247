<?php
/**
 * Versioned schema management.
 *
 * install/schema.sql holds the canonical shape; install/migrations/*.sql hold
 * the incremental steps for existing installations. Both are applied
 * idempotently, and the applied filenames are tracked in
 * mod_hostx_email_migrations.
 *
 * ensureSchema() is cheap after the first call (one cached table check), so it
 * is safe to call from every module entry point - a provisioning module has no
 * activation hook of its own.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

namespace CloudHost247\Email\Database;

use CloudHost247\Email\Support\Logger;
use WHMCS\Database\Capsule;

final class Migrator
{
    /**
     * @var array<int,string>
     */
    const TABLES = [
        'mod_hostx_email_accounts',
        'mod_hostx_email_operations',
        'mod_hostx_email_locks',
        'mod_hostx_email_log',
        'mod_hostx_email_webhooks',
        'mod_hostx_email_dns',
        'mod_hostx_email_content',
        'mod_hostx_email_migrations',
    ];

    /** @var bool|null */
    private static $ready;

    /**
     * Create/upgrade the schema if it is not already in place.
     */
    public static function ensureSchema(bool $force = false): bool
    {
        if (self::$ready === true && !$force) {
            return true;
        }

        try {
            $installed = Capsule::schema()->hasTable('mod_hostx_email_accounts')
                && Capsule::schema()->hasTable('mod_hostx_email_migrations');

            if (!$installed || $force) {
                self::runFile(CH247_EMAIL_ROOT . '/install/schema.sql');
                self::runMigrations();
            }

            self::$ready = true;
        } catch (\Throwable $e) {
            self::$ready = false;

            error_log('[CH247_EMAIL] schema check failed: ' . $e->getMessage());
        }

        return (bool) self::$ready;
    }

    /**
     * Apply every migration file that has not been recorded yet.
     *
     * @return array<int,string> names of the files applied in this run
     */
    public static function runMigrations(): array
    {
        $applied = [];
        $directory = CH247_EMAIL_ROOT . '/install/migrations';

        if (!is_dir($directory)) {
            return $applied;
        }

        $files = glob($directory . '/*.sql') ?: [];
        sort($files, SORT_NATURAL);

        foreach ($files as $file) {
            $name = basename($file);

            try {
                if (Capsule::table('mod_hostx_email_migrations')->where('filename', $name)->exists()) {
                    continue;
                }

                self::runFile($file);

                Capsule::table('mod_hostx_email_migrations')->insert([
                    'filename'   => $name,
                    'applied_at' => date('Y-m-d H:i:s'),
                ]);

                $applied[] = $name;
            } catch (\Throwable $e) {
                Logger::error('migration.failed', ['file' => $name, 'error' => $e->getMessage()]);
            }
        }

        return $applied;
    }

    /**
     * Execute a .sql file statement by statement.
     */
    public static function runFile(string $path): void
    {
        if (!is_file($path)) {
            return;
        }

        foreach (self::splitStatements((string) file_get_contents($path)) as $statement) {
            try {
                Capsule::connection()->statement($statement);
            } catch (\Throwable $e) {
                // Re-applying an already-present object is expected and safe.
                error_log('[CH247_EMAIL] schema statement skipped: ' . $e->getMessage());
            }
        }
    }

    /**
     * Split SQL into statements, dropping comment-only lines.
     *
     * Pure helper (unit tested).
     *
     * @return array<int,string>
     */
    public static function splitStatements(string $sql): array
    {
        $lines = preg_split('/\R/', $sql) ?: [];
        $kept = [];

        foreach ($lines as $line) {
            $trimmed = trim($line);

            if ($trimmed === '' || strpos($trimmed, '--') === 0) {
                continue;
            }

            $kept[] = $line;
        }

        $statements = [];

        foreach (explode(';', implode("\n", $kept)) as $statement) {
            $statement = trim($statement);

            if ($statement !== '') {
                $statements[] = $statement;
            }
        }

        return $statements;
    }

    /**
     * @return array<string,bool>
     */
    public static function tableStatus(): array
    {
        $status = [];

        foreach (self::TABLES as $table) {
            try {
                $status[$table] = Capsule::schema()->hasTable($table);
            } catch (\Throwable $e) {
                $status[$table] = false;
            }
        }

        return $status;
    }
}
