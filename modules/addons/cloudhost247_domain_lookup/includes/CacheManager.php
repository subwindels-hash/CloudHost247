<?php
/**
 * CloudHost247 Tools - Cache Manager
 *
 * Handles caching of lookup results using either WHMCS database (Capsule)
 * or file-based caching with configurable duration.
 *
 * @package    WHMCS
 * @author     CloudHost247 Tools Team
 * @copyright  Copyright (c) 2024
 * @license    MIT License
 */

namespace WHMCS\Module\Addon\CloudHost247Tools;

use Capsule;
use Exception;

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

class CacheManager
{
    /**
     * @var string Cache method: 'database' or 'file'
     */
    private $method;
    
    /**
     * @var int Cache duration in seconds
     */
    private $duration;
    
    /**
     * @var string File cache directory
     */
    private $cacheDir;
    
    /**
     * Constructor
     */
    public function __construct()
    {
        $config = $this->getModuleConfig();
        
        $this->method = !empty($config['cache_method']) ? $config['cache_method'] : 'database';
        $durationMinutes = !empty($config['cache_duration']) ? (int)$config['cache_duration'] : 10;
        $this->duration = $durationMinutes * 60;
        $this->cacheDir = CLOUDHOST247_TOOLS_CACHE_DIR;
        
        // Ensure cache directory exists for file method
        if ($this->method === 'file' && !is_dir($this->cacheDir)) {
            @mkdir($this->cacheDir, 0755, true);
        }
    }
    
    /**
     * Get cached data by key
     *
     * @param string $key
     * @return mixed|false Returns cached data or false if not found/expired
     */
    public function get($key)
    {
        $cacheKey = $this->sanitizeKey($key);
        
        try {
            if ($this->method === 'database') {
                return $this->getFromDatabase($cacheKey);
            }
            
            return $this->getFromFile($cacheKey);
        } catch (Exception $e) {
            return false;
        }
    }
    
    /**
     * Store data in cache
     *
     * @param string $key
     * @param mixed $data
     * @return bool
     */
    public function set($key, $data)
    {
        $cacheKey = $this->sanitizeKey($key);
        
        try {
            if ($this->method === 'database') {
                return $this->setInDatabase($cacheKey, $data);
            }
            
            return $this->setInFile($cacheKey, $data);
        } catch (Exception $e) {
            return false;
        }
    }
    
    /**
     * Delete cached data by key
     *
     * @param string $key
     * @return bool
     */
    public function delete($key)
    {
        $cacheKey = $this->sanitizeKey($key);
        
        try {
            if ($this->method === 'database') {
                return $this->deleteFromDatabase($cacheKey);
            }
            
            return $this->deleteFromFile($cacheKey);
        } catch (Exception $e) {
            return false;
        }
    }
    
    /**
     * Clear all expired cache entries
     *
     * @return bool
     */
    public function clearExpired()
    {
        try {
            if ($this->method === 'database') {
                Capsule::table('cloudhost247_domain_lookup_cache')
                    ->where('expires', '<', time())
                    ->delete();
            } else {
                $this->clearExpiredFiles();
            }
            
            return true;
        } catch (Exception $e) {
            return false;
        }
    }
    
    /**
     * Clear all cache
     *
     * @return bool
     */
    public function clearAll()
    {
        try {
            if ($this->method === 'database') {
                Capsule::table('cloudhost247_domain_lookup_cache')->truncate();
            } else {
                $this->clearAllFiles();
            }
            
            return true;
        } catch (Exception $e) {
            return false;
        }
    }
    
    /**
     * Get from database cache
     *
     * @param string $key
     * @return mixed|false
     */
    private function getFromDatabase($key)
    {
        try {
            $row = Capsule::table('cloudhost247_domain_lookup_cache')
                ->where('cache_key', $key)
                ->where('expires', '>', time())
                ->first();
            
            if ($row) {
                $data = json_decode($row->cache_value, true);
                return ($data !== null) ? $data : false;
            }
            
            return false;
        } catch (Exception $e) {
            return false;
        }
    }
    
    /**
     * Store in database cache
     *
     * @param string $key
     * @param mixed $data
     * @return bool
     */
    private function setInDatabase($key, $data)
    {
        try {
            $expires = time() + $this->duration;
            $value = json_encode($data);
            
            // Delete existing entry if any
            Capsule::table('cloudhost247_domain_lookup_cache')
                ->where('cache_key', $key)
                ->delete();
            
            // Insert new entry
            Capsule::table('cloudhost247_domain_lookup_cache')->insert([
                'cache_key'   => $key,
                'cache_value' => $value,
                'expires'     => $expires,
                'created_at'  => date('Y-m-d H:i:s'),
            ]);
            
            return true;
        } catch (Exception $e) {
            return false;
        }
    }
    
    /**
     * Delete from database cache
     *
     * @param string $key
     * @return bool
     */
    private function deleteFromDatabase($key)
    {
        try {
            Capsule::table('cloudhost247_domain_lookup_cache')
                ->where('cache_key', $key)
                ->delete();
            
            return true;
        } catch (Exception $e) {
            return false;
        }
    }
    
    /**
     * Get from file cache
     *
     * @param string $key
     * @return mixed|false
     */
    private function getFromFile($key)
    {
        $file = $this->cacheDir . '/' . $key . '.cache';
        
        if (!file_exists($file)) {
            return false;
        }
        
        $data = @unserialize(@file_get_contents($file));
        
        if ($data === false || !isset($data['expires']) || !isset($data['value'])) {
            @unlink($file);
            return false;
        }
        
        if ($data['expires'] < time()) {
            @unlink($file);
            return false;
        }
        
        return $data['value'];
    }
    
    /**
     * Store in file cache
     *
     * @param string $key
     * @param mixed $data
     * @return bool
     */
    private function setInFile($key, $data)
    {
        $file = $this->cacheDir . '/' . $key . '.cache';
        $content = serialize([
            'expires' => time() + $this->duration,
            'value'   => $data,
        ]);
        
        return @file_put_contents($file, $content, LOCK_EX) !== false;
    }
    
    /**
     * Delete from file cache
     *
     * @param string $key
     * @return bool
     */
    private function deleteFromFile($key)
    {
        $file = $this->cacheDir . '/' . $key . '.cache';
        
        if (file_exists($file)) {
            return @unlink($file);
        }
        
        return true;
    }
    
    /**
     * Clear expired file cache entries
     */
    private function clearExpiredFiles()
    {
        if (!is_dir($this->cacheDir)) {
            return;
        }
        
        $files = glob($this->cacheDir . '/*.cache');
        $now = time();
        
        if ($files) {
            foreach ($files as $file) {
                $data = @unserialize(@file_get_contents($file));
                if ($data && isset($data['expires']) && $data['expires'] < $now) {
                    @unlink($file);
                }
            }
        }
    }
    
    /**
     * Clear all file cache
     */
    private function clearAllFiles()
    {
        if (!is_dir($this->cacheDir)) {
            return;
        }
        
        $files = glob($this->cacheDir . '/*.cache');
        
        if ($files) {
            foreach ($files as $file) {
                @unlink($file);
            }
        }
    }
    
    /**
     * Sanitize cache key
     *
     * @param string $key
     * @return string
     */
    private function sanitizeKey($key)
    {
        return preg_replace('/[^a-zA-Z0-9_-]/', '_', substr($key, 0, 200));
    }
    
    /**
     * Get module configuration
     *
     * @return array
     */
    private function getModuleConfig()
    {
        $settings = [];
        
        try {
            $result = Capsule::table('tbladdonmodules')
                ->where('module', 'cloudhost247_domain_lookup')
                ->get();
            
            foreach ($result as $row) {
                $settings[$row->setting] = $row->value;
            }
        } catch (Exception $e) {
            // Use defaults
        }
        
        return $settings;
    }
}
