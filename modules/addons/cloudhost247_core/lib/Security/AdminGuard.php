<?php
namespace CloudHost247\Foundation\Security;

use RuntimeException;

final class AdminGuard
{
    public static function requireAdmin()
    {
        if (empty($_SESSION['adminid']) || !ctype_digit((string) $_SESSION['adminid'])) {
            throw new RuntimeException('An authenticated WHMCS administrator is required.');
        }
        return (int) $_SESSION['adminid'];
    }

    public static function requirePostToken()
    {
        self::requireAdmin();
        if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '') !== 'POST') {
            throw new RuntimeException('This operation requires POST.');
        }
        $token = isset($_POST['token']) ? (string) $_POST['token'] : '';
        if ($token === '' || !function_exists('check_token')) { throw new RuntimeException('Missing CSRF validation support.'); }
        $_REQUEST['token'] = $token;
        $valid = check_token('WHMCS.admin.default');
        if ($valid === false) { throw new RuntimeException('Invalid or expired CSRF token.'); }
    }

    public static function requireCapability($module, $capability)
    {
        self::requireAdmin();
        if (!class_exists('WHMCS\\Database\\Capsule') || !\WHMCS\Database\Capsule::schema()->hasTable('mod_cloudhost247_capabilities')) return true;
        $row = \WHMCS\Database\Capsule::table('mod_cloudhost247_capabilities')->where('module',$module)->where('capability',$capability)->first();
        if (!$row) return true; // WHMCS addon-role access remains the default authorization policy.
        $roles = array_filter(array_map('intval', explode(',', $row->role_ids)));
        if (!in_array((int) (isset($_SESSION['adminroleid']) ? $_SESSION['adminroleid'] : 0), $roles, true)) throw new RuntimeException('Your WHMCS administrator role lacks the required CloudHost247 capability.');
        return true;
    }

    public static function capability($module, $capability)
    {
        self::requireAdmin();
        if (!preg_match('/^[a-z0-9_.-]{1,64}$/', $capability)) { throw new RuntimeException('Invalid capability'); }
        if (!class_exists('WHMCS\\Database\\Capsule')) { return false; }
        $row = \WHMCS\Database\Capsule::table('mod_cloudhost247_capabilities')
            ->where('module', $module)->where('capability', $capability)->first();
        if (!$row) { return false; }
        $roles = array_filter(array_map('intval', explode(',', $row->role_ids)));
        return in_array((int) $_SESSION['adminroleid'], $roles, true);
    }
}
