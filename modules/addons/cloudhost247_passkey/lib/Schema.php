<?php
/**
 * Single source of truth for this addon's table names and enumerations.
 *
 * Table names follow the repository-wide `mod_cloudhost247_*` convention that
 * scripts/validate-migrations.py enforces (the functional specification's
 * "cloudhost247_passkeys" naming maps onto
 * "mod_cloudhost247_passkey_credentials" and so on — see docs/PASSKEY.md).
 */

namespace CloudHost247\Passkey;

final class Schema
{
    const CREDENTIALS = 'mod_cloudhost247_passkey_credentials';
    const CHALLENGES = 'mod_cloudhost247_passkey_challenges';
    const EVENTS = 'mod_cloudhost247_passkey_events';
    const SETTINGS = 'mod_cloudhost247_passkey_settings';
    const POLICIES = 'mod_cloudhost247_passkey_policies';
    const IDENTITIES = 'mod_cloudhost247_passkey_identities';
    const RATE_LIMITS = 'mod_cloudhost247_passkey_rate_limits';
    const MIGRATIONS = 'mod_cloudhost247_passkey_migrations';

    /** User types. A client credential can never authenticate an administrator. */
    const USER_CLIENT = 'client';
    const USER_ADMIN = 'admin';

    /** Credential lifecycle. */
    const STATUS_ACTIVE = 'active';
    const STATUS_DISABLED = 'disabled';
    const STATUS_REVOKED = 'revoked';

    /** Challenge ceremonies. */
    const CHALLENGE_REGISTRATION = 'registration';
    const CHALLENGE_AUTHENTICATION = 'authentication';
    const CHALLENGE_ACTION = 'action';
    const CHALLENGE_PASSWORD_RESET = 'password_reset';
    /** Single-use authorization minted after a successful action confirmation. */
    const CHALLENGE_ACTION_TOKEN = 'action_token';
    /** Single-use authorization minted after a successful reset ceremony. */
    const CHALLENGE_RESET_TOKEN = 'reset_token';

    /** Per-account enforcement overrides (spec §10). */
    const POLICY_DEFAULT = 'default';
    const POLICY_OPTIONAL = 'optional';
    const POLICY_REQUIRED = 'required';
    const POLICY_DISABLED = 'disabled';

    /** Global enforcement policies (spec §9). */
    const ENFORCE_OPTIONAL = 'optional';
    const ENFORCE_SELECTED = 'selected';
    const ENFORCE_ALL = 'all';

    public static function userTypes()
    {
        return array(self::USER_CLIENT, self::USER_ADMIN);
    }

    public static function statuses()
    {
        return array(self::STATUS_ACTIVE, self::STATUS_DISABLED, self::STATUS_REVOKED);
    }

    public static function challengeTypes()
    {
        return array(
            self::CHALLENGE_REGISTRATION,
            self::CHALLENGE_AUTHENTICATION,
            self::CHALLENGE_ACTION,
            self::CHALLENGE_PASSWORD_RESET,
            self::CHALLENGE_ACTION_TOKEN,
            self::CHALLENGE_RESET_TOKEN,
        );
    }

    public static function accountPolicies()
    {
        return array(self::POLICY_DEFAULT, self::POLICY_OPTIONAL, self::POLICY_REQUIRED, self::POLICY_DISABLED);
    }

    public static function enforcementPolicies()
    {
        return array(self::ENFORCE_OPTIONAL, self::ENFORCE_SELECTED, self::ENFORCE_ALL);
    }

    public static function isUserType($value)
    {
        return in_array((string) $value, self::userTypes(), true);
    }
}
