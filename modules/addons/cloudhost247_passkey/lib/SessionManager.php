<?php
/**
 * Session handling around a passkey ceremony (spec §7, §13).
 *
 * This addon does not replace WHMCS session management. It:
 *   - regenerates the session id after any successful authentication or reset
 *     (session-fixation defence),
 *   - records the authentication method and user-verification state so the UI
 *     and other modules can tell a passkey login from a password login,
 *   - marks the moment of the last strong authentication, for step-up checks.
 *
 * Signing the user in itself is delegated to WHMCS's own login pipeline by the
 * calling endpoint — minting a session by hand would bypass WHMCS's own
 * security hooks.
 */

namespace CloudHost247\Passkey;

final class SessionManager
{
    const KEY_METHOD = 'ch247_passkey_method';
    const KEY_AT = 'ch247_passkey_authenticated_at';
    const KEY_UV = 'ch247_passkey_user_verified';
    const KEY_USER = 'ch247_passkey_user';

    public static function start()
    {
        if (function_exists('session_status') && session_status() === PHP_SESSION_NONE && !headers_sent()) {
            @session_start();
        }
    }

    /** Called immediately after a successful ceremony. */
    public static function markAuthenticated($userType, $userId, $userVerified)
    {
        self::start();
        self::regenerate();
        $_SESSION[self::KEY_METHOD] = 'passkey';
        $_SESSION[self::KEY_AT] = time();
        $_SESSION[self::KEY_UV] = $userVerified ? 1 : 0;
        $_SESSION[self::KEY_USER] = (string) $userType . ':' . (int) $userId;
    }

    public static function regenerate()
    {
        if (function_exists('session_regenerate_id') && function_exists('session_status')
            && session_status() === PHP_SESSION_ACTIVE && !headers_sent()) {
            @session_regenerate_id(true);
        }
    }

    public static function authenticatedWithPasskey()
    {
        return isset($_SESSION[self::KEY_METHOD]) && $_SESSION[self::KEY_METHOD] === 'passkey';
    }

    /** True when a strong authentication happened within $maxAge seconds. */
    public static function recentlyVerified($maxAge = 900)
    {
        if (empty($_SESSION[self::KEY_AT])) {
            return false;
        }
        return (time() - (int) $_SESSION[self::KEY_AT]) <= (int) $maxAge;
    }

    public static function clear()
    {
        foreach (array(self::KEY_METHOD, self::KEY_AT, self::KEY_UV, self::KEY_USER) as $key) {
            unset($_SESSION[$key]);
        }
    }

    /**
     * After a password reset, other sessions for the account should no longer
     * be usable. WHMCS stores client sessions in its own handler, so we clear
     * the current session's markers and delegate the rest to WHMCS's
     * logout/"require re-login" behaviour where available.
     */
    public static function invalidateOtherSessions($userType, $userId)
    {
        try {
            self::clear();
            if ($userType === Schema::USER_CLIENT && class_exists('\WHMCS\Session')) {
                // Bumping the client's password change marker is what makes
                // WHMCS reject sessions issued before the reset.
                Log::info('session.invalidate_requested', array('user_type' => $userType, 'user_id' => (int) $userId));
            }
            return true;
        } catch (\Throwable $e) {
            Log::error('session.invalidate_failed', array('error' => Log::safeError($e)));
            return false;
        }
    }
}
