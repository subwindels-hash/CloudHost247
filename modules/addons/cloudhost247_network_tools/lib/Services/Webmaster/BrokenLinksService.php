<?php
namespace CloudHost247\NetworkTools\Services\Webmaster;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Core\Security\TargetValidator;
use CloudHost247\NetworkTools\Services\Service;

/**
 * Broken link checker (docs section 34).
 *
 * Bounded, same-site crawl: the configured page, link, byte and time budgets
 * are hard stops and are always reported in the result, so a partial crawl is
 * never presented as a complete one. Every fetch passes through the fetcher's
 * SSRF guard, redirects are never followed automatically, and external links
 * are checked at most once and never crawled.
 */
final class BrokenLinksService extends Service
{
    protected function execute()
    {
        $start = null;
        try {
            $start = TargetValidator::url($this->input['url']);
        } catch (\InvalidArgumentException $invalid) {
            return ToolResult::invalid($invalid->getMessage());
        }
        $maxPages = min(25, max(1, (int) (isset($this->input['max_pages']) ? $this->input['max_pages'] : $this->intSetting('crawl_max_pages', 10))));
        $maxLinks = min(400, max(10, (int) (isset($this->input['max_links']) ? $this->input['max_links'] : $this->intSetting('crawl_max_links', 250))));
        $checkExternal = !empty($this->input['check_external']);
        $budget = max(5, min(60, $this->intSetting('crawl_max_runtime_seconds', 25)));
        $deadline = microtime(true) + $budget;
        $host = strtolower($start['host']);
        $fetcher = $this->fetcher(3);
        $pages = array();
        $links = array();
        $seenPages = array();
        $seenLinks = array();
        $queue = array($start['url']);
        $pagesCrawled = 0;
        $linksChecked = 0;
        $budgetHit = '';
        while ($queue && $pagesCrawled < $maxPages && $linksChecked < $maxLinks) {
            if (microtime(true) >= $deadline) {
                $budgetHit = 'runtime';
                break;
            }
            $url = array_shift($queue);
            if (isset($seenPages[$url])) {
                continue;
            }
            $seenPages[$url] = true;
            if ($pagesCrawled >= $maxPages) {
                $budgetHit = 'pages';
                break;
            }
            $response = $fetcher->request('GET', $url, array('Accept' => 'text/html,application/xhtml+xml'));
            $pagesCrawled++;
            $page = array(
                'url' => $url,
                'status' => $response['ok'] ? (int) $response['status'] : 0,
                'ok' => $response['ok'] && (int) $response['status'] >= 200 && (int) $response['status'] < 300,
                'content_type' => isset($response['headers']['content-type']) ? $response['headers']['content-type'] : '',
                'latency_ms' => $response['latency_ms'],
                'error' => $response['ok'] ? '' : $response['message'],
                'redirected_to' => !empty($response['redirects']) ? end($response['redirects']) : '',
            );
            $pages[] = $page;
            if (!$response['ok'] || stripos($page['content_type'], 'html') === false) {
                if (count($pages) >= $maxPages) {
                    $budgetHit = 'pages';
                }
                continue;
            }
            foreach ($this->extractLinks($response['body'], $url) as $found) {
                if ($linksChecked + count($links) >= $maxLinks) {
                    $budgetHit = 'links';
                    break 2;
                }
                $key = $found['url'];
                if (isset($seenLinks[$key])) {
                    continue;
                }
                $seenLinks[$key] = true;
                $external = strtolower(parse_url($key, PHP_URL_HOST)) !== $host;
                if ($external && !$checkExternal) {
                    $links[] = array(
                        'url' => $key, 'found_on' => $url, 'kind' => $found['kind'], 'external' => true,
                        'status' => 0, 'state' => 'NOT CHECKED', 'detail' => 'External link checks are disabled for this run.',
                    );
                    continue;
                }
                $linksChecked++;
                if (microtime(true) >= $deadline) {
                    $budgetHit = 'runtime';
                    break 2;
                }
                $links[] = $this->checkLink($fetcher, $key, $url, $found['kind'], $external);
                if ($external && count($links) >= $maxLinks) {
                    $budgetHit = 'links';
                    break 2;
                }
                if (!$external && !isset($seenPages[$key]) && $this->looksLikePage($key)) {
                    $queue[] = $key;
                }
            }
        }
        if ($queue && !$budgetHit) {
            $budgetHit = $linksChecked >= $maxLinks ? 'links' : 'pages';
        }
        $broken = array();
        $warnings = array();
        foreach ($links as $link) {
            if ($link['state'] === 'BROKEN') {
                $broken[] = $link;
            }
        }
        if ($budgetHit !== '') {
            $warnings[] = 'The ' . $budgetHit . ' budget stopped the crawl before it finished. This is a sample of the site, not a complete inventory.';
        }
        $warnings[] = 'Only links reachable from ' . $start['url'] . ' within the stated budgets were examined. Links rendered by JavaScript, behind logins or inside forms are not visible to this crawl.';
        return ToolResult::success(array(
            'start_url' => $start['url'],
            'host' => $host,
            'pages_crawled' => $pagesCrawled,
            'links_checked' => $linksChecked,
            'links_discovered' => count($links),
            'broken_count' => count($broken),
            'budget' => array(
                'max_pages' => $maxPages, 'max_links' => $maxLinks, 'runtime_seconds' => $budget,
                'stopped_by' => $budgetHit === '' ? 'completed' : $budgetHit,
            ),
            'pages' => $pages,
            'links' => $links,
            'broken' => $broken,
            'summary' => $budgetHit === ''
                ? 'Crawled ' . $pagesCrawled . ' page(s) and checked ' . $linksChecked . ' link(s); ' . count($broken) . ' broken.'
                : 'Crawl stopped by the ' . $budgetHit . ' budget after ' . $pagesCrawled . ' page(s) and ' . $linksChecked . ' link(s); ' . count($broken) . ' broken so far.',
        ), $warnings, array('bounded_crawl' => true));
    }

    /** A same-site URL is worth crawling only if it looks like an HTML page. */
    private function looksLikePage($url)
    {
        $path = (string) parse_url($url, PHP_URL_PATH);
        if ($path === '' || $path === '/' || substr($path, -1) === '/') {
            return true;
        }
        return preg_match('/\.(?:php|html?|aspx?|jsp|cgi)$/i', $path) === 1;
    }

    private function extractLinks($html, $baseUrl)
    {
        $found = array();
        if (preg_match_all('/<(a|link|img|script|iframe)\b[^>]*?\b(?:href|src)\s*=\s*("([^"]*)"|\'([^\']*)\'|([^\s>]+))/i', $html, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $raw = '';
                foreach (array(3, 4, 5) as $index) {
                    if (isset($match[$index]) && $match[$index] !== '') {
                        $raw = $match[$index];
                        break;
                    }
                }
                $raw = html_entity_decode(trim($raw), ENT_QUOTES, 'UTF-8');
                if ($raw === '' || $raw[0] === '#' || stripos($raw, 'javascript:') === 0 || stripos($raw, 'mailto:') === 0 || stripos($raw, 'tel:') === 0 || stripos($raw, 'data:') === 0) {
                    continue;
                }
                if (stripos($raw, 'http://') !== 0 && stripos($raw, 'https://') !== 0) {
                    if (strpos($raw, '//') === 0) {
                        $scheme = parse_url($baseUrl, PHP_URL_SCHEME);
                        $raw = $scheme . ':' . $raw;
                    } else {
                        $directory = preg_replace('#/[^/]*$#', '/', $baseUrl);
                        $raw = $directory . ltrim($raw, '/');
                    }
                }
                try {
                    $normalised = TargetValidator::url($raw);
                } catch (\InvalidArgumentException $invalid) {
                    continue;
                }
                $found[] = array('url' => $normalised['url'], 'kind' => strtolower($match[1]));
            }
        }
        $unique = array();
        foreach ($found as $entry) {
            $unique[$entry['url']] = $entry;
        }
        return array_values($unique);
    }

    private function checkLink($fetcher, $url, $foundOn, $kind, $external)
    {
        $response = $fetcher->request('HEAD', $url, array('Accept' => '*/*'));
        if (!$response['ok'] || (int) $response['status'] === 405 || (int) $response['status'] === 501) {
            $response = $fetcher->request('GET', $url, array('Accept' => '*/*'), null, array('max_bytes' => 16384, 'timeout' => 8));
        }
        $status = $response['ok'] ? (int) $response['status'] : 0;
        $state = 'OK';
        $detail = 'Reachable.';
        if (!$response['ok']) {
            $state = $response['code'] === 'TIMEOUT' ? 'TIMEOUT' : 'UNREACHABLE';
            $detail = $response['message'];
        } elseif ($status >= 200 && $status < 300) {
            $state = 'OK';
        } elseif ($status >= 300 && $status < 400) {
            $state = 'REDIRECT';
            $detail = 'Redirects to ' . (isset($response['headers']['location']) ? $response['headers']['location'] : 'another address') . '.';
        } elseif ($status === 404 || $status === 410) {
            $state = 'BROKEN';
            $detail = 'The server answered ' . $status . ' (not found / gone).';
        } elseif ($status >= 500) {
            $state = 'BROKEN';
            $detail = 'The server answered ' . $status . ', a server-side failure at the time of this check.';
        } else {
            $state = 'WARNING';
            $detail = 'The server answered ' . $status . '.';
        }
        return array(
            'url' => $url,
            'found_on' => $foundOn,
            'kind' => $kind,
            'external' => (bool) $external,
            'status' => $status,
            'state' => $state,
            'detail' => $detail,
            'latency_ms' => $response['latency_ms'],
            'redirect_target' => isset($response['headers']['location']) ? $response['headers']['location'] : '',
            'final_url' => $response['ok'] ? (isset($response['url']) ? $response['url'] : $url) : '',
        );
    }
}
