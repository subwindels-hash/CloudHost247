<?php
/**
 * Installer - schema creation, migrations and default settings.
 *
 * Runs the base schema on activation and applies versioned migrations from
 * install/migrations/*.sql exactly once each (tracked in
 * mod_phoneservices_migrations), so upgrades are idempotent and re-runnable.
 *
 * @package PhoneServices
 */

namespace PhoneServices\Core;

use WHMCS\Database\Capsule;

class Installer
{
    const MIGRATION_TABLE = 'mod_phoneservices_migrations';

    /**
     * Install the base schema and seed defaults.
     *
     * @return array{tables:int,migrations:int}
     */
    public function install(): array
    {
        $tables = $this->runSqlFile(PHONESERVICES_ROOT . '/install/schema.sql');
        $this->ensureMigrationTable();
        $migrations = $this->runPendingMigrations();
        $this->seedDefaults();

        Logger::info('PhoneServices installed', ['statements' => $tables, 'migrations' => $migrations]);

        return ['tables' => $tables, 'migrations' => $migrations];
    }

    /**
     * Apply any migrations not yet recorded.
     */
    public function upgrade(string $fromVersion = ''): int
    {
        $this->runSqlFile(PHONESERVICES_ROOT . '/install/schema.sql'); // CREATE TABLE IF NOT EXISTS
        $this->ensureMigrationTable();
        $applied = $this->runPendingMigrations();
        $this->seedDefaults();

        Logger::info('PhoneServices upgraded', ['from' => $fromVersion, 'migrations_applied' => $applied]);

        return $applied;
    }

    /**
     * Execute every statement in an SQL file. Returns statements executed.
     */
    public function runSqlFile(string $path): int
    {
        if (!is_file($path)) {
            return 0;
        }

        $sql = (string) file_get_contents($path);
        $count = 0;

        foreach (self::splitStatements($sql) as $statement) {
            try {
                Capsule::connection()->unprepared($statement);
                $count++;
            } catch (\Throwable $e) {
                Logger::error('Schema statement failed: ' . $e->getMessage(), [
                    'file'      => basename($path),
                    'statement' => substr($statement, 0, 160),
                ]);
            }
        }

        return $count;
    }

    /**
     * Split a SQL file into statements, ignoring comments and semicolons
     * inside quoted strings.
     *
     * @return string[]
     */
    public static function splitStatements(string $sql): array
    {
        $statements = [];
        $buffer = '';
        $inSingle = false;
        $inDouble = false;
        $inLineComment = false;
        $inBlockComment = false;
        $length = strlen($sql);

        for ($i = 0; $i < $length; $i++) {
            $char = $sql[$i];
            $next = $i + 1 < $length ? $sql[$i + 1] : '';

            if ($inLineComment) {
                if ($char === "\n") {
                    $inLineComment = false;
                    $buffer .= $char;
                }
                continue;
            }

            if ($inBlockComment) {
                if ($char === '*' && $next === '/') {
                    $inBlockComment = false;
                    $i++;
                }
                continue;
            }

            if (!$inSingle && !$inDouble) {
                if ($char === '-' && $next === '-') {
                    $inLineComment = true;
                    $i++;
                    continue;
                }
                if ($char === '#') {
                    $inLineComment = true;
                    continue;
                }
                if ($char === '/' && $next === '*') {
                    $inBlockComment = true;
                    $i++;
                    continue;
                }
                if ($char === ';') {
                    $trimmed = trim($buffer);
                    if ($trimmed !== '') {
                        $statements[] = $trimmed;
                    }
                    $buffer = '';
                    continue;
                }
            }

            if ($char === "'" && !$inDouble && ($i === 0 || $sql[$i - 1] !== '\\')) {
                $inSingle = !$inSingle;
            } elseif ($char === '"' && !$inSingle && ($i === 0 || $sql[$i - 1] !== '\\')) {
                $inDouble = !$inDouble;
            }

            $buffer .= $char;
        }

        $trimmed = trim($buffer);
        if ($trimmed !== '') {
            $statements[] = $trimmed;
        }

        return $statements;
    }

    private function ensureMigrationTable(): void
    {
        try {
            Capsule::connection()->unprepared(
                'CREATE TABLE IF NOT EXISTS `' . self::MIGRATION_TABLE . '` (
                    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                    `migration` VARCHAR(190) NOT NULL,
                    `applied_at` DATETIME NOT NULL,
                    PRIMARY KEY (`id`),
                    UNIQUE KEY `uniq_migration` (`migration`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
            );
        } catch (\Throwable $e) {
            Logger::error('Could not create migration table: ' . $e->getMessage());
        }
    }

    private function runPendingMigrations(): int
    {
        $dir = PHONESERVICES_ROOT . '/install/migrations';

        if (!is_dir($dir)) {
            return 0;
        }

        $files = glob($dir . '/*.sql') ?: [];
        sort($files, SORT_NATURAL);

        $applied = 0;

        foreach ($files as $file) {
            $name = basename($file);

            if (Database::row(self::MIGRATION_TABLE, 'id', ['migration' => $name])) {
                continue;
            }

            $this->runSqlFile($file);

            Database::insert(self::MIGRATION_TABLE, [
                'migration'  => $name,
                'applied_at' => date('Y-m-d H:i:s'),
            ]);

            $applied++;
        }

        return $applied;
    }

    /**
     * Seed default settings (never overwrites an existing value).
     */
    public function seedDefaults(): void
    {
        $defaults = [
            'default_provider'    => 'twilio',
            'provider_numbers'    => 'twilio',
            'provider_voice'      => 'twilio',
            'provider_sms'        => 'twilio',
            'provider_esim'       => 'airalo',
            'provider_whatsapp'   => 'whatsapp',
            'provider_email'      => 'sendgrid',
            'api_mode'            => 'sandbox',
            'enable_numbers'      => '1',
            'enable_voip'         => '1',
            'enable_sms'          => '1',
            'enable_esim'         => '1',
            'enable_analytics'    => '1',
            'log_retention_days'  => '90',
            'usage_retention_days' => '365',
            'currency'            => 'USD',
            'default_markup_percent' => '20',
            'otp_length'          => '6',
            'otp_ttl_seconds'     => '300',
            'otp_max_attempts'    => '5',
            'debug_logging'       => '0',
            // Comma separated list of origins allowed to call the REST API from
            // a browser. Empty = same-origin only (no CORS headers emitted).
            'api_allowed_origins' => '',
            'api_rate_limit'      => '120',
            'show_navbar_link'    => '1',
        ];

        foreach ($defaults as $name => $value) {
            if (Database::row('mod_phoneservices_settings', 'id', ['setting_name' => $name])) {
                continue;
            }

            Database::insert('mod_phoneservices_settings', [
                'setting_name'  => $name,
                'setting_value' => $value,
                'created_at'    => date('Y-m-d H:i:s'),
                'updated_at'    => date('Y-m-d H:i:s'),
            ]);
        }

        Config::clearCache();
    }

    /**
     * Report which module tables exist - surfaced on the admin dashboard.
     *
     * @return array<string,bool>
     */
    public static function tableStatus(): array
    {
        $tables = [
            'mod_phoneservices_settings',
            'mod_phoneservices_numbers',
            'mod_phoneservices_calls',
            'mod_phoneservices_messages',
            'mod_phoneservices_esims',
            'mod_phoneservices_usage',
            'mod_phoneservices_transactions',
            'mod_phoneservices_pricing',
            'mod_phoneservices_logs',
            'mod_phoneservices_api_keys',
            'mod_phoneservices_provider_events',
            'mod_phoneservices_otp',
        ];

        $status = [];
        foreach ($tables as $table) {
            $status[$table] = Database::tableExists($table);
        }

        return $status;
    }
}
