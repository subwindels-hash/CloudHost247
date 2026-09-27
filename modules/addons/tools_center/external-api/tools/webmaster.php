<?php
/**
 * Webmaster Tools Module
 * Website analysis, link analyzer, user agent, SERP simulator, robots.txt generator
 */

class WebmasterTools {
    private $config;
    
    public function __construct($config) {
        $this->config = $config;
    }
    
    /**
     * Website Link Analyzer
     */
    public function websiteLinkAnalyzer($params) {
        $url = $params['url'] ?? '';
        $deep = (bool)($params['deep'] ?? false);
        
        if (empty($url)) {
            throw new Exception('URL is required');
        }
        
        if (!preg_match('/^https?:\/\//i', $url)) {
            $url = 'https://' . $url;
        }
        
        $valid = filter_var($url, FILTER_VALIDATE_URL);
        if (!$valid) {
            throw new Exception('Invalid URL');
        }
        
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; WHMCS-LinkAnalyzer/1.0)'
        ]);
        
        $html = curl_exec($ch);
        $info = curl_getinfo($ch);
        curl_close($ch);
        
        if ($html === false) {
            throw new Exception('Failed to fetch page');
        }
        
        // Parse links
        $internalLinks = [];
        $externalLinks = [];
        $nofollowLinks = [];
        $brokenLinks = [];
        
        $baseHost = parse_url($url, PHP_URL_HOST);
        
        // Extract all links
        preg_match_all('/<a[^>]+href=["\']([^"\']+)["\'][^>]*>/i', $html, $linkMatches);
        preg_match_all('/<a[^>]*>/i', $html, $tagMatches);
        
        $allHrefs = array_unique($linkMatches[1]);
        
        foreach ($allHrefs as $href) {
            $href = trim($href);
            
            // Skip anchors, javascript, mailto
            if (strpos($href, '#') === 0 || strpos($href, 'javascript:') === 0 || strpos($href, 'mailto:') === 0) {
                continue;
            }
            
            // Resolve relative URLs
            if (strpos($href, 'http') !== 0) {
                $href = rtrim($url, '/') . '/' . ltrim($href, '/');
            }
            
            $linkHost = parse_url($href, PHP_URL_HOST);
            $isInternal = $linkHost === $baseHost || $linkHost === null;
            
            $linkData = [
                'url' => $href,
                'text' => '',
                'nofollow' => false,
            ];
            
            // Check for nofollow in the same <a> tag
            foreach ($tagMatches[0] as $tag) {
                if (strpos($tag, $href) !== false && stripos($tag, 'rel=') !== false) {
                    if (preg_match('/rel=["\']?([^"\'>\s]+)/i', $tag, $relMatch)) {
                        if (stripos($relMatch[1], 'nofollow') !== false) {
                            $linkData['nofollow'] = true;
                        }
                    }
                }
            }
            
            if ($linkData['nofollow']) {
                $nofollowLinks[] = $linkData;
            }
            
            if ($isInternal) {
                $internalLinks[] = $linkData;
            } else {
                $externalLinks[] = $linkData;
            }
        }
        
        // Extract images
        $images = [];
        preg_match_all('/<img[^>]+src=["\']([^"\']+)["\'][^>]*>/i', $html, $imgMatches);
        foreach ($imgMatches[1] as $imgSrc) {
            $images[] = ['src' => $imgSrc, 'alt' => ''];
        }
        
        // Check title and meta
        preg_match('/<title>([^<]*)<\/title>/si', $html, $titleMatch);
        preg_match('/<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\'][^>]*>/i', $html, $descMatch);
        preg_match('/<h1[^>]*>([^<]*)<\/h1>/si', $html, $h1Match);
        
        // Check for broken links (sample check on first 10)
        $checkLinks = array_slice(array_merge($internalLinks, $externalLinks), 0, 10);
        foreach ($checkLinks as $link) {
            $linkCh = curl_init($link['url']);
            curl_setopt_array($linkCh, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_NOBODY => true,
                CURLOPT_TIMEOUT => 10,
                CURLOPT_SSL_VERIFYPEER => false,
            ]);
            curl_exec($linkCh);
            $linkInfo = curl_getinfo($linkCh);
            curl_close($linkCh);
            
            if ($linkInfo['http_code'] >= 400 || $linkInfo['http_code'] === 0) {
                $brokenLinks[] = [
                    'url' => $link['url'],
                    'status' => $linkInfo['http_code']
                ];
            }
        }
        
        return [
            'url' => $url,
            'status_code' => $info['http_code'],
            'page_title' => $titleMatch[1] ?? 'No title found',
            'meta_description' => $descMatch[1] ?? 'No description found',
            'h1' => $h1Match[1] ?? 'No H1 found',
            'links' => [
                'total' => count($internalLinks) + count($externalLinks),
                'internal' => count($internalLinks),
                'external' => count($externalLinks),
                'nofollow' => count($nofollowLinks),
                'broken' => count($brokenLinks),
            ],
            'images' => count($images),
            'internal_links' => array_slice($internalLinks, 0, 20),
            'external_links' => array_slice($externalLinks, 0, 20),
            'broken_links' => $brokenLinks,
            'seo_score' => $this->calculateSEOScore($titleMatch[1] ?? '', $descMatch[1] ?? '', $h1Match[1] ?? '', count($images), count($internalLinks)),
        ];
    }
    
    /**
     * User Agent Checker
     */
    public function userAgentChecker($params) {
        $ua = $params['ua'] ?? ($params['user_agent'] ?? ($_SERVER['HTTP_USER_AGENT'] ?? ''));
        
        if (empty($ua)) {
            throw new Exception('User Agent string is required');
        }
        
        $ua = substr($ua, 0, 1000); // Limit length
        
        $parsed = [
            'raw' => $ua,
            'browser' => 'Unknown',
            'browser_version' => null,
            'os' => 'Unknown',
            'os_version' => null,
            'device' => 'Unknown',
            'is_mobile' => false,
            'is_bot' => false,
            'is_tablet' => false,
        ];
        
        // Browser detection
        if (preg_match('/Edg\/([0-9.]+)/', $ua, $m)) {
            $parsed['browser'] = 'Edge';
            $parsed['browser_version'] = $m[1];
        } elseif (preg_match('/OPR\/([0-9.]+)/', $ua, $m)) {
            $parsed['browser'] = 'Opera';
            $parsed['browser_version'] = $m[1];
        } elseif (preg_match('/Firefox\/([0-9.]+)/', $ua, $m)) {
            $parsed['browser'] = 'Firefox';
            $parsed['browser_version'] = $m[1];
        } elseif (preg_match('/Chrome\/([0-9.]+)/', $ua, $m)) {
            $parsed['browser'] = 'Chrome';
            $parsed['browser_version'] = $m[1];
        } elseif (preg_match('/Safari\/([0-9.]+)/', $ua, $m) && strpos($ua, 'Chrome') === false) {
            $parsed['browser'] = 'Safari';
            $parsed['browser_version'] = $m[1];
        } elseif (preg_match('/MSIE ([0-9.]+)/', $ua, $m) || preg_match('/Trident.*rv:([0-9.]+)/', $ua, $m)) {
            $parsed['browser'] = 'Internet Explorer';
            $parsed['browser_version'] = $m[1];
        }
        
        // OS detection
        if (preg_match('/Windows NT ([0-9.]+)/', $ua, $m)) {
            $parsed['os'] = 'Windows';
            $versions = ['10.0' => '10', '6.3' => '8.1', '6.2' => '8', '6.1' => '7', '6.0' => 'Vista', '5.2' => 'XP/Server 2003'];
            $parsed['os_version'] = $versions[$m[1]] ?? $m[1];
        } elseif (preg_match('/Mac OS X ([0-9_]+)/', $ua, $m)) {
            $parsed['os'] = 'macOS';
            $parsed['os_version'] = str_replace('_', '.', $m[1]);
        } elseif (preg_match('/Linux/', $ua)) {
            $parsed['os'] = 'Linux';
            if (preg_match('/Android ([0-9.]+)/', $ua, $m)) {
                $parsed['os'] = 'Android';
                $parsed['os_version'] = $m[1];
                $parsed['is_mobile'] = true;
            }
        } elseif (preg_match('/iPhone|iPad|iPod/', $ua)) {
            $parsed['os'] = 'iOS';
            $parsed['is_mobile'] = true;
            if (preg_match('/OS ([0-9_]+)/', $ua, $m)) {
                $parsed['os_version'] = str_replace('_', '.', $m[1]);
            }
        }
        
        // Device detection
        if (preg_match('/iPhone/', $ua)) {
            $parsed['device'] = 'iPhone';
            $parsed['is_mobile'] = true;
        } elseif (preg_match('/iPad/', $ua)) {
            $parsed['device'] = 'iPad';
            $parsed['is_tablet'] = true;
        } elseif (preg_match('/Android/', $ua)) {
            $parsed['device'] = 'Android Device';
            $parsed['is_mobile'] = true;
        }
        
        // Bot detection
        $bots = ['Googlebot', 'Bingbot', 'Slurp', 'DuckDuckBot', 'Baiduspider', 'YandexBot', 'facebookexternalhit'];
        foreach ($bots as $bot) {
            if (stripos($ua, $bot) !== false) {
                $parsed['is_bot'] = true;
                $parsed['browser'] = $bot;
                break;
            }
        }
        
        // Screen size estimation
        if ($parsed['is_mobile']) {
            $parsed['estimated_screen'] = 'Small (mobile)';
        } elseif ($parsed['is_tablet']) {
            $parsed['estimated_screen'] = 'Medium (tablet)';
        } else {
            $parsed['estimated_screen'] = 'Large (desktop)';
        }
        
        return $parsed;
    }
    
    /**
     * Google PageRank Checker (fallback)
     */
    public function pageRankChecker($params) {
        $url = $params['url'] ?? '';
        
        if (empty($url)) {
            throw new Exception('URL is required');
        }
        
        if (!preg_match('/^https?:\/\//i', $url)) {
            $url = 'https://' . $url;
        }
        
        $host = parse_url($url, PHP_URL_HOST);
        
        // Note: Google PageRank API was shut down in 2016
        // This returns estimated metrics based on available data
        
        return [
            'url' => $url,
            'note' => 'Google PageRank was discontinued in 2016. Alternative metrics provided.',
            'domain' => $host,
            'alternatives' => [
                'ahrefs_rank' => null,
                'moz_domain_authority' => null,
                'semrush_rank' => null,
            ],
            'recommendation' => 'Use tools like Ahrefs, Moz, or SEMrush for domain authority metrics.',
            'legacy_pagerank' => 'N/A (Service discontinued)',
        ];
    }
    
    /**
     * Punycode Converter
     */
    public function punycodeConverter($params) {
        $domain = $params['domain'] ?? '';
        $direction = $params['direction'] ?? 'auto'; // auto, to_punycode, to_unicode
        
        if (empty($domain)) {
            throw new Exception('Domain is required');
        }
        
        $domain = trim($domain);
        
        // Check if already punycode
        $isPunycode = strpos($domain, 'xn--') !== false;
        
        if ($direction === 'auto') {
            $direction = $isPunycode ? 'to_unicode' : 'to_punycode';
        }
        
        if ($direction === 'to_punycode') {
            // Convert Unicode domain to Punycode
            if (function_exists('idn_to_ascii')) {
                $punycode = idn_to_ascii($domain, 0, INTL_IDNA_VARIANT_UTS46);
            } else {
                // Fallback - attempt basic conversion
                $punycode = $this->simpleIdnToAscii($domain);
            }
            
            return [
                'original' => $domain,
                'converted' => $punycode,
                'direction' => 'unicode_to_punycode',
                'is_idn' => $domain !== $punycode,
            ];
        } else {
            // Convert Punycode to Unicode
            if (function_exists('idn_to_utf8')) {
                $unicode = idn_to_utf8($domain, 0, INTL_IDNA_VARIANT_UTS46);
            } else {
                $unicode = $domain;
            }
            
            return [
                'original' => $domain,
                'converted' => $unicode,
                'direction' => 'punycode_to_unicode',
                'is_idn' => $domain !== $unicode,
            ];
        }
    }
    
    /**
     * SERP Simulator
     */
    public function serpSimulator($params) {
        $title = $params['title'] ?? '';
        $description = $params['description'] ?? '';
        $url = $params['url'] ?? 'example.com/page';
        
        if (empty($title)) {
            throw new Exception('Title is required');
        }
        
        // Google SERP limits (pixels, approximate in chars)
        $titleLimit = 60;
        $descLimit = 160;
        
        $titleTruncated = mb_strlen($title) > $titleLimit ? mb_substr($title, 0, $titleLimit - 3) . '...' : $title;
        $descTruncated = mb_strlen($description) > $descLimit ? mb_substr($description, 0, $descLimit - 3) . '...' : $description;
        
        // Parse URL
        $urlParts = parse_url($url);
        $displayUrl = ($urlParts['host'] ?? $url) . ($urlParts['path'] ?? '');
        
        // Calculate pixel width (rough approximation)
        $titlePixels = $this->estimatePixelWidth($title);
        $descPixels = $this->estimatePixelWidth($description);
        
        return [
            'google_serp_preview' => [
                'title' => $titleTruncated,
                'url' => $displayUrl,
                'description' => $descTruncated,
            ],
            'title' => [
                'current_length' => mb_strlen($title),
                'max_recommended' => $titleLimit,
                'status' => mb_strlen($title) <= $titleLimit ? 'OPTIMAL' : 'TOO_LONG',
                'pixel_width' => $titlePixels,
            ],
            'description' => [
                'current_length' => mb_strlen($description),
                'max_recommended' => $descLimit,
                'status' => mb_strlen($description) <= $descLimit ? 'OPTIMAL' : 'TOO_LONG',
                'pixel_width' => $descPixels,
            ],
            'warnings' => array_filter([
                mb_strlen($title) > $titleLimit ? 'Title exceeds ' . $titleLimit . ' characters and may be truncated' : null,
                mb_strlen($title) < 30 ? 'Title is too short (under 30 chars)' : null,
                mb_strlen($description) > $descLimit ? 'Description exceeds ' . $descLimit . ' characters' : null,
                mb_strlen($description) < 50 ? 'Description is too short' : null,
            ]),
        ];
    }
    
    /**
     * Robots.txt Generator
     */
    public function robotsGenerator($params) {
        $userAgent = $params['user_agent'] ?? '*';
        $allowPaths = $params['allow'] ?? [];
        $disallowPaths = $params['disallow'] ?? ['/admin/', '/cgi-bin/', '/tmp/', '/private/'];
        $sitemap = $params['sitemap'] ?? '';
        $crawlDelay = (int)($params['crawl_delay'] ?? 0);
        $host = $params['host'] ?? '';
        
        if (!is_array($allowPaths)) {
            $allowPaths = array_filter(explode(',', $allowPaths));
        }
        if (!is_array($disallowPaths)) {
            $disallowPaths = array_filter(explode(',', $disallowPaths));
        }
        
        $lines = [];
        $lines[] = '# robots.txt - Generated by WHMCS Tools Center';
        $lines[] = '# Created: ' . date('Y-m-d H:i:s');
        $lines[] = '';
        $lines[] = 'User-agent: ' . $userAgent;
        
        foreach ($disallowPaths as $path) {
            $lines[] = 'Disallow: ' . trim($path);
        }
        
        foreach ($allowPaths as $path) {
            $lines[] = 'Allow: ' . trim($path);
        }
        
        if ($crawlDelay > 0) {
            $lines[] = 'Crawl-delay: ' . $crawlDelay;
        }
        
        $lines[] = '';
        
        if (!empty($sitemap)) {
            $lines[] = 'Sitemap: ' . $sitemap;
        }
        
        if (!empty($host)) {
            $lines[] = 'Host: ' . $host;
        }
        
        $robotsTxt = implode("\n", $lines);
        
        return [
            'robots_txt' => $robotsTxt,
            'user_agent' => $userAgent,
            'disallow_rules' => count($disallowPaths),
            'allow_rules' => count($allowPaths),
            'has_sitemap' => !empty($sitemap),
            'line_count' => count($lines),
        ];
    }
    
    private function calculateSEOScore($title, $desc, $h1, $images, $links) {
        $score = 0;
        
        // Title check
        $titleLen = mb_strlen($title);
        if ($titleLen >= 30 && $titleLen <= 60) $score += 25;
        elseif ($titleLen > 0) $score += 10;
        
        // Description check
        $descLen = mb_strlen($desc);
        if ($descLen >= 120 && $descLen <= 160) $score += 25;
        elseif ($descLen > 0) $score += 10;
        
        // H1 check
        if (!empty($h1)) $score += 20;
        
        // Images
        if ($images > 0) $score += 15;
        
        // Links
        if ($links > 0) $score += 15;
        
        return min(100, $score);
    }
    
    private function simpleIdnToAscii($domain) {
        // Very basic fallback for systems without intl extension
        if (preg_match('/^[a-zA-Z0-9.\-]+$/', $domain)) {
            return $domain; // Already ASCII
        }
        return $domain; // Cannot convert without intl extension
    }
    
    private function estimatePixelWidth($text) {
        // Rough estimation based on average character width
        $length = mb_strlen($text);
        $narrowChars = preg_match_all('/[ijl\.\,\!\|\:]/u', $text);
        $wideChars = preg_match_all('/[wmM@]/u', $text);
        
        return ($length * 7) - ($narrowChars * 3) + ($wideChars * 3);
    }
}