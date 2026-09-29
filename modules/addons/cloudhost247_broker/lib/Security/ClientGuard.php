<?php
namespace CloudHost247\Broker\Security;

use RuntimeException;

/**
 * Client-area authentication + CSRF guard, mirroring
 * CloudHost247\Foundation\Security\AdminGuard's admin-side conventions but
 * for the logged-in customer session (requirement #30). Every state-changing
 * client-area request must pass requirePostToken() before it touches a case.
 */
final class ClientGuard
{
    public static function requireClient()
    {
        if (empty($_SESSION['uid']) || !ctype_digit((string) $_SESSION['uid'])) {
            throw new RuntimeException('Please log in to your CloudHost247 account to continue.');
        }
        return (int) $_SESSION['uid'];
    }

    public static function requirePostToken()
    {
        self::requireClient();
        if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '') !== 'POST') {
            throw new RuntimeException('This operation requires POST.');
        }
        $token = isset($_POST['token']) ? (string) $_POST['token'] : '';
        if ($token === '' || !function_exists('check_token')) {
            throw new RuntimeException('Missing CSRF validation support.');
        }
        $_REQUEST['token'] = $token;
        if (check_token('WHMCS.default') === false) {
            throw new RuntimeException('Invalid or expired CSRF token. Please refresh the page and try again.');
        }
    }
}
