<?php
namespace DigitalProducts\Security;

use WHMCS\Database\Capsule;

final class TokenService
{
    public function generate($entitlement, $fileId, $expiryHours, $singleUse = true)
    {
        $raw = bin2hex(random_bytes(32));
        $now = date('Y-m-d H:i:s');
        $hours = (int) $expiryHours;
        $expiresAt = $hours > 0 ? date('Y-m-d H:i:s', time() + ($hours * 3600)) : null;
        $id = Capsule::table('mod_digitalproducts_download_tokens')->insertGetId(array(
            'token_hash' => self::hash($raw),
            'entitlement_id' => (int) $entitlement->id,
            'file_id' => (int) $fileId,
            'client_id' => (int) $entitlement->client_id,
            'service_id' => (int) $entitlement->service_id,
            'product_id' => (int) $entitlement->product_id,
            'expires_at' => $expiresAt,
            'uses' => 0,
            'max_uses' => $singleUse ? 1 : 0,
            'created_at' => $now,
        ));
        return array('id' => $id, 'token' => $raw, 'expires_at' => $expiresAt);
    }

    public function find($rawToken)
    {
        if (!is_string($rawToken) || !preg_match('/^[a-f0-9]{64}$/i', $rawToken)) { return null; }
        return Capsule::table('mod_digitalproducts_download_tokens')->where('token_hash', self::hash($rawToken))->first();
    }

    public function claim($tokenId)
    {
        $now = date('Y-m-d H:i:s');
        return Capsule::table('mod_digitalproducts_download_tokens')
            ->where('id', (int) $tokenId)
            ->whereNull('revoked_at')
            ->where(function ($q) use ($now) { $q->whereNull('expires_at')->orWhere('expires_at', '>', $now); })
            ->where(function ($q) { $q->where('max_uses', 0)->orWhereRaw('uses < max_uses'); })
            ->update(array('uses' => Capsule::raw('uses + 1'), 'used_at' => $now));
    }

    public function revokeForEntitlement($entitlementId)
    {
        return Capsule::table('mod_digitalproducts_download_tokens')
            ->where('entitlement_id', (int) $entitlementId)
            ->whereNull('revoked_at')
            ->update(array('revoked_at' => date('Y-m-d H:i:s')));
    }

    public static function hash($token)
    {
        return hash('sha256', (string) $token);
    }
}
