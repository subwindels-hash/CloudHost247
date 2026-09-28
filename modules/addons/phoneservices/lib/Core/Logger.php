<?php
/**
 * Logger - Centralized logging with retention policy
 */

namespace PhoneServices\Core;

class Logger
{
    const LEVEL_DEBUG = 'debug';
    const LEVEL_INFO = 'info';
    const LEVEL_WARNING = 'warning';
    const LEVEL_ERROR = 'error';
    
    /**
     * Log a message
     */
    public static function log($level, $message, $context = [])
    {
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 2);
        $caller = isset($trace[1]) ? $trace[1] : $trace[0];
        $source = (isset($caller['class']) ? $caller['class'] : '') . '::' . (isset($caller['function']) ? $caller['function'] : 'unknown');
        
        $data = [
            'level' => $level,
            'message' => $message,
            'context' => json_encode($context),
            'source' => $source,
            'ip_address' => $_SERVER['REMOTE_ADDR'] ?? 'cli',
            'created_at' => date('Y-m-d H:i:s'),
        ];
        
        // Never let observability take down a customer request during install/upgrade.
        try {
            Database::insert('mod_phoneservices_logs', $data);
        } catch (\Exception $ignored) {
        }
        
        // Also log to WHMCS activity log for errors
        if ($level === self::LEVEL_ERROR) {
            logActivity('PhoneServices Error: ' . $message);
        }
    }
    
    public static function debug($message, $context = [])
    {
        if (self::isDebugMode()) {
            self::log(self::LEVEL_DEBUG, $message, $context);
        }
    }
    
    public static function info($message, $context = [])
    {
        self::log(self::LEVEL_INFO, $message, $context);
    }
    
    public static function warning($message, $context = [])
    {
        self::log(self::LEVEL_WARNING, $message, $context);
    }
    
    public static function error($message, $context = [])
    {
        self::log(self::LEVEL_ERROR, $message, $context);
    }
    
    /**
     * Get recent logs
     */
    public static function getRecentLogs($limit = 100, $level = null)
    {
        $where = [];
        if ($level) {
            $where['level'] = $level;
        }
        
        return Database::select('mod_phoneservices_logs', '*', $where, 'id', 'DESC', max(1, (int) $limit));
    }
    
    /**
     * Clean old logs based on retention policy
     */
    public static function cleanOldLogs()
    {
        $retentionDays = (int) Config::get('log_retention_days', 90);
        $cutoffDate = date('Y-m-d H:i:s', strtotime("-{$retentionDays} days"));
        
        $affected = Database::table('mod_phoneservices_logs')->where('created_at', '<', $cutoffDate)->delete();
        self::info("Cleaned {$affected} old log records");
        
        return $affected;
    }
    
    /**
     * Check if debug mode is enabled
     */
    public static function isDebugMode()
    {
        return Config::get('api_mode', 'sandbox') === 'sandbox';
    }
}
