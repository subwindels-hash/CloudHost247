<?php
/**
 * Enforcement policy (spec §9, §10, §34, §35).
 *
 * Resolves, for one account, whether a Passkey is optional or required and
 * whether the password remains a valid fallback. Two safety rules are
 * hard-coded and cannot be configured away:
 *
 *   1. Enforcement never applies to an account that has no usable credential —
 *      otherwise a policy change would lock out every user who has not
 *      enrolled yet. Such accounts are asked to enrol, not refused.
 *   2. There is an explicit, audited emergency override for Super Admins
 *      (see emergencyOverrideActive()), driven by a file placed on the server
 *      by someone with filesystem access — never by an HTTP request.
 */

namespace CloudHost247\Passkey;

use WHMCS\Database\Capsule;

final class PolicyService
{
    /** File-based break-glass switch: only creatable by someone with server access. */
    const OVERRIDE_FILE = 'cloudhost247_passkey_emergency_override';

    /**
     * @return array{required:bool,passwordFallback:bool,accountPolicy:string,enrolled:int,reason:string}
     */
    public static function resolve($userType, $userId)
    {
        $enrolled = CredentialRepository::countActive($userType, $userId);
        $accountPolicy = self::accountPolicy($userType, $userId);
        $global = ($userType === Schema::USER_ADMIN)
            ? (string) SettingsRepository::get('admin_policy', Schema::ENFORCE_OPTIONAL)
            : (string) SettingsRepository::get('client_policy', Schema::ENFORCE_OPTIONAL);

        $required = false;
        $reason = 'optional';

        if ($accountPolicy === Schema::POLICY_DISABLED) {
            return array(
                'required' => false,
                'passwordFallback' => true,
                'accountPolicy' => $accountPolicy,
                'enrolled' => $enrolled,
                'reason' => 'account_disabled',
            );
        }
        if ($accountPolicy === Schema::POLICY_REQUIRED) {
            $required = true;
            $reason = 'account_required';
        } elseif ($accountPolicy === Schema::POLICY_OPTIONAL) {
            $required = false;
            $reason = 'account_optional';
        } elseif ($global === Schema::ENFORCE_ALL) {
            $required = true;
            $reason = 'global_all';
        } elseif ($global === Schema::ENFORCE_SELECTED) {
            // "Selected" means: only accounts explicitly marked required, which
            // is already handled above. Everyone else stays optional.
            $required = false;
            $reason = 'global_selected';
        }

        // Rule 1: never enforce against an account with nothing enrolled.
        if ($required && $enrolled === 0) {
            $required = false;
            $reason = 'enrollment_pending';
        }
        // Rule 2: break-glass.
        if ($required && self::emergencyOverrideActive()) {
            $required = false;
            $reason = 'emergency_override';
        }
        if (!Config::isOperational()) {
            // Fail *open for availability but closed for security claims*: we do
            // not pretend Passkeys are enforced when WebAuthn cannot run, and we
            // never lock anybody out because of a misconfiguration.
            $required = false;
            $reason = 'configuration_required';
        }

        $passwordFallback = SettingsRepository::bool('password_fallback') || !$required;

        return array(
            'required' => $required,
            'passwordFallback' => $passwordFallback,
            'accountPolicy' => $accountPolicy,
            'enrolled' => $enrolled,
            'reason' => $reason,
        );
    }

    public static function accountPolicy($userType, $userId)
    {
        try {
            $row = Capsule::table(Schema::POLICIES)
                ->where('user_type', (string) $userType)
                ->where('user_id', (int) $userId)
                ->first();
            if ($row && in_array((string) $row->policy, Schema::accountPolicies(), true)) {
                return (string) $row->policy;
            }
        } catch (\Throwable $e) {
            Log::error('policy.read_failed', array('error' => Log::safeError($e)));
        }
        return Schema::POLICY_DEFAULT;
    }

    public static function setAccountPolicy($userType, $userId, $policy, $adminId)
    {
        if (!Schema::isUserType($userType) || !in_array($policy, Schema::accountPolicies(), true)) {
            throw new PasskeyException('Invalid policy selection.', 'invalid_request');
        }
        $now = date('Y-m-d H:i:s');
        $existing = Capsule::table(Schema::POLICIES)
            ->where('user_type', (string) $userType)->where('user_id', (int) $userId)->first();
        if ($existing) {
            Capsule::table(Schema::POLICIES)->where('id', (int) $existing->id)->update(array(
                'policy' => $policy, 'updated_by' => (int) $adminId, 'updated_at' => $now,
            ));
        } else {
            Capsule::table(Schema::POLICIES)->insert(array(
                'user_type' => (string) $userType,
                'user_id' => (int) $userId,
                'policy' => $policy,
                'updated_by' => (int) $adminId,
                'created_at' => $now,
                'updated_at' => $now,
            ));
        }
        EventLog::success(EventLog::POLICY_CHANGED, array(
            'user_type' => $userType,
            'user_id' => $userId,
            'metadata' => array('policy' => $policy, 'changed_by_admin' => (int) $adminId),
        ));
    }

    /**
     * Break-glass. Requires a file on the server (so an unauthenticated HTTP
     * request can never disable enforcement) that is younger than 24 hours, so
     * a forgotten override expires by itself.
     */
    public static function emergencyOverrideActive()
    {
        $candidates = array();
        if (defined('ROOTDIR')) {
            $candidates[] = rtrim((string) constant('ROOTDIR'), '/') . '/' . self::OVERRIDE_FILE;
        }
        $candidates[] = dirname(dirname(dirname(__DIR__))) . '/' . self::OVERRIDE_FILE;
        foreach ($candidates as $path) {
            if (@is_file($path) && (time() - (int) @filemtime($path)) < 86400) {
                return true;
            }
        }
        return false;
    }

    public static function maxCredentials($userType)
    {
        return $userType === Schema::USER_ADMIN
            ? max(1, SettingsRepository::int('max_credentials_admin'))
            : max(1, SettingsRepository::int('max_credentials_client'));
    }
}
