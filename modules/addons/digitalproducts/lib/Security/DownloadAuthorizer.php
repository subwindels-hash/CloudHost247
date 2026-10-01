<?php
namespace DigitalProducts\Security;

use DigitalProducts\Services\EntitlementService;
use DigitalProducts\Storage\LocalPrivateStorage;
use WHMCS\Database\Capsule;

final class DownloadAuthorizer
{
    private $tokenService;
    private $entitlements;
    private $storage;

    public function __construct(TokenService $tokenService = null, EntitlementService $entitlements = null, LocalPrivateStorage $storage = null)
    {
        $this->tokenService = $tokenService ?: new TokenService();
        $this->entitlements = $entitlements ?: new EntitlementService();
        $this->storage = $storage ?: new LocalPrivateStorage();
    }

    public function generateTokenForClient($clientId, $serviceId, $fileId = 0, $singleUse = true)
    {
        $clientId = (int) $clientId;
        $serviceId = (int) $serviceId;
        if (!$clientId || !$serviceId) { throw new \RuntimeException('Invalid download request.'); }

        $entitlement = Capsule::table('mod_digitalproducts_entitlements')
            ->where('client_id', $clientId)
            ->where('service_id', $serviceId)
            ->where('status', EntitlementService::STATUS_ACTIVE)
            ->first();
        if (!$entitlement) { $entitlement = $this->entitlements->grantForService($serviceId, null, false); }
        if (!$entitlement || (int) $entitlement->client_id !== $clientId) { throw new \RuntimeException('You are not entitled to this download.'); }

        $product = Capsule::table('mod_digitalproducts_products')->where('id', (int) $entitlement->product_id)->first();
        if (!$product || (string) $product->status !== 'active') { throw new \RuntimeException('This digital product is not active.'); }
        $resolvedFileId = $this->entitlements->versionForEntitlement($product, $entitlement);
        if ($fileId > 0 && $fileId !== $resolvedFileId) {
            // Customers may not switch to arbitrary historical files; version
            // access is determined by the product entitlement policy.
            throw new \RuntimeException('The requested version is not available for this purchase.');
        }
        $file = Capsule::table('mod_digitalproducts_files')->where('id', $resolvedFileId)->where('product_id', (int) $product->id)->where('status', 'active')->first();
        if (!$file) { throw new \RuntimeException('The current product file is not available.'); }
        $reason = null;
        if (!$this->entitlements->canDownload($entitlement, $product, $reason)) { throw new \RuntimeException($this->friendlyReason($reason)); }
        $expiry = (int) ($product->download_expiry_hours ?: $product->link_expiry_hours ?: 48);
        return $this->tokenService->generate($entitlement, (int) $file->id, $expiry, $singleUse);
    }

    public function authorizeToken($rawToken, $authenticatedClientId = 0)
    {
        $token = $this->tokenService->find($rawToken);
        if (!$token) { return $this->deny('invalid_token', 'Invalid download token.'); }
        if ($token->revoked_at) { return $this->deny('invalid_token', 'This download token has been revoked.', $token); }
        if ($token->expires_at && strtotime($token->expires_at) <= time()) { return $this->deny('expired', 'This download token has expired.', $token); }
        if ((int) $token->max_uses > 0 && (int) $token->uses >= (int) $token->max_uses) { return $this->deny('expired', 'This download token has already been used.', $token); }
        if ($authenticatedClientId && (int) $token->client_id !== (int) $authenticatedClientId) { return $this->deny('not_entitled', 'This token belongs to another customer.', $token); }

        $entitlement = Capsule::table('mod_digitalproducts_entitlements')->where('id', (int) $token->entitlement_id)->first();
        if (!$entitlement || (int) $entitlement->client_id !== (int) $token->client_id) { return $this->deny('not_entitled', 'The entitlement for this download is no longer available.', $token); }
        $product = Capsule::table('mod_digitalproducts_products')->where('id', (int) $entitlement->product_id)->first();
        if (!$product || (string) $product->status !== 'active') { return $this->deny('disabled_product', 'This product is not currently available for download.', $token, $entitlement); }
        $fileId = $this->entitlements->versionForEntitlement($product, $entitlement);
        if ((int) $token->file_id !== (int) $fileId) { return $this->deny('disabled_version', 'This token was issued for a version that is no longer downloadable.', $token, $entitlement, $product); }
        $file = Capsule::table('mod_digitalproducts_files')->where('id', (int) $fileId)->where('product_id', (int) $entitlement->product_id)->where('status', 'active')->first();
        if (!$file) { return $this->deny('disabled_version', 'This product version is not active.', $token, $entitlement, $product); }

        $path = $this->storage->absolutePath($file->storage_key, $file->file_path);
        if (!$path || !is_file($path) || !is_readable($path)) { return $this->deny('file_missing', 'The product file is currently unavailable.', $token, $entitlement, $product, $file); }

        $reason = null;
        if (!$this->entitlements->canDownload($entitlement, $product, $reason)) { return $this->deny($reason ?: 'not_entitled', $this->friendlyReason($reason), $token, $entitlement, $product, $file); }

        return array(
            'allowed' => true,
            'token' => $token,
            'entitlement' => $entitlement,
            'product' => $product,
            'file' => $file,
            'path' => $path,
        );
    }

    public function consumeAuthorized(array $authorization)
    {
        $token = $authorization['token'];
        $entitlement = $authorization['entitlement'];
        $product = $authorization['product'];
        $claimed = $this->tokenService->claim((int) $token->id);
        if (!$claimed) { return array('success' => false, 'status' => 'expired', 'message' => 'This download token has already expired or been used.'); }
        $consumed = $this->entitlements->consumeDownload($entitlement, $product);
        if (!$consumed) { return array('success' => false, 'status' => 'limit_exceeded', 'message' => 'The download limit has been reached.'); }
        return array('success' => true);
    }

    private function deny($status, $message, $token = null, $entitlement = null, $product = null, $file = null)
    {
        return array(
            'allowed' => false,
            'status' => $status,
            'message' => $message,
            'token' => $token,
            'entitlement' => $entitlement,
            'product' => $product,
            'file' => $file,
        );
    }

    private function friendlyReason($reason)
    {
        $map = array(
            'not_entitled' => 'You are not entitled to this download.',
            'expired' => 'This download entitlement has expired.',
            'disabled_product' => 'This product is not currently available for download.',
            'disabled_version' => 'This product version is not currently available for download.',
            'service_inactive' => 'The related service is not active.',
            'limit_exceeded' => 'The download limit has been reached.',
        );
        return isset($map[$reason]) ? $map[$reason] : 'This download is currently unavailable.';
    }
}
