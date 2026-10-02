<?php
namespace CloudHost247\NetworkTools\Core\Security;

use CloudHost247\NetworkTools\Core\Repository\RateLimitRepository;

/**
 * Multi-dimensional rate limiting for every externally reachable endpoint
 * (docs section 68).
 *
 * Dimensions checked for one execution:
 *   - per client IP (always, and not spoofable unless an admin explicitly
 *     enables proxy-header trust in the module settings)
 *   - per authenticated customer account
 *   - per tool / endpoint
 *   - global per tool, so one tool cannot be used to exhaust shared outbound
 *     resources (DNS, ports, HTTP fetches) for everyone
 *
 * High-risk tools (port checking, ping, traceroute, crawling, HTTP fetching)
 * carry stricter defaults; an administrator can tighten or relax any tool from
 * Admin → Tools → Rate limits, and the effective limits are what the front end
 * displays.
 */
final class RateLimiter
{
    const TIER_STANDARD = 'standard';
    const TIER_HIGH_RISK = 'high_risk';
    const TIER_LOCAL = 'local';

    /** Fixed-window defaults per tier: dimension => [limit, window seconds]. */
    public static function defaultLimits($tier)
    {
        $table = array(
            self::TIER_LOCAL => array(
                'ip' => array(120, 60),
                'client' => array(120, 60),
                'tool_ip' => array(60, 60),
                'tool_global' => array(1200, 60),
            ),
            self::TIER_STANDARD => array(
                'ip' => array(60, 60),
                'client' => array(60, 60),
                'tool_ip' => array(20, 60),
                'tool_global' => array(600, 60),
            ),
            self::TIER_HIGH_RISK => array(
                'ip' => array(10, 60),
                'client' => array(10, 60),
                'tool_ip' => array(4, 60),
                'tool_global' => array(120, 60),
            ),
        );
        return isset($table[$tier]) ? $table[$tier] : $table[self::TIER_STANDARD];
    }

    /**
     * @param array $limits dimension => array(limit, window)
     * @return array{allowed:bool,retry_after:int,dimension:string,limit:int}
     */
    public static function attempt(array $identities, array $limits, RateLimitRepository $repository = null)
    {
        $repository = $repository ?: new RateLimitRepository();
        $retryAfter = 0;
        foreach ($limits as $dimension => $rule) {
            $limit = (int) $rule[0];
            $window = max(1, (int) $rule[1]);
            if ($limit <= 0) {
                continue; // 0 means "this dimension is not enforced"
            }
            $bucket = isset($identities[$dimension === 'tool_ip' || $dimension === 'tool_global' ? 'tool' : $dimension])
                ? $identities[$dimension === 'tool_ip' || $dimension === 'tool_global' ? 'tool' : $dimension]
                : '';
            if ($dimension === 'tool_ip' && isset($identities['ip'])) {
                $bucket .= '|' . $identities['ip'];
            }
            if ($bucket === '') {
                continue;
            }
            $count = $repository->hit($dimension, $bucket, $window);
            if ($count > $limit) {
                $retryAfter = max($retryAfter, $repository->secondsUntilReset($dimension, $bucket, $window));
                return array('allowed' => false, 'retry_after' => $retryAfter, 'dimension' => $dimension, 'limit' => $limit);
            }
        }
        return array('allowed' => true, 'retry_after' => 0, 'dimension' => '', 'limit' => 0);
    }

    /**
     * Caller identity for the current request. Proxy headers are only trusted
     * when an administrator enabled it (the same explicit switch the existing
     * Tools Platform uses), so the IP dimension cannot be spoofed by default.
     */
    public static function identities($trustProxyHeaders = false)
    {
        $ip = self::clientIp($trustProxyHeaders);
        $clientId = isset($_SESSION['uid']) ? (int) $_SESSION['uid'] : 0;
        return array(
            'ip' => $ip,
            'client' => $clientId > 0 ? 'client:' . $clientId : '',
            'tool' => '',
        );
    }

    public static function clientIp($trustProxyHeaders = false)
    {
        if ($trustProxyHeaders) {
            foreach (array('HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP') as $header) {
                if (!empty($_SERVER[$header])) {
                    $candidate = trim(explode(',', (string) $_SERVER[$header])[0]);
                    if (filter_var($candidate, FILTER_VALIDATE_IP) !== false) {
                        return $candidate;
                    }
                }
            }
        }
        $remote = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
        return filter_var($remote, FILTER_VALIDATE_IP) !== false ? $remote : 'unknown';
    }
}
