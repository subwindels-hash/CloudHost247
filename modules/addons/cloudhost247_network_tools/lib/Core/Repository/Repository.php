<?php
namespace CloudHost247\NetworkTools\Core\Repository;

use WHMCS\Database\Capsule;

/**
 * Small shared base for the module's tables.
 *
 * Every table is prefixed mod_cloudhost247_nt_ so the module owns its own
 * namespace inside the existing WHMCS database and never touches core tables
 * except to read the customer's own domains/services.
 */
abstract class Repository
{
    const PREFIX = 'mod_cloudhost247_nt_';

    protected function table($name)
    {
        return Capsule::table(self::PREFIX . $name);
    }

    protected function has($name)
    {
        try {
            return Capsule::schema()->hasTable(self::PREFIX . $name);
        } catch (\Throwable $unavailable) {
            return false;
        }
    }

    protected function now()
    {
        return date('Y-m-d H:i:s');
    }

    protected function decode($value, $default = array())
    {
        if (is_array($value)) {
            return $value;
        }
        if (!is_string($value) || $value === '') {
            return $default;
        }
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : $default;
    }

    protected function encode($value)
    {
        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    /** Redacts anything secret-looking before it is persisted, belt and braces. */
    protected function redact(array $row)
    {
        if (class_exists('CloudHost247\\Foundation\\Security\\SecretPolicy')) {
            return \CloudHost247\Foundation\Security\SecretPolicy::redact($row);
        }
        foreach ($row as $key => $value) {
            if (preg_match('/pass|secret|token|key|credential/i', (string) $key)) {
                $row[$key] = '[REDACTED]';
            }
        }
        return $row;
    }
}
