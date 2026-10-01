<?php
namespace CloudHost247\Foundation\Database;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;
use RuntimeException;

final class MigrationRunner
{
    const TABLE = 'mod_cloudhost247_migrations';

    public function ensureRepository()
    {
        if (!Capsule::schema()->hasTable(self::TABLE)) {
            Capsule::schema()->create(self::TABLE, function ($table) {
                $table->bigIncrements('id');
                $table->string('module', 64);
                $table->string('version', 32);
                $table->string('description', 255)->default('');
                $table->dateTime('applied_at');
                $table->unique(array('module', 'version'), 'ch247_migration_unique');
            });
        }
    }

    public function run($module, array $migrations)
    {
        $this->assertModule($module);
        $this->ensureRepository();
        usort($migrations, function (Migration $a, Migration $b) { return version_compare($a->version(), $b->version()); });
        $applied = array();
        foreach ($migrations as $migration) {
            if (!$migration instanceof Migration) { throw new RuntimeException('Invalid migration object'); }
            $exists = Capsule::table(self::TABLE)->where('module', $module)->where('version', $migration->version())->exists();
            if ($exists) { continue; }
            Capsule::connection()->transaction(function () use ($module, $migration) {
                $migration->up();
                Capsule::table(self::TABLE)->insert(array(
                    'module' => $module, 'version' => $migration->version(),
                    'description' => $migration->description(), 'applied_at' => date('Y-m-d H:i:s'),
                ));
            });
            $applied[] = $migration->version();
        }
        return $applied;
    }

    private function assertModule($module)
    {
        // CloudHost247 first-party modules use cloudhost247_* identifiers, while
        // legacy first-party WHMCS addons such as digitalproducts keep their
        // original module name.  The identifier is stored only in the migration
        // ledger, but still constrain it tightly to avoid unsafe values being
        // logged or queried later.
        if (!preg_match('/^[a-z][a-z0-9_]{1,63}$/', (string) $module)) { throw new RuntimeException('Unsafe module identifier'); }
    }
}
