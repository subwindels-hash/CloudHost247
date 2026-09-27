<?php

declare(strict_types=1);

namespace CloudHost247\LTEProxy;

/**
 * CloudHost247 LTE Proxy Simple File Cache
 *
 * Provides caching for API responses to reduce API calls and improve performance.
 *
 * @package CloudHost247\LTEProxy
 * @version 1.0.0
 */
class Cache
{
    /** @var string Cache directory path */
    private string $cacheDir;

    /** @var int Default cache TTL in seconds */
    private int $defaultTtl;

    /** @var bool Whether caching is enabled */
    private bool $enabled;

    /** @var int Maximum cache file size in bytes (5MB) */
    private const MAX_FILE_SIZE = 5242880;

    /** @var int Cache cleanup probability (1 in N requests) */
    private const CLEANUP_PROBABILITY = 100;

    /**
     * Constructor
     *
     * @param array $config Module configuration
     */
    public function __construct(array $config = [])
    {
        $this->enabled = (bool) ($config['cache_enabled'] ?? true);
        $this->defaultTtl = (int) ($config['cache_ttl'] ?? 300);

        $this->cacheDir = $config['cache_directory'] ?? __DIR__ . '/../cache';

        if (!is_dir($this->cacheDir)) {
            @mkdir($this->cacheDir, 0755, true);
        }

        // Random cleanup
        if (random_int(1, self::CLEANUP_PROBABILITY) === 1) {
            $this->cleanup();
        }
    }

    /**
     * Get cached value
     *
     * @param string $key Cache key
     * @return mixed|null Cached value or null
     */
    public function get(string $key)
    {
        if (!$this->enabled) {
            return null;
        }

        $file = $this->getCacheFile($key);

        if (!file_exists($file)) {
            return null;
        }

        $data = @unserialize(@file_get_contents($file));

        if ($data === false) {
            @unlink($file);
            return null;
        }

        // Check expiration
        if (isset($data['expires']) && $data['expires'] < time()) {
            @unlink($file);
            return null;
        }

        return $data['value'] ?? null;
    }

    /**
     * Set cached value
     *
     * @param string $key Cache key
     * @param mixed $value Value to cache
     * @param int|null $ttl Time to live in seconds
     * @return bool Success status
     */
    public function set(string $key, $value, ?int $ttl = null): bool
    {
        if (!$this->enabled) {
            return false;
        }

        $file = $this->cacheDir . '/' . $this->sanitizeKey($key) . '.cache';

        $data = [
            'key' => $key,
            'value' => $value,
            'created' => time(),
            'expires' => time() + ($ttl ?? $this->defaultTtl),
        ];

        $serialized = serialize($data);

        if (strlen($serialized) > self::MAX_FILE_SIZE) {
            return false;
        }

        return @file_put_contents($file, $serialized, LOCK_EX) !== false;
    }

    /**
     * Delete cached value
     *
     * @param string $key Cache key
     * @return bool Success status
     */
    public function delete(string $key): bool
    {
        $file = $this->getCacheFile($key);

        if (file_exists($file)) {
            return @unlink($file);
        }

        return true;
    }

    /**
     * Check if key exists in cache
     *
     * @param string $key Cache key
     * @return bool
     */
    public function has(string $key): bool
    {
        return $this->get($key) !== null;
    }

    /**
     * Remember value - get from cache or compute
     *
     * @param string $key Cache key
     * @param callable $callback Callback to compute value
     * @param int|null $ttl Cache TTL
     * @return mixed
     */
    public function remember(string $key, callable $callback, ?int $ttl = null)
    {
        $cached = $this->get($key);

        if ($cached !== null) {
            return $cached;
        }

        $value = $callback();
        $this->set($key, $value, $ttl);

        return $value;
    }

    /**
     * Increment cached value
     *
     * @param string $key Cache key
     * @param int $amount Amount to increment
     * @return int New value
     */
    public function increment(string $key, int $amount = 1): int
    {
        $value = (int) $this->get($key);
        $value += $amount;
        $this->set($key, $value);

        return $value;
    }

    /**
     * Decrement cached value
     *
     * @param string $key Cache key
     * @param int $amount Amount to decrement
     * @return int New value
     */
    public function decrement(string $key, int $amount = 1): int
    {
        return $this->increment($key, -$amount);
    }

    /**
     * Flush all cached data
     *
     * @return bool Success status
     */
    public function flush(): bool
    {
        $files = glob($this->cacheDir . '/*.cache');

        if ($files === false) {
            return false;
        }

        foreach ($files as $file) {
            @unlink($file);
        }

        return true;
    }

    /**
     * Get cache statistics
     *
     * @return array
     */
    public function getStats(): array
    {
        $files = glob($this->cacheDir . '/*.cache');
        $totalSize = 0;
        $totalFiles = 0;

        if ($files !== false) {
            foreach ($files as $file) {
                $totalFiles++;
                $totalSize += filesize($file);
            }
        }

        return [
            'enabled' => $this->enabled,
            'directory' => $this->cacheDir,
            'file_count' => $totalFiles,
            'total_size_bytes' => $totalSize,
            'total_size_formatted' => $this->formatBytes($totalSize),
            'default_ttl' => $this->defaultTtl,
        ];
    }

    /**
     * Clean up expired cache files
     *
     * @return int Number of files removed
     */
    public function cleanup(): int
    {
        $files = glob($this->cacheDir . '/*.cache');
        $removed = 0;

        if ($files === false) {
            return 0;
        }

        $now = time();

        foreach ($files as $file) {
            $data = @unserialize(@file_get_contents($file));

            if ($data === false || (isset($data['expires']) && $data['expires'] < $now)) {
                @unlink($file);
                $removed++;
            }
        }

        return $removed;
    }

    /**
     * Get cache file path for key
     *
     * @param string $key Cache key
     * @return string
     */
    private function getCacheFile(string $key): string
    {
        return $this->cacheDir . '/' . $this->sanitizeKey($key) . '.cache';
    }

    /**
     * Sanitize cache key for filesystem
     *
     * @param string $key Original key
     * @return string Sanitized key
     */
    private function sanitizeKey(string $key): string
    {
        return preg_replace('/[^a-zA-Z0-9_-]/', '_', $key);
    }

    /**
     * Format bytes to human readable
     *
     * @param int $bytes Bytes
     * @return string Formatted string
     */
    private function formatBytes(int $bytes): string
    {
        $units = ['B', 'KB', 'MB', 'GB'];
        $unitIndex = 0;

        while ($bytes >= 1024 && $unitIndex < count($units) - 1) {
            $bytes /= 1024;
            $unitIndex++;
        }

        return round($bytes, 2) . ' ' . $units[$unitIndex];
    }
}
