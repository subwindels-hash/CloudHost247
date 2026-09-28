<?php
namespace CloudHost247\ModuleManager\Registry;

use CloudHost247\ModuleManager\Manifest\Manifest;

/**
 * State store for installed modules, uploaded packages, installed files and
 * lifecycle events.
 *
 * The installer and the admin controller depend on this contract rather than
 * on the database implementation, so the installation pipeline can be executed
 * and verified in tests exactly as it runs in production.
 */
interface ModuleRegistry
{
    /* modules */
    public function all();
    public function find($moduleId);
    public function installedIndex();
    public function manifestArray($row);
    public function manifest($moduleId);
    public function recordInstallation(Manifest $manifest, array $facts, $adminId);
    public function setEnabled($moduleId, $enabled, $adminId);
    public function markFailed($moduleId, $detail);
    public function recordHealth($moduleId, $status, $detail);
    public function forget($moduleId);

    /* packages */
    public function recordPackage(array $attributes);
    public function packages($limit = 50);
    public function package($checksum);
    public function setPackageStatus($checksum, $status, $reason = '');
    public function forgetPackage($checksum);

    /* installed files */
    public function replaceFileManifest($moduleId, array $files);
    public function files($moduleId);

    /* manifest-declared, non-secret module settings */
    public function settings($moduleId);
    public function saveSettings($moduleId, array $values, $adminId);

    /* events */
    public function recordEvent(array $event);
    public function events(array $filters = array(), $page = 1, $perPage = 25);
}
