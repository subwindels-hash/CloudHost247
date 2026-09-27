<?php

declare(strict_types=1);

namespace CloudHost247\LTEProxy;

/**
 * CloudHost247 LTE Proxy API Rate Limiter
 *
 * Implements rate limiting to prevent API abuse and handle API rate limits.
 *
 * @package CloudHost247\LTEProxy
 * @version 1.0.0
 */
class RateLimiter
{
    /** @var int Maximum requests per time window */
    private int $maxRequests;

    /** @var int Time window in seconds */
    private int $timeWindow;

    /** @var string Cache file for rate limit tracking */
    private string $cacheFile;

    /** @var array Request timestamps */
    private array $requests = [];

    /** @var int Maximum burst requests allowed */
    private int $burstLimit;

    /** @var int Cooldown period in seconds after rate limit hit */
    private int $cooldownPeriod;

    /** @var int|null Rate limit hit timestamp */
    private ?int $rateLimitHitAt = null;

    /**
     * Constructor
     *
     * @param array $config Module configuration
     */
    public function __construct(array $config = [])
    {
        $this->maxRequests = (int) ($config['rate_limit_requests'] ?? 60);
        $this->timeWindow = (int) ($config['rate_limit_window'] ?? 60);
        $this->burstLimit = (int) ($config['rate_limit_burst'] ?? 10);
        $this->cooldownPeriod = (int) ($config['rate_limit_cooldown'] ?? 5);

        $cacheDir = $config['cache_directory'] ?? __DIR__ . '/../cache';

        if (!is_dir($cacheDir)) {
            @mkdir($cacheDir, 0755, true);
        }

        $this->cacheFile = $cacheDir . '/rate_limit.json';
        $this->loadRequests();
    }

    /**
     * Check if a request can proceed
     *
     * @return bool
     */
    public function canProceed(): bool
    {
        $now = time();

        // Check if we're in cooldown period after hitting rate limit
        if ($this->rateLimitHitAt !== null) {
            if (($now - $this->rateLimitHitAt) < $this->cooldownPeriod) {
                return false;
            }
            $this->rateLimitHitAt = null;
        }

        // Clean old requests
        $this->cleanOldRequests($now);

        // Check burst limit
        $recentRequests = count($this->requests);

        if ($recentRequests >= $this->maxRequests) {
            $this->rateLimitHitAt = $now;
            return false;
        }

        // Check burst limit in last second
        $lastSecondRequests = array_filter($this->requests, function ($timestamp) use ($now) {
            return ($now - $timestamp) <= 1;
        });

        if (count($lastSecondRequests) >= $this->burstLimit) {
            return false;
        }

        return true;
    }

    /**
     * Record a request
     *
     * @return void
     */
    public function recordRequest(): void
    {
        $this->requests[] = time();
        $this->saveRequests();
    }

    /**
     * Get estimated wait time in seconds
     *
     * @return int
     */
    public function getWaitTime(): int
    {
        if ($this->rateLimitHitAt !== null) {
            $remaining = $this->cooldownPeriod - (time() - $this->rateLimitHitAt);
            return max(0, $remaining);
        }

        $this->cleanOldRequests(time());

        if (count($this->requests) >= $this->maxRequests) {
            $oldestRequest = min($this->requests);
            $resetTime = $oldestRequest + $this->timeWindow;
            return max(0, $resetTime - time());
        }

        return 0;
    }

    /**
     * Get current request count in window
     *
     * @return int
     */
    public function getCurrentRequestCount(): int
    {
        $this->cleanOldRequests(time());
        return count($this->requests);
    }

    /**
     * Get remaining requests in current window
     *
     * @return int
     */
    public function getRemainingRequests(): int
    {
        return max(0, $this->maxRequests - $this->getCurrentRequestCount());
    }

    /**
     * Get rate limit status
     *
     * @return array
     */
    public function getStatus(): array
    {
        return [
            'max_requests' => $this->maxRequests,
            'time_window' => $this->timeWindow,
            'burst_limit' => $this->burstLimit,
            'current_requests' => $this->getCurrentRequestCount(),
            'remaining_requests' => $this->getRemainingRequests(),
            'wait_time' => $this->getWaitTime(),
            'can_proceed' => $this->canProceed(),
        ];
    }

    /**
     * Reset rate limiter
     *
     * @return void
     */
    public function reset(): void
    {
        $this->requests = [];
        $this->rateLimitHitAt = null;
        $this->saveRequests();
    }

    /**
     * Clean old request timestamps
     *
     * @param int $now Current timestamp
     * @return void
     */
    private function cleanOldRequests(int $now): void
    {
        $cutoff = $now - $this->timeWindow;

        $this->requests = array_filter($this->requests, function ($timestamp) use ($cutoff) {
            return $timestamp > $cutoff;
        });

        $this->requests = array_values($this->requests);
    }

    /**
     * Load request timestamps from cache
     *
     * @return void
     */
    private function loadRequests(): void
    {
        if (!file_exists($this->cacheFile)) {
            $this->requests = [];
            return;
        }

        $data = @json_decode(@file_get_contents($this->cacheFile), true);

        if (is_array($data)) {
            $this->requests = $data['requests'] ?? [];
            $this->rateLimitHitAt = $data['rate_limit_hit_at'] ?? null;
        } else {
            $this->requests = [];
        }
    }

    /**
     * Save request timestamps to cache
     *
     * @return void
     */
    private function saveRequests(): void
    {
        $data = [
            'requests' => $this->requests,
            'rate_limit_hit_at' => $this->rateLimitHitAt,
            'saved_at' => time(),
        ];

        @file_put_contents($this->cacheFile, json_encode($data), LOCK_EX);
    }
}
