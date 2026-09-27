<?php
/**
 * Cache Manager
 * Supports file-based and Redis caching
 */

class CacheManager {
    private $config;
    private $driver;
    private $redis;
    
    public function __construct($config) {
        $this->config = $config;
        
        if ($config['cache_enabled'] && $config['cache_driver'] === 'redis') {
            $this->initRedis();
        }
    }
    
    /**
     * Initialize Redis connection
     */
    private function initRedis() {
        try {
            if (!extension_loaded('redis')) {
                $this->config['cache_driver'] = 'file';
                return;
            }
            
            $this->redis = new Redis();
            $this->redis->connect(
                $this->config['redis']['host'],
                $this->config['redis']['port']
            );
            
            if ($this->config['redis']['password']) {
                $this->redis->auth($this->config['redis']['password']);
            }
            
            $this->redis->select($this->config['redis']['database']);
        } catch (Exception $e) {
            $this->config['cache_driver'] = 'file';
        }
    }
    
    /**
     * Generate cache key
     */
    private function sanitizeKey($key) {
        return preg_replace('/[^a-zA-Z0-9_-]/', '_', $key);
    }
    
    /**
     * Get cached data
     */
    public function get($key) {
        if (!$this->config['cache_enabled']) {
            return null;
        }
        
        $key = $this->sanitizeKey($key);
        
        if ($this->config['cache_driver'] === 'redis' && $this->redis) {
            $data = $this->redis->get($key);
            return $data ? json_decode($data, true) : null;
        }
        
        // File-based cache
        $file = $this->config['cache_path'] . $key . '.cache';
        if (!file_exists($file)) {
            return null;
        }
        
        $data = unserialize(file_get_contents($file));
        if (!isset($data['expires']) || $data['expires'] < time()) {
            unlink($file);
            return null;
        }
        
        return $data['value'];
    }
    
    /**
     * Set cache data
     */
    public function set($key, $value, $ttl = 300) {
        if (!$this->config['cache_enabled']) {
            return false;
        }
        
        $key = $this->sanitizeKey($key);
        
        if ($this->config['cache_driver'] === 'redis' && $this->redis) {
            return $this->redis->setex($key, $ttl, json_encode($value));
        }
        
        // File-based cache
        $file = $this->config['cache_path'] . $key . '.cache';
        $data = [
            'expires' => time() + $ttl,
            'value' => $value
        ];
        
        return file_put_contents($file, serialize($data), LOCK_EX) !== false;
    }
    
    /**
     * Delete cached data
     */
    public function delete($key) {
        $key = $this->sanitizeKey($key);
        
        if ($this->config['cache_driver'] === 'redis' && $this->redis) {
            return $this->redis->del($key);
        }
        
        $file = $this->config['cache_path'] . $key . '.cache';
        if (file_exists($file)) {
            return unlink($file);
        }
        
        return false;
    }
    
    /**
     * Clear all cache
     */
    public function clear() {
        if ($this->config['cache_driver'] === 'redis' && $this->redis) {
            return $this->redis->flushDB();
        }
        
        // Clear file cache
        $files = glob($this->config['cache_path'] . '*.cache');
        foreach ($files as $file) {
            unlink($file);
        }
        
        return true;
    }
}