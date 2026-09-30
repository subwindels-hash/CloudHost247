<?php
namespace DigitalProducts\Support;

use WHMCS\Database\Capsule;

final class Audit
{
    const MODULE = 'digitalproducts';

    public static function record($action, $resourceType, $resourceId, array $before = array(), array $after = array(), $result = 'success', $failureReason = null)
    {
        try {
            if (class_exists('CloudHost247\\Foundation\\Support\\AuditLogger') && Capsule::schema()->hasTable('mod_cloudhost247_audit_events')) {
                return \CloudHost247\Foundation\Support\AuditLogger::record(self::MODULE, $action, $resourceType, (string) $resourceId, $before, $after, $result, $failureReason);
            }
        } catch (\Throwable $ignored) {}

        $message = 'DigitalProducts audit: ' . $action . ' ' . $resourceType . '#' . $resourceId . ' ' . $result;
        if ($failureReason) { $message .= ' - ' . substr((string) $failureReason, 0, 500); }
        if (function_exists('logActivity')) { logActivity($message); }
        return null;
    }
}
