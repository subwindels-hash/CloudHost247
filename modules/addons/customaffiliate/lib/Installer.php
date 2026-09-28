<?php
/**
 * Installer: schema creation, migrations and default settings.
 *
 * Activation is idempotent - it can be run repeatedly (activate, deactivate,
 * activate, upgrade) without data loss and without duplicate columns.
 *
 * @package    WHMCS
 * @subpackage CustomAffiliate
 */

namespace CustomAffiliate;

use WHMCS\Database\Capsule;

class Installer
{
    /**
     * Tables owned by this module.
     *
     * @var array<int,string>
     */
    const TABLES = [
        'mod_customaffiliate_settings',
        'mod_customaffiliate_commissions',
        'mod_customaffiliate_payouts',
        'mod_customaffiliate_log',
        'mod_customaffiliate_migrations',
    ];

    /**
     * Columns added after 1.0, applied programmatically so the module upgrades
     * cleanly on both MySQL and MariaDB (MySQL has no ADD COLUMN IF NOT EXISTS).
     *
     * @var array<string,array<string,string>>
     */
    const COLUMNS = [
        'mod_customaffiliate_commissions' => [
            'product_group_id'             => "INT(10) UNSIGNED NOT NULL DEFAULT 0",
            'client_was_new'               => "TINYINT(1) NOT NULL DEFAULT 1",
            'first_commission_reversed_at' => "DATETIME NULL DEFAULT NULL",
            'total_commission'             => "DECIMAL(16,2) NOT NULL DEFAULT 0.00",
            'last_invoice_id'              => "INT(10) UNSIGNED NULL DEFAULT NULL",
        ],
        'mod_customaffiliate_log' => [
            'level' => "ENUM('debug','info','warning','error') NOT NULL DEFAULT 'info'",
        ],
    ];

    /**
     * Run the full install / upgrade.
     *
     * @return array{status:string,description:string}
     */
    public static function install(): array
    {
        try {
            self::runSqlFile(CUSTOMAFFILIATE_ROOT . '/install/schema.sql');
            self::syncColumns();
            self::runMigrations();
            self::seedDefaults();
            self::importLegacySettings();

            Settings::clearCache();

            $missing = array_keys(array_filter(self::tableStatus(), static function ($present) {
                return !$present;
            }));

            if ($missing) {
                return [
                    'status'      => 'error',
                    'description' => 'Some tables could not be created: ' . implode(', ', $missing),
                ];
            }

            Logger::info('Module activated', ['action' => 'activate', 'version' => CUSTOMAFFILIATE_VERSION]);

            return [
                'status'      => 'success',
                'description' => 'Custom Affiliate Commission ' . CUSTOMAFFILIATE_VERSION
                    . ' activated. Configure the commissionable product group under the module\'s Settings tab before going live.',
            ];
        } catch (\Throwable $e) {
            return [
                'status'      => 'error',
                'description' => 'Activation failed: ' . $e->getMessage(),
            ];
        }
    }

    /**
     * Deactivation never drops data: commission history is financial records.
     *
     * @return array{status:string,description:string}
     */
    public static function uninstall(): array
    {
        Logger::info('Module deactivated', ['action' => 'deactivate']);

        return [
            'status'      => 'success',
            'description' => 'Module deactivated. Commission tables were preserved; '
                . 'drop them manually if you really want the history gone.',
        ];
    }

    /**
     * Execute a .sql file statement by statement.
     */
    public static function runSqlFile(string $path): void
    {
        if (!is_file($path)) {
            return;
        }

        $sql = (string) file_get_contents($path);

        foreach (self::splitStatements($sql) as $statement) {
            try {
                Capsule::connection()->statement($statement);
            } catch (\Throwable $e) {
                // Tolerated: re-running a migration that has already been
                // applied (duplicate column/key) must not abort activation.
                Logger::debug('Schema statement skipped', [
                    'error'     => $e->getMessage(),
                    'statement' => substr($statement, 0, 120),
                ]);
            }
        }
    }

    /**
     * Split a SQL file into individual statements, ignoring comments.
     *
     * @return array<int,string>
     */
    public static function splitStatements(string $sql): array
    {
        $lines = preg_split('/\R/', $sql) ?: [];
        $clean = [];

        foreach ($lines as $line) {
            $trimmed = trim($line);

            if ($trimmed === '' || strpos($trimmed, '--') === 0) {
                continue;
            }

            $clean[] = $line;
        }

        $statements = [];

        foreach (explode(';', implode("\n", $clean)) as $statement) {
            $statement = trim($statement);

            if ($statement !== '') {
                $statements[] = $statement;
            }
        }

        return $statements;
    }

    /**
     * Add any columns introduced after the original 1.0 schema.
     */
    public static function syncColumns(): void
    {
        foreach (self::COLUMNS as $table => $columns) {
            try {
                if (!Capsule::schema()->hasTable($table)) {
                    continue;
                }

                foreach ($columns as $column => $definition) {
                    if (Capsule::schema()->hasColumn($table, $column)) {
                        continue;
                    }

                    Capsule::connection()->statement(
                        'ALTER TABLE `' . $table . '` ADD COLUMN `' . $column . '` ' . $definition
                    );
                }
            } catch (\Throwable $e) {
                Logger::warning('Column sync failed for ' . $table, ['error' => $e->getMessage()]);
            }
        }
    }

    /**
     * Apply pending files from install/migrations, newest last.
     */
    public static function runMigrations(): void
    {
        $directory = CUSTOMAFFILIATE_ROOT . '/install/migrations';

        if (!is_dir($directory)) {
            return;
        }

        $files = glob($directory . '/*.sql') ?: [];
        sort($files, SORT_NATURAL);

        foreach ($files as $file) {
            $name = basename($file);

            try {
                $applied = Capsule::table('mod_customaffiliate_migrations')
                    ->where('filename', $name)
                    ->exists();

                if ($applied) {
                    continue;
                }

                self::runSqlFile($file);

                Capsule::table('mod_customaffiliate_migrations')->insert([
                    'filename'   => $name,
                    'applied_at' => date('Y-m-d H:i:s'),
                ]);
            } catch (\Throwable $e) {
                Logger::warning('Migration ' . $name . ' could not be recorded', ['error' => $e->getMessage()]);
            }
        }
    }

    /**
     * Write the documented defaults for any setting that has no value yet.
     */
    public static function seedDefaults(): void
    {
        foreach (Settings::DEFAULTS as $name => $value) {
            try {
                $exists = Capsule::table(Settings::TABLE)->where('setting_name', $name)->exists();

                if ($exists) {
                    continue;
                }

                Capsule::table(Settings::TABLE)->insert([
                    'setting_name'  => $name,
                    'setting_value' => $value,
                    'updated_at'    => date('Y-m-d H:i:s'),
                ]);
            } catch (\Throwable $e) {
                Logger::warning('Could not seed setting ' . $name, ['error' => $e->getMessage()]);
            }
        }
    }

    /**
     * Carry 1.x addon configuration (tbladdonmodules) into the new settings
     * table so an upgrade keeps the operator's existing configuration.
     */
    public static function importLegacySettings(): void
    {
        $legacy = Settings::legacy();

        if (!$legacy) {
            return;
        }

        $map = [
            'product_group_id'             => 'product_group_ids',
            'first_commission_percent'     => 'first_commission_percent',
            'recurring_commission_percent' => 'recurring_commission_percent',
            'enable_logging'               => 'debug_logging',
        ];

        foreach ($map as $old => $new) {
            if (!isset($legacy[$old]) || $legacy[$old] === '') {
                continue;
            }

            try {
                $current = Capsule::table(Settings::TABLE)->where('setting_name', $new)->value('setting_value');
            } catch (\Throwable $e) {
                continue;
            }

            // Only import when the new setting is still at its default.
            if ((string) $current !== (string) (Settings::DEFAULTS[$new] ?? '')) {
                continue;
            }

            $value = (string) $legacy[$old];

            if ($new === 'debug_logging') {
                $value = in_array(strtolower($value), ['on', '1', 'yes', 'true'], true) ? '1' : '0';
            }

            Settings::set($new, $value);

            Logger::info('Imported legacy setting ' . $old, ['action' => 'upgrade', 'value' => $value]);
        }
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

    /**
     * Configuration problems worth warning the admin about.
     *
     * @return array<int,string>
     */
    public static function healthWarnings(): array
    {
        $warnings = [];

        if (!Affiliates::systemEnabled()) {
            $warnings[] = 'The WHMCS affiliate system is disabled '
                . '(Configuration > System Settings > General Settings > Affiliates). No referrals will be recorded.';
        }

        if (!Settings::productGroupIds()) {
            $warnings[] = 'No commissionable product group is selected, so no commission will be paid. '
                . 'Choose your "Web Hosting" group in Settings.';
        }

        if (!Settings::isEnabled()) {
            $warnings[] = 'The module is currently disabled: WHMCS default affiliate commission rules apply.';
        }

        if (Settings::isEnabled() && !Settings::isExclusive()) {
            $warnings[] = 'Exclusive mode is off, so WHMCS will also pay its own default commission '
                . 'on top of this module\'s. Enable it unless you know you want both.';
        }

        foreach (self::tableStatus() as $table => $present) {
            if (!$present) {
                $warnings[] = 'Database table ' . $table . ' is missing. Deactivate and reactivate the module.';
            }
        }

        return $warnings;
    }
}
