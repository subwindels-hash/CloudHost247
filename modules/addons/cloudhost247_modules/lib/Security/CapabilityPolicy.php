<?php
namespace CloudHost247\ModuleManager\Security;

use WHMCS\Database\Capsule;

/**
 * Module Manager permission model.
 *
 * The foundation capability store is deliberately permissive: a capability
 * with no policy row falls back to normal WHMCS addon-role access. That is the
 * wrong default for a page that installs executable code, so activation seeds
 * an explicit policy row for every Module Manager capability, restricted to
 * the full administrator role(s). Everything stays adjustable from
 * CloudHost247 Foundation, but the shipped default is Super Admin only.
 */
final class CapabilityPolicy
{
    const TABLE = 'mod_cloudhost247_capabilities';
    const MODULE = 'cloudhost247_modules';

    /** Capability => human label, least privileged first. */
    const CAPABILITIES = array(
        'modules.view' => 'View modules and logs',
        'modules.upload' => 'Upload module packages',
        'modules.install' => 'Install new modules',
        'modules.update' => 'Update installed modules',
        'modules.toggle' => 'Enable and disable modules',
        'modules.uninstall' => 'Uninstall modules',
        'modules.configure' => 'Configure installed modules',
    );

    /** Role names treated as Super Admin when seeding the default policy. */
    const SUPER_ADMIN_ROLE_NAMES = array('full administrator', 'super admin', 'super administrator', 'administrator');

    public static function keys()
    {
        return array_keys(self::CAPABILITIES);
    }

    public static function label($capability)
    {
        return isset(self::CAPABILITIES[$capability]) ? self::CAPABILITIES[$capability] : $capability;
    }

    /**
     * Mirror of AdminGuard::requireCapability, without throwing.
     *
     * Used only to hide actions the administrator may not perform. The server
     * still enforces every capability before acting.
     */
    public static function allows($capability, $roleId = null)
    {
        if (!self::tableAvailable()) { return true; }
        try {
            $row = Capsule::table(self::TABLE)->where('module', self::MODULE)->where('capability', (string) $capability)->first();
        } catch (\Throwable $unavailable) {
            return true;
        }
        if (!$row) { return true; }
        $roleId = $roleId === null ? (int) (isset($_SESSION['adminroleid']) ? $_SESSION['adminroleid'] : 0) : (int) $roleId;
        return in_array($roleId, self::parseRoles($row->role_ids), true);
    }

    /**
     * Create the default Super-Admin-only policy for capabilities that have none.
     *
     * Existing rows are never overwritten, so an administrator's own policy
     * always wins over the shipped default.
     *
     * @return array array('seeded','existing','roles','available')
     */
    public static function seedDefaults()
    {
        $result = array('seeded' => array(), 'existing' => array(), 'roles' => array(), 'available' => false);
        if (!self::tableAvailable()) { return $result; }

        $roles = self::superAdminRoleIds();
        $result['roles'] = $roles;
        $result['available'] = true;
        if (!$roles) { return $result; }

        $now = date('Y-m-d H:i:s');
        foreach (self::keys() as $capability) {
            $existing = Capsule::table(self::TABLE)->where('module', self::MODULE)->where('capability', $capability)->first();
            if ($existing) { $result['existing'][] = $capability; continue; }
            Capsule::table(self::TABLE)->insert(array(
                'module' => self::MODULE,
                'capability' => $capability,
                'role_ids' => implode(',', $roles),
                'updated_at' => $now,
            ));
            $result['seeded'][] = $capability;
        }
        return $result;
    }

    /** Current policy rows for display: capability => array of role ids. */
    public static function current()
    {
        $policy = array();
        foreach (self::keys() as $capability) { $policy[$capability] = array(); }
        if (!self::tableAvailable()) { return $policy; }
        try {
            $rows = Capsule::table(self::TABLE)->where('module', self::MODULE)->get();
        } catch (\Throwable $unavailable) {
            return $policy;
        }
        foreach ($rows as $row) {
            if (!isset($policy[$row->capability])) { continue; }
            $policy[$row->capability] = self::parseRoles($row->role_ids);
        }
        return $policy;
    }

    /**
     * Administrator roles that should hold Module Manager rights by default.
     *
     * The role performing the activation is always included so that enabling
     * the addon can never lock the platform owner out of their own dashboard.
     */
    public static function superAdminRoleIds()
    {
        $ids = array();
        try {
            if (Capsule::schema()->hasTable('tbladminroles')) {
                foreach (Capsule::table('tbladminroles')->get() as $role) {
                    if (in_array(strtolower(trim((string) $role->name)), self::SUPER_ADMIN_ROLE_NAMES, true)) {
                        $ids[] = (int) $role->id;
                    }
                }
            }
        } catch (\Throwable $unavailable) {
            $ids = array();
        }
        $current = (int) (isset($_SESSION['adminroleid']) ? $_SESSION['adminroleid'] : 0);
        if ($current > 0) { $ids[] = $current; }
        $ids = array_values(array_unique(array_filter($ids)));
        sort($ids);
        return $ids;
    }

    public static function describeSeeding(array $result)
    {
        if (!$result['available']) {
            return 'The CloudHost247 Foundation capability table is not present, so Module Manager access currently follows standard WHMCS addon role permissions. Activate CloudHost247 Foundation and reactivate this module to restrict installation to Super Admins.';
        }
        if (!$result['roles']) {
            return 'No full administrator role could be identified, so no default capability policy was written. Assign the Module Manager capabilities to your Super Admin role under CloudHost247 Foundation before using this page.';
        }
        if (!$result['seeded']) {
            return 'Existing Module Manager capability policy retained for: ' . implode(', ', $result['existing']) . '.';
        }
        return 'Module Manager capabilities restricted to administrator role(s) ' . implode(', ', $result['roles'])
            . ' by default: ' . implode(', ', $result['seeded']) . '. Adjust them under CloudHost247 Foundation.';
    }

    private static function parseRoles($value)
    {
        return array_values(array_filter(array_map('intval', explode(',', (string) $value))));
    }

    private static function tableAvailable()
    {
        if (!class_exists('WHMCS\\Database\\Capsule')) { return false; }
        try {
            return (bool) Capsule::schema()->hasTable(self::TABLE);
        } catch (\Throwable $unavailable) {
            return false;
        }
    }
}
