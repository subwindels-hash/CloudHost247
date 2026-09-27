<?php
/**
 * Rate Limiter
 * Limits requests per user/IP to prevent abuse
 */

class RateLimiter {
    private $config;
    private $data = [];
    private $file;
    
    public function __construct($config) {
        $this->config = $config;
        $this->file = $config['cache_path'] . 'rate-limits.json';
        $this->load();
    }
    
    /**
     * Load rate limit data
     */
    private function load() {
        if (file_exists($this->file)) {
            $content = file_get_contents($this->file);
            $this->data = json_decode($content, true) ?: [];
        }
    }
    
    /**
     * Save rate limit data
     */
    private function save() {
        file_put_contents($this->file, json_encode($this->data), LOCK_EX);
    }
    
    /**
     * Check if request is allowed
     */
    public function check($clientId, $ip, $category, $action) {
        if (!$this->config['rate_limit']['enabled']) {
            return true;
        }
        
        $now = time();
        $identifier = $clientId > 0 ? 'client_' . $clientId : 'ip_' . md5($ip);
        
        if (!isset($this->data[$identifier])) {
            $this->data[$identifier] = [
                'requests' => [],
                'blocked_until' => 0
            ];
        }
        
        // Check if blocked
        if ($this->data[$identifier]['blocked_until'] > $now) {
            return false;
        }
        
        // Clean old requests
        $this->data[$identifier]['requests'] = array_filter(
            $this->data[$identifier]['requests'],
            function($timestamp) use ($now) {
                return $timestamp > ($now - 86400); // Keep last 24 hours
            }
        );
        
        // Add current request
        $this->data[$identifier]['requests'][] = $now;
        
        // Check limits
        $limits = $this->config['rate_limit'];
        
        // Per minute
        $minuteAgo = $now - 60;
        $perMinute = count(array_filter($this->data[$identifier]['requests'], function($t) use ($minuteAgo) {
            return $t > $minuteAgo;
        }));
        
        if ($perMinute > $limits['requests_per_minute']) {
            $this->data[$identifier]['blocked_until'] = $now + 60;
            $this->save();
            return false;
        }
        
        // Per hour
        $hourAgo = $now - 3600;
        $perHour = count(array_filter($this->data[$identifier]['requests'], function($t) use ($hourAgo) {
            return $t > $hourAgo;
        }));
        
        if ($perHour > $limits['requests_per_hour']) {
            $this->data[$identifier]['blocked_until'] = $now + 3600;
            $this->save();
            return false;
        }
        
        // Per day
        $dayAgo = $now - 86400;
        $perDay = count(array_filter($this->data[$identifier]['requests'], function($t) use ($dayAgo) {
            return $t > $dayAgo;
        }));
        
        if ($perDay > $limits['requests_per_day']) {
            $this->data[$identifier]['blocked_until'] = $now + 86400;
            $this->save();
            return false;
        }
        
        $this->save();
        return true;
    }
    
    /**
     * Get current usage for a user
     */
    public function getUsage($clientId, $ip) {
        $identifier = $clientId > 0 ? 'client_' . $clientId : 'ip_' . md5($ip);
        $now = time();
        
        if (!isset($this->data[$identifier])) {
            return [
                'per_minute' => 0,
                'per_hour' => 0,
                'per_day' => 0,
            ];
        }
        
        $requests = $this->data[$identifier]['requests'];
        
        return [
            'per_minute' => count(array_filter($requests, function($t) use ($now) {
                return $t > ($now - 60);
            })),
            'per_hour' => count(array_filter($requests, function($t) use ($now) {
                return $t > ($now - 3600);
            })),
            'per_day' => count(array_filter($requests, function($t) use ($now) {
                return $t > ($now - 86400);
            })),
        ];
    }
}