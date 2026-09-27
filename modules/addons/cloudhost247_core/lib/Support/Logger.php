<?php
namespace CloudHost247\Foundation\Support;

use CloudHost247\Foundation\Security\SecretPolicy;

final class Logger
{
    public static function write($module, $level, $event, array $context = array(), $correlationId = null)
    {
        $allowed = array('debug', 'info', 'warning', 'error', 'critical');
        if (!in_array($level, $allowed, true)) { $level = 'error'; }
        $safe = SecretPolicy::redact($context);
        $correlationId = $correlationId ?: self::correlationId();
        if (class_exists('WHMCS\\Database\\Capsule') && \WHMCS\Database\Capsule::schema()->hasTable('mod_cloudhost247_logs')) {
            \WHMCS\Database\Capsule::table('mod_cloudhost247_logs')->insert(array(
                'module' => substr($module, 0, 64), 'level' => $level, 'event' => substr($event, 0, 128),
                'correlation_id' => $correlationId, 'context_json' => json_encode($safe), 'created_at' => date('Y-m-d H:i:s'),
            ));
        }
        if (function_exists('logModuleCall') && in_array($level, array('error', 'critical'), true)) {
            logModuleCall($module, $event, $safe, null, null, array());
        }
        return $correlationId;
    }

    public static function correlationId()
    {
        try { return bin2hex(random_bytes(16)); } catch (\Exception $e) { return hash('sha256', uniqid('', true)); }
    }
}
