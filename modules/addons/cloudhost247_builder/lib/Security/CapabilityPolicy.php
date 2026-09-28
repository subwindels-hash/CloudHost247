<?php
namespace CloudHost247\Builder\Security;

use WHMCS\Database\Capsule;

/**
 * Website Builder permission model.
 *
 * The foundation capability store is permissive by default: a capability with
 * no policy row falls back to normal WHMCS addon-role access. Publishing a
 * page changes what the public sees, and custom CSS is a code-adjacent
 * privilege, so activation seeds an explicit row for every builder capability
 * restricted to the full administrator role(s).
 *
 * Existing rows are never overwritten, so an administrator's own policy always
 * wins over the shipped default.
 */
final class CapabilityPolicy
{
    const TABLE = 'mod_cloudhost247_capabilities';
    const MODULE = 'cloudhost247_builder';

    /** Capability => label, least privileged first. */
    const CAPABILITIES = array(
        'builder.view' => 'View the Website Builder',
        'builder.pages' => 'Create and edit pages',
        'builder.publish' => 'Publish, schedule and unpublish pages',
        'builder.delete' => 'Delete and archive pages',
        'builder.templates' => 'Manage templates and import or export them',
        'builder.theme' => 'Edit theme parts, headers, footers and menus',
        'builder.media' => 'Upload and manage media',
        'builder.forms' => 'Manage forms and read submissions',
        'builder.settings' => 'Change builder settings, global styles and SEO defaults',
        'builder.css' => 'Edit custom CSS',
    );

    /** Capabilities that stay Super-Admin-only even when roles are widened. */
    const PRIVILEGED = array('builder.publish', 'builder.css', 'builder.settings', 'builder.delete');

    const SUPER_ADMIN_ROLE_NAMES = array('full administrator', 'super admin', 'super administrator', 'administrator');

    public static function keys() { return array_keys(self::CAPABILITIES); }

    public static function label($capability)
    {
        return isset(self::CAPABILITIES[$capability]) ? self::CAPABILITIES[$capability] : $capability;
    }

    /**
     * Mirror of AdminGuard::requireCapability that does not throw.
     *
     * Used only to hide actions the administrator may not perform; the server
     * still enforces the capability before acting.
     */
    public static function allows($capability, $roleId = null)
    {
        if (!self::tableAvailable()) { return true; }
        try {
            $row = Capsule::table(self::TABLE)->where('module', self::MODULE)
                ->where('capability', (string) $capability)->first();
        } catch (\Throwable $unavailable) {
            return true;
        }
        if (!$row) { return true; }
        $roleId = $roleId === null ? (int) (isset($_SESSION['adminroleid']) ? $_SESSION['adminroleid'] : 0) : (int) $roleId;
        return in_array($roleId, self::parseRoles($row->role_ids), true);
    }

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
            return 'The CloudHost247 Foundation capability table is not present, so builder access currently follows standard WHMCS addon role permissions. Activate CloudHost247 Foundation and reactivate this module to restrict publishing to Super Admins.';
        }
        if (!$result['roles']) {
            return 'No full administrator role could be identified, so no default capability policy was written. Assign the builder capabilities to your Super Admin role under CloudHost247 Foundation before designing pages.';
        }
        if (!$result['seeded']) {
            return 'Existing Website Builder capability policy retained for: ' . implode(', ', $result['existing']) . '.';
        }
        return 'Website Builder capabilities restricted to administrator role(s) ' . implode(', ', $result['roles'])
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
