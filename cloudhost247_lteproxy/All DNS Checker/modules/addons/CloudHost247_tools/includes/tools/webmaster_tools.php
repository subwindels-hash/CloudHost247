<?php
/**
 * CloudHost247 Tools - Webmaster Tools Implementation
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

require_once __DIR__ . '/../functions.php';

function CloudHost247_tool_link_analyzer($post)
{
    $url = CloudHost247_tools_sanitize($post['url'] ?? '', 'url');
    if (!CloudHost247_tools_validate_url($url)) {
        return ['error' => 'Invalid URL'];
    }

    $result = CloudHost247_tools_curl($url, null, [], 20);
    if (empty($result['body'])) {
        return ['error' => 'Could not fetch page'];
    }

    preg_match_all('/href=["\']([^"\']+)["\']/i', $result['body'], $matches);
    $allLinks = array_unique($matches[1]);
    $internal = [];
    $external = [];
    $other = [];

    $parsedBase = parse_url($url);
    $baseHost = $parsedBase['host'] ?? '';

    foreach ($allLinks as $link) {
        if (strpos($link, '#') === 0) continue;
        if (strpos($link, 'javascript:') === 0 || strpos($link, 'mailto:') === 0 || strpos($link, 'tel:') === 0) {
            $other[] = $link;
            continue;
        }
        if (strpos($link, 'http') === 0) {
            $parsed = parse_url($link);
            if (($parsed['host'] ?? '') === $baseHost) {
                $internal[] = $link;
            } else {
                $external[] = $link;
            }
        } else {
            $internal[] = $link;
        }
    }

    return [
        'total' => count($allLinks),
        'internal' => count($internal),
        'external' => count($external),
        'other' => count($other),
        'internal_links' => array_slice($internal, 0, 20),
        'external_links' => array_slice($external, 0, 20),
    ];
}

function CloudHost247_tool_user_agent($post)
{
    $ua = $_SERVER['HTTP_USER_AGENT'] ?? 'Unknown';
    $browser = 'Unknown';
    $os = 'Unknown';

    if (stripos($ua, 'Chrome') !== false) $browser = 'Chrome';
    elseif (stripos($ua, 'Firefox') !== false) $browser = 'Firefox';
    elseif (stripos($ua, 'Safari') !== false) $browser = 'Safari';
    elseif (stripos($ua, 'Edge') !== false) $browser = 'Edge';
    elseif (stripos($ua, 'Opera') !== false) $browser = 'Opera';
    elseif (stripos($ua, 'MSIE') !== false || stripos($ua, 'Trident') !== false) $browser = 'Internet Explorer';

    if (stripos($ua, 'Windows') !== false) $os = 'Windows';
    elseif (stripos($ua, 'Mac') !== false) $os = 'macOS';
    elseif (stripos($ua, 'Linux') !== false) $os = 'Linux';
    elseif (stripos($ua, 'Android') !== false) $os = 'Android';
    elseif (stripos($ua, 'iPhone') !== false || stripos($ua, 'iPad') !== false) $os = 'iOS';

    return [
        'user_agent' => $ua,
        'browser' => $browser,
        'os' => $os,
        'is_mobile' => stripos($ua, 'Mobile') !== false || stripos($ua, 'Android') !== false || stripos($ua, 'iPhone') !== false,
    ];
}

function CloudHost247_tool_pagerank($post)
{
    $domain = CloudHost247_tools_sanitize($post['domain'] ?? '', 'domain');
    if (!CloudHost247_tools_validate_domain($domain)) {
        return ['error' => 'Invalid domain'];
    }

    // Google discontinued Toolbar PageRank - return mock/estimated
    $score = mt_rand(1, 10);
    $note = 'Google officially discontinued Toolbar PageRank in 2016. This is a simulated estimate for demonstration purposes.';

    return [
        'domain' => $domain,
        'score' => $score,
        'note' => $note,
        'simulated' => true,
    ];
}

function CloudHost247_tool_punycode($post)
{
    $input = CloudHost247_tools_sanitize($post['input'] ?? '', 'string');
    $direction = CloudHost247_tools_sanitize($post['direction'] ?? 'encode', 'string');

    if (empty($input)) {
        return ['error' => 'Please enter input'];
    }

    if ($direction === 'encode') {
        if (!function_exists('idn_to_ascii')) {
            return ['error' => 'IDN functions not available on this server'];
        }
        $encoded = @idn_to_ascii($input, IDNA_DEFAULT, INTL_IDNA_VARIANT_UTS46);
        if ($encoded === false) {
            return ['error' => 'Could not encode domain'];
        }
        return ['original' => $input, 'punycode' => $encoded, 'direction' => 'Unicode to Punycode'];
    } else {
        if (!function_exists('idn_to_utf8')) {
            return ['error' => 'IDN functions not available on this server'];
        }
        $decoded = @idn_to_utf8($input, IDNA_DEFAULT, INTL_IDNA_VARIANT_UTS46);
        if ($decoded === false) {
            return ['error' => 'Could not decode punycode'];
        }
        return ['original' => $input, 'unicode' => $decoded, 'direction' => 'Punycode to Unicode'];
    }
}

function CloudHost247_tool_serp_preview($post)
{
    $title = CloudHost247_tools_sanitize($post['title'] ?? '', 'string');
    $description = CloudHost247_tools_sanitize($post['description'] ?? '', 'string');
    $url = CloudHost247_tools_sanitize($post['url'] ?? '', 'url');

    $titleLength = strlen($title);
    $descLength = strlen($description);
    $titleOk = $titleLength >= 10 && $titleLength <= 60;
    $descOk = $descLength >= 50 && $descLength <= 160;

    return [
        'title' => $title,
        'description' => $description,
        'url' => $url,
        'title_length' => $titleLength,
        'description_length' => $descLength,
        'title_status' => $titleOk ? 'optimal' : ($titleLength > 60 ? 'too_long' : 'too_short'),
        'description_status' => $descOk ? 'optimal' : ($descLength > 160 ? 'too_long' : 'too_short'),
        'preview_html' => '<div class="serp-preview">
            <div class="serp-url">' . htmlspecialchars($url) . '</div>
            <div class="serp-title">' . htmlspecialchars($title) . '</div>
            <div class="serp-desc">' . htmlspecialchars($description) . '</div>
        </div>',
    ];
}

function CloudHost247_tool_robots_generator($post)
{
    $userAgent = CloudHost247_tools_sanitize($post['user_agent'] ?? '*', 'string');
    $allow = array_filter(array_map('trim', explode("\n", $_POST['allow'] ?? '')));
    $disallow = array_filter(array_map('trim', explode("\n", $_POST['disallow'] ?? '')));
    $sitemap = CloudHost247_tools_sanitize($post['sitemap'] ?? '', 'url');
    $crawlDelay = (int) ($post['crawl_delay'] ?? 0);

    $output = "User-agent: " . $userAgent . "\n";
    foreach ($disallow as $d) {
        if ($d) $output .= "Disallow: " . $d . "\n";
    }
    foreach ($allow as $a) {
        if ($a) $output .= "Allow: " . $a . "\n";
    }
    if ($crawlDelay > 0) {
        $output .= "Crawl-delay: " . $crawlDelay . "\n";
    }
    if ($sitemap) {
        $output .= "\nSitemap: " . $sitemap . "\n";
    }

    return ['robots_txt' => $output, 'lines' => count(explode("\n", trim($output)))];
}
