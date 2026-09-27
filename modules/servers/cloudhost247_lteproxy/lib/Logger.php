<?php

declare(strict_types=1);

namespace CloudHost247\LTEProxy;

/**
 * CloudHost247 LTE Proxy Module Logger
 *
 * Provides structured logging for module activities, API requests,
 * errors, and debugging information.
 *
 * @package CloudHost247\LTEProxy
 * @version 1.0.0
 */
class Logger
{
    /** @var string Log file path */
    private string $logFile;

    /** @var int Minimum log level */
    private int $minLevel;

    /** @var bool Whether logging is enabled */
    private bool $enabled;

    /** @var int Maximum log file size in bytes (10MB) */
    private const MAX_FILE_SIZE = 10485760;

    /** @var int Maximum number of log files to keep */
    private const MAX_LOG_FILES = 5;

    /** @var array Log level mapping */
    private const LEVELS = [
        'DEBUG' => 100,
        'INFO' => 200,
        'NOTICE' => 250,
        'WARNING' => 300,
        'ERROR' => 400,
        'CRITICAL' => 500,
        'ALERT' => 550,
        'EMERGENCY' => 600,
    ];

    /**
     * Constructor
     *
     * @param array $config Module configuration
     */
    public function __construct(array $config = [])
    {
        $this->enabled = (bool) ($config['logging_enabled'] ?? true);
        $this->minLevel = self::LEVELS[strtoupper($config['log_level'] ?? 'DEBUG')] ?? self::LEVELS['DEBUG'];

        $logDir = $config['log_directory'] ?? __DIR__ . '/../logs';

        // Ensure log directory exists
        if (!is_dir($logDir)) {
            @mkdir($logDir, 0755, true);
        }

        $this->logFile = $logDir . '/cloudhost247_lteproxy.log';
    }

    /**
     * Log debug message
     *
     * @param string $message Log message
     * @param array $context Additional context
     * @return void
     */
    public function debug(string $message, array $context = []): void
    {
        $this->log('DEBUG', $message, $context);
    }

    /**
     * Log info message
     *
     * @param string $message Log message
     * @param array $context Additional context
     * @return void
     */
    public function info(string $message, array $context = []): void
    {
        $this->log('INFO', $message, $context);
    }

    /**
     * Log notice message
     *
     * @param string $message Log message
     * @param array $context Additional context
     * @return void
     */
    public function notice(string $message, array $context = []): void
    {
        $this->log('NOTICE', $message, $context);
    }

    /**
     * Log warning message
     *
     * @param string $message Log message
     * @param array $context Additional context
     * @return void
     */
    public function warning(string $message, array $context = []): void
    {
        $this->log('WARNING', $message, $context);
    }

    /**
     * Log error message
     *
     * @param string $message Log message
     * @param array $context Additional context
     * @return void
     */
    public function error(string $message, array $context = []): void
    {
        $this->log('ERROR', $message, $context);
    }

    /**
     * Log critical message
     *
     * @param string $message Log message
     * @param array $context Additional context
     * @return void
     */
    public function critical(string $message, array $context = []): void
    {
        $this->log('CRITICAL', $message, $context);
    }

    /**
     * Log API request
     *
     * @param string $method HTTP method
     * @param string $endpoint API endpoint
     * @param int $httpCode HTTP response code
     * @param float $responseTime Response time in seconds
     * @param array|null $requestBody Request body
     * @param array|null $responseBody Response body
     * @return void
     */
    public function logApiRequest(
        string $method,
        string $endpoint,
        int $httpCode,
        float $responseTime,
        ?array $requestBody = null,
        ?array $responseBody = null
    ): void {
        $context = [
            'method' => $method,
            'endpoint' => $endpoint,
            'http_code' => $httpCode,
            'response_time_ms' => round($responseTime * 1000, 2),
        ];

        if ($requestBody !== null) {
            // Mask sensitive fields
            $context['request'] = $this->maskSensitiveData($requestBody);
        }

        if ($responseBody !== null) {
            $context['response'] = $responseBody;
        }

        $level = $httpCode >= 400 ? 'ERROR' : 'DEBUG';
        $this->log($level, 'API Request: ' . $method . ' ' . $endpoint, $context);
    }

    /**
     * Log module action
     *
     * @param string $action Action name
     * @param int $serviceId Service ID
     * @param array $params Action parameters
     * @return void
     */
    public function logModuleAction(string $action, int $serviceId, array $params = []): void
    {
        $this->log('INFO', 'Module Action: ' . $action, [
            'service_id' => $serviceId,
            'params' => $this->maskSensitiveData($params),
        ]);
    }

    /**
     * Log exception details
     *
     * @param \Throwable $exception Exception to log
     * @param string $context Additional context
     * @return void
     */
    public function logException(\Throwable $exception, string $context = ''): void
    {
        $data = [
            'message' => $exception->getMessage(),
            'code' => $exception->getCode(),
            'file' => $exception->getFile(),
            'line' => $exception->getLine(),
            'trace' => $exception->getTraceAsString(),
        ];

        if ($exception instanceof ApiException) {
            $data['api_data'] = $exception->getErrorData();
            $data['endpoint'] = $exception->getEndpoint();
        }

        if (!empty($context)) {
            $data['context'] = $context;
        }

        $this->log('ERROR', 'Exception: ' . $exception->getMessage(), $data);
    }

    /**
     * Write log entry
     *
     * @param string $level Log level
     * @param string $message Log message
     * @param array $context Additional context
     * @return void
     */
    private function log(string $level, string $message, array $context = []): void
    {
        if (!$this->enabled) {
            return;
        }

        if ((self::LEVELS[$level] ?? 0) < $this->minLevel) {
            return;
        }

        // Rotate log if needed
        $this->rotateLogIfNeeded();

        $entry = [
            'timestamp' => date('Y-m-d H:i:s.u'),
            'level' => $level,
            'message' => $message,
            'context' => $context,
            'pid' => getmypid(),
        ];

        $line = json_encode($entry, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;

        @file_put_contents($this->logFile, $line, FILE_APPEND | LOCK_EX);
    }

    /**
     * Rotate log file if it exceeds maximum size
     *
     * @return void
     */
    private function rotateLogIfNeeded(): void
    {
        if (!file_exists($this->logFile)) {
            return;
        }

        if (filesize($this->logFile) < self::MAX_FILE_SIZE) {
            return;
        }

        // Rotate existing log files
        for ($i = self::MAX_LOG_FILES - 1; $i > 0; $i--) {
            $oldFile = $this->logFile . '.' . $i;
            $newFile = $this->logFile . '.' . ($i + 1);

            if (file_exists($oldFile)) {
                @rename($oldFile, $newFile);
            }
        }

        // Rotate current log
        @rename($this->logFile, $this->logFile . '.1');
    }

    /**
     * Mask sensitive data in logs
     *
     * @param array $data Data to mask
     * @return array Masked data
     */
    private function maskSensitiveData(array $data): array
    {
        $sensitiveKeys = [
            'password', 'api_key', 'api_secret', 'secret', 'token',
            'auth_password', 'credential', 'private_key', 'secret_key',
        ];

        $masked = [];

        foreach ($data as $key => $value) {
            $lowerKey = strtolower($key);

            if (in_array($lowerKey, $sensitiveKeys, true) && is_string($value)) {
                $masked[$key] = str_repeat('*', min(strlen($value), 8));
            } elseif (is_array($value)) {
                $masked[$key] = $this->maskSensitiveData($value);
            } else {
                $masked[$key] = $value;
            }
        }

        return $masked;
    }

    /**
     * Get recent log entries
     *
     * @param int $lines Number of lines to retrieve
     * @return array Log entries
     */
    public function getRecentLogs(int $lines = 100): array
    {
        if (!file_exists($this->logFile)) {
            return [];
        }

        $entries = [];
        $handle = @fopen($this->logFile, 'r');

        if (!$handle) {
            return [];
        }

        // Read last N lines
        $allLines = [];
        while (($line = fgets($handle)) !== false) {
            $allLines[] = $line;
        }
        fclose($handle);

        $recentLines = array_slice($allLines, -$lines);

        foreach ($recentLines as $line) {
            $decoded = json_decode(trim($line), true);
            if ($decoded !== null) {
                $entries[] = $decoded;
            }
        }

        return $entries;
    }

    /**
     * Clear all logs
     *
     * @return bool Success status
     */
    public function clearLogs(): bool
    {
        if (file_exists($this->logFile)) {
            @unlink($this->logFile);
        }

        // Remove rotated logs
        for ($i = 1; $i <= self::MAX_LOG_FILES; $i++) {
            $rotatedFile = $this->logFile . '.' . $i;
            if (file_exists($rotatedFile)) {
                @unlink($rotatedFile);
            }
        }

        return true;
    }

    /**
     * Get log file size
     *
     * @return int File size in bytes
     */
    public function getLogFileSize(): int
    {
        if (!file_exists($this->logFile)) {
            return 0;
        }

        return filesize($this->logFile);
    }

    /**
     * Check if logging is enabled
     *
     * @return bool
     */
    public function isEnabled(): bool
    {
        return $this->enabled;
    }
}
