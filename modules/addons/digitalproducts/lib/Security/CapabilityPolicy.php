<?php
namespace DigitalProducts\Security;

use WHMCS\Database\Capsule;

final class CapabilityPolicy
{
    const MODULE = 'digitalproducts';
    const TABLE = 'mod_cloudhost247_capabilities';

    const CAPABILITIES = array(
        'digitalproducts.products.view' => 'View digital products',
        'digitalproducts.products.manage' => 'Create and edit digital products',
        'digitalproducts.files.upload' => 'Upload digital product files',
        'digitalproducts.files.delete' => 'Retire/delete digital product files',
        'digitalproducts.versions.manage' => 'Manage versions and releases',
        'digitalproducts.entitlements.manage' => 'Grant, revoke and reset customer access',
        'digitalproducts.licenses.manage' => 'Manage license keys',
        'digitalproducts.downloads.view' => 'View download logs',
        'digitalproducts.settings.manage' => 'Manage digital product settings',
        'digitalproducts.audit.view' => 'View digital product audit events',
    );

    public static function seedDefaults()
    {
        $result = array('available' => false, 'seeded' => array(), 'existing' => array(), 'roles' => array());
        if (!class_exists('WHMCS\\Database\\Capsule')) { return $result; }
        try {
            if (!Capsule::schema()->hasTable(self::TABLE)) { return $result; }
            $roles = self::superAdminRoleIds();
            $result['available'] = true;
            $result['roles'] = $roles;
            if (!$roles) { return $result; }
            foreach (array_keys(self::CAPABILITIES) as $capability) {
                $exists = Capsule::table(self::TABLE)->where('module', self::MODULE)->where('capability', $capability)->exists();
                if ($exists) { $result['existing'][] = $capability; continue; }
                Capsule::table(self::TABLE)->insert(array(
                    'module' => self::MODULE,
                    'capability' => $capability,
                    'role_ids' => implode(',', $roles),
                ));
                $result['seeded'][] = $capability;
            }
        } catch (\Throwable $ignored) {}
        return $result;
    }

    public static function allows($capability, $roleId = null)
    {
        if (!self::tableAvailable()) { return true; }
        try {
            $row = Capsule::table(self::TABLE)->where('module', self::MODULE)->where('capability', $capability)->first();
            if (!$row) { return true; }
            $roles = self::parseRoles($row->role_ids);
            $roleId = $roleId === null ? (int) (isset($_SESSION['adminroleid']) ? $_SESSION['adminroleid'] : 0) : (int) $roleId;
            return in_array($roleId, $roles, true);
        } catch (\Throwable $ignored) { return true; }
    }

    public static function requireCapability($capability)
    {
        if (class_exists('CloudHost247\\Foundation\\Security\\AdminGuard')) {
            \CloudHost247\Foundation\Security\AdminGuard::requireCapability(self::MODULE, $capability);
            return;
        }
        if (empty($_SESSION['adminid'])) { throw new \RuntimeException('An authenticated WHMCS administrator is required.'); }
    }

    public static function requirePost($capability)
    {
        self::requireCapability($capability);
        if (class_exists('CloudHost247\\Foundation\\Security\\AdminGuard')) {
            \CloudHost247\Foundation\Security\AdminGuard::requirePostToken();
            return;
        }
        if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '') !== 'POST') {
            throw new \RuntimeException('This operation requires POST.');
        }
    }

    public static function tokenField()
    {
        $token = function_exists('generate_token') ? generate_token('plain') : '';
        return '<input type="hidden" name="token" value="' . htmlspecialchars($token, ENT_QUOTES, 'UTF-8') . '">';
    }

    public static function describeSeeding(array $result)
    {
        if (!$result['available']) { return 'CloudHost247 Foundation capability table not available; WHMCS addon-role permissions are being used.'; }
        if (!$result['roles']) { return 'No full administrator role could be identified; capability rows were not seeded.'; }
        if (!$result['seeded']) { return 'Existing Digital Products capability policy retained.'; }
        return 'Digital Products capabilities restricted to administrator role(s) ' . implode(',', $result['roles']) . ' by default.';
    }

    private static function tableAvailable()
    {
        try { return class_exists('WHMCS\\Database\\Capsule') && Capsule::schema()->hasTable(self::TABLE); } catch (\Throwable $e) { return false; }
    }

    private static function superAdminRoleIds()
    {
        $ids = array();
        try {
            if (Capsule::schema()->hasTable('tbladminroles')) {
                foreach (Capsule::table('tbladminroles')->get() as $role) {
                    $name = strtolower(trim((string) $role->name));
                    if (in_array($name, array('full administrator', 'super admin', 'super administrator', 'administrator'), true)) {
                        $ids[] = (int) $role->id;
                    }
                }
            }
        } catch (\Throwable $ignored) {}
        $current = (int) (isset($_SESSION['adminroleid']) ? $_SESSION['adminroleid'] : 0);
        if ($current > 0) { $ids[] = $current; }
        $ids = array_values(array_unique(array_filter($ids)));
        sort($ids);
        return $ids;
    }

    private static function parseRoles($value)
    {
        return array_values(array_filter(array_map('intval', explode(',', (string) $value))));
    }
}
