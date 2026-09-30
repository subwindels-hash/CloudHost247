<?php
/**
 * Credential storage (spec §4, §24).
 *
 * Stored: credential id, the *public* key, algorithm, signature counter,
 * transports, AAGUID, friendly name, lifecycle timestamps and the
 * registration IP/user-agent.
 *
 * Never stored: private keys (the authenticator keeps them), biometric data,
 * Face ID / Touch ID / Windows Hello secrets or device PINs — none of those
 * ever leave the user's device, and nothing in this class can persist them.
 */

namespace CloudHost247\Passkey;

use WHMCS\Database\Capsule;

final class CredentialRepository
{
    public static function create(array $data)
    {
        $now = date('Y-m-d H:i:s');
        $row = array(
            'user_type' => (string) $data['user_type'],
            'user_id' => (int) $data['user_id'],
            'credential_id' => (string) $data['credential_id'],
            'credential_id_hash' => self::hash($data['credential_id']),
            'public_key' => (string) $data['public_key'],
            'algorithm' => (int) $data['algorithm'],
            'credential_type' => 'public-key',
            'sign_count' => (int) $data['sign_count'],
            'transports' => isset($data['transports']) ? (string) $data['transports'] : '',
            'aaguid' => isset($data['aaguid']) ? (string) $data['aaguid'] : '',
            'attestation_format' => isset($data['attestation_format']) ? (string) $data['attestation_format'] : 'none',
            'device_name' => self::sanitiseName(isset($data['device_name']) ? $data['device_name'] : 'Passkey'),
            'backup_eligible' => !empty($data['backup_eligible']) ? 1 : 0,
            'backup_state' => !empty($data['backup_state']) ? 1 : 0,
            'user_verified' => !empty($data['user_verified']) ? 1 : 0,
            'status' => Schema::STATUS_ACTIVE,
            'registration_ip' => isset($data['registration_ip']) ? mb_substr((string) $data['registration_ip'], 0, 45) : '',
            'registration_user_agent' => isset($data['registration_user_agent']) ? mb_substr((string) $data['registration_user_agent'], 0, 255) : '',
            'last_used_at' => null,
            'last_used_ip' => null,
            'revoked_at' => null,
            'disabled_at' => null,
            'created_at' => $now,
            'updated_at' => $now,
        );
        $id = Capsule::table(Schema::CREDENTIALS)->insertGetId($row);
        $row['id'] = (int) $id;
        return $row;
    }

    /** Credential ids are unique platform-wide: one authenticator credential maps to one account. */
    public static function findByCredentialId($credentialId)
    {
        $row = Capsule::table(Schema::CREDENTIALS)->where('credential_id_hash', self::hash($credentialId))->first();
        return $row ? (array) $row : null;
    }

    public static function find($id)
    {
        $row = Capsule::table(Schema::CREDENTIALS)->where('id', (int) $id)->first();
        return $row ? (array) $row : null;
    }

    /**
     * Ownership-scoped lookup. Every management operation goes through this so
     * a crafted id can never reach another user's credential (IDOR).
     */
    public static function findOwned($id, $userType, $userId)
    {
        $row = Capsule::table(Schema::CREDENTIALS)
            ->where('id', (int) $id)
            ->where('user_type', (string) $userType)
            ->where('user_id', (int) $userId)
            ->first();
        return $row ? (array) $row : null;
    }

    public static function listForUser($userType, $userId, $includeRevoked = false)
    {
        $query = Capsule::table(Schema::CREDENTIALS)
            ->where('user_type', (string) $userType)
            ->where('user_id', (int) $userId);
        if (!$includeRevoked) {
            $query->where('status', '!=', Schema::STATUS_REVOKED);
        }
        $rows = $query->orderBy('created_at', 'desc')->get();
        $out = array();
        foreach ($rows as $row) {
            $out[] = (array) $row;
        }
        return $out;
    }

    /** Credentials usable for an authentication ceremony right now. */
    public static function activeForUser($userType, $userId)
    {
        $rows = Capsule::table(Schema::CREDENTIALS)
            ->where('user_type', (string) $userType)
            ->where('user_id', (int) $userId)
            ->where('status', Schema::STATUS_ACTIVE)
            ->get();
        $out = array();
        foreach ($rows as $row) {
            $out[] = (array) $row;
        }
        return $out;
    }

    public static function countActive($userType, $userId)
    {
        return (int) Capsule::table(Schema::CREDENTIALS)
            ->where('user_type', (string) $userType)
            ->where('user_id', (int) $userId)
            ->where('status', '!=', Schema::STATUS_REVOKED)
            ->count();
    }

    public static function rename($id, $name)
    {
        return (int) Capsule::table(Schema::CREDENTIALS)->where('id', (int) $id)->update(array(
            'device_name' => self::sanitiseName($name),
            'updated_at' => date('Y-m-d H:i:s'),
        ));
    }

    public static function setStatus($id, $status)
    {
        if (!in_array($status, Schema::statuses(), true)) {
            throw new PasskeyException('Unknown credential status.', 'invalid_request');
        }
        $now = date('Y-m-d H:i:s');
        $update = array('status' => $status, 'updated_at' => $now, 'revoked_at' => null, 'disabled_at' => null);
        if ($status === Schema::STATUS_REVOKED) {
            $update['revoked_at'] = $now;
        }
        if ($status === Schema::STATUS_DISABLED) {
            $update['disabled_at'] = $now;
        }
        return (int) Capsule::table(Schema::CREDENTIALS)->where('id', (int) $id)->update($update);
    }

    public static function recordUse($id, $signCount, $ip)
    {
        Capsule::table(Schema::CREDENTIALS)->where('id', (int) $id)->update(array(
            'sign_count' => (int) $signCount,
            'last_used_at' => date('Y-m-d H:i:s'),
            'last_used_ip' => mb_substr((string) $ip, 0, 45),
            'updated_at' => date('Y-m-d H:i:s'),
        ));
    }

    public static function hash($credentialId)
    {
        return hash('sha256', 'cloudhost247-passkey-credential:' . (string) $credentialId);
    }

    /** Friendly names are user-supplied: strip control characters and cap the length. */
    public static function sanitiseName($name)
    {
        $name = trim(preg_replace('/[\x00-\x1f\x7f]+/u', ' ', (string) $name));
        $name = preg_replace('/\s+/u', ' ', $name);
        if ($name === '') {
            $name = 'Passkey';
        }
        return mb_substr($name, 0, 64);
    }

    /**
     * Presentation DTO. Deliberately omits the public key and every internal
     * hash — a management UI never needs cryptographic material.
     */
    public static function toPublicArray(array $row)
    {
        return array(
            'id' => (int) $row['id'],
            'device_name' => (string) $row['device_name'],
            'status' => (string) $row['status'],
            'transports' => (string) $row['transports'],
            'created_at' => (string) $row['created_at'],
            'last_used_at' => $row['last_used_at'] === null ? '' : (string) $row['last_used_at'],
            'backup_state' => !empty($row['backup_state']),
            // Short, non-reversible reference so support can match a row in the
            // security log without exposing the credential id itself.
            'reference' => substr(self::hash($row['credential_id']), 0, 12),
        );
    }
}
