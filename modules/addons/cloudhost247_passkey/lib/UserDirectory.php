<?php
/**
 * Read-only bridge to the WHMCS account tables.
 *
 * Isolated here so the rest of the addon never touches core WHMCS schema
 * directly, and so lookups can be stubbed in tests. Only reads are performed:
 * this addon never modifies tblclients or tbladmins except through the
 * supported password-update path in PasswordResetService.
 */

namespace CloudHost247\Passkey;

use WHMCS\Database\Capsule;

final class UserDirectory
{
    /**
     * Resolves an identifier (email address, or numeric id) to an account.
     * Returns null rather than throwing: callers must not leak whether an
     * account exists.
     *
     * @return array{user_type:string,user_id:int,email:string,name:string}|null
     */
    public static function resolve($identifier, $userType = Schema::USER_CLIENT)
    {
        $identifier = trim((string) $identifier);
        if ($identifier === '') {
            return null;
        }
        try {
            if ($userType === Schema::USER_ADMIN) {
                $row = Capsule::table('tbladmins')
                    ->where('email', $identifier)
                    ->orWhere('username', $identifier)
                    ->first();
                if (!$row) {
                    return null;
                }
                return array(
                    'user_type' => Schema::USER_ADMIN,
                    'user_id' => (int) $row->id,
                    'email' => (string) $row->email,
                    'name' => trim((string) $row->firstname . ' ' . (string) $row->lastname),
                );
            }
            $row = Capsule::table('tblclients')->where('email', $identifier)->first();
            if (!$row) {
                return null;
            }
            return array(
                'user_type' => Schema::USER_CLIENT,
                'user_id' => (int) $row->id,
                'email' => (string) $row->email,
                'name' => trim((string) $row->firstname . ' ' . (string) $row->lastname),
            );
        } catch (\Throwable $e) {
            Log::error('directory.resolve_failed', array('error' => Log::safeError($e)));
            return null;
        }
    }

    /** @return array{user_type:string,user_id:int,email:string,name:string}|null */
    public static function find($userType, $userId)
    {
        try {
            if ($userType === Schema::USER_ADMIN) {
                $row = Capsule::table('tbladmins')->where('id', (int) $userId)->first();
                if (!$row) {
                    return null;
                }
                return array(
                    'user_type' => Schema::USER_ADMIN,
                    'user_id' => (int) $row->id,
                    'email' => (string) $row->email,
                    'name' => trim((string) $row->firstname . ' ' . (string) $row->lastname),
                );
            }
            $row = Capsule::table('tblclients')->where('id', (int) $userId)->first();
            if (!$row) {
                return null;
            }
            return array(
                'user_type' => Schema::USER_CLIENT,
                'user_id' => (int) $row->id,
                'email' => (string) $row->email,
                'name' => trim((string) $row->firstname . ' ' . (string) $row->lastname),
            );
        } catch (\Throwable $e) {
            Log::error('directory.find_failed', array('error' => Log::safeError($e)));
            return null;
        }
    }

    /** Closed/inactive accounts must never be able to sign in with a passkey. */
    public static function isActive($userType, $userId)
    {
        try {
            if ($userType === Schema::USER_ADMIN) {
                $row = Capsule::table('tbladmins')->where('id', (int) $userId)->first();
                return $row ? ((string) $row->disabled !== '1') : false;
            }
            $row = Capsule::table('tblclients')->where('id', (int) $userId)->first();
            if (!$row) {
                return false;
            }
            $status = strtolower((string) $row->status);
            return $status !== 'closed' && $status !== 'inactive';
        } catch (\Throwable $e) {
            Log::error('directory.status_failed', array('error' => Log::safeError($e)));
            return false;
        }
    }
}
