<?php
namespace CloudHost247\NetworkTools\Services\Webmaster;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;

/**
 * Open Graph / Twitter card checker (docs section 35).
 *
 * Reports the tags the page actually publishes and the preview the values
 * produce. Image URLs are validated and resolved absolutely, and image bytes
 * are never downloaded here beyond the page itself, so a hostile page cannot
 * make the tool fetch arbitrary image hosts at scale. Where a platform applies
 * extra rules the payload says so instead of guessing.
 */
final class OpenGraphService extends Service
{
    private static $required = array('og:title', 'og:type', 'og:image', 'og:url');

    protected function execute()
    {
        $fetcher = $this->fetcher(3);
        $response = $fetcher->request('GET', $this->input['url'], array('Accept' => 'text/html,application/xhtml+xml'));
        if (!$response['ok']) {
            return ToolResult::failure($response['code'], $response['message']);
        }
        $finalUrl = isset($response['url']) ? $response['url'] : $this->input['url'];
        if (!in_array((int) $response['status'], array(200), true)) {
            return ToolResult::failure('PROVIDER_ERROR', 'The page answered HTTP ' . (int) $response['status'] . ', so no social tags could be read.');
        }
        $contentType = isset($response['headers']['content-type']) ? $response['headers']['content-type'] : '';
        if ($contentType !== '' && stripos($contentType, 'html') === false) {
            return ToolResult::invalid('That URL returned "' . $contentType . '" instead of HTML, so it has no social tags to inspect.');
        }
        $tags = $this->extractMeta($response['body'], $finalUrl);
        $warnings = array();
        if (!empty($response['truncated'])) {
            $warnings[] = 'The page was larger than the fetch limit, so only its beginning was searched for tags. Tags placed at the very end of the document may be missing.';
        }
        $missing = array();
        foreach (self::$required as $tag) {
            if (!isset($tags[$tag])) {
                $missing[] = $tag;
            }
        }
        if ($missing) {
            $warnings[] = 'Missing required Open Graph tag(s): ' . implode(', ', $missing) . '. Platforms fall back to their own guesses, which is rarely the preview you want.';
        }
        if (!isset($tags['twitter:card'])) {
            $warnings[] = 'No twitter:card tag was found. Without it, X/Twitter may render a small summary instead of a large image card.';
        }
        if (isset($tags['og:image']) && strpos($tags['og:image'], 'https://') !== 0) {
            $warnings[] = 'The og:image URL is not secure (https). Most platforms will refuse to display it.';
        }
        $imageInfo = array('present' => isset($tags['og:image']), 'url' => isset($tags['og:image']) ? $tags['og:image'] : '', 'declared_dimensions' => '', 'note' => '');
        if (isset($tags['og:image:width']) && isset($tags['og:image:height'])) {
            $imageInfo['declared_dimensions'] = $tags['og:image:width'] . '×' . $tags['og:image:height'];
            if ((int) $tags['og:image:width'] < 200 || (int) $tags['og:image:height'] < 200) {
                $warnings[] = 'The declared og:image size is smaller than the 200×200 minimum most platforms require for a large preview.';
            }
        } elseif ($imageInfo['present']) {
            $warnings[] = 'The og:image dimensions are not declared. The platform will download the image and decide the layout itself.';
        }
        $preview = array(
            'title' => isset($tags['og:title']) ? $tags['og:title'] : (isset($tags['twitter:title']) ? $tags['twitter:title'] : (isset($tags['title']) ? $tags['title'] : '')),
            'description' => isset($tags['og:description']) ? $tags['og:description'] : (isset($tags['description']) ? $tags['description'] : ''),
            'site_name' => isset($tags['og:site_name']) ? $tags['og:site_name'] : '',
            'url' => isset($tags['og:url']) ? $tags['og:url'] : $finalUrl,
            'type' => isset($tags['og:type']) ? $tags['og:type'] : '',
            'image' => $imageInfo['url'],
            'locale' => isset($tags['og:locale']) ? $tags['og:locale'] : '',
            'twitter_card' => isset($tags['twitter:card']) ? $tags['twitter:card'] : '',
            'twitter_site' => isset($tags['twitter:site']) ? $tags['twitter:site'] : '',
        );
        return ToolResult::success(array(
            'url' => $finalUrl,
            'http_status' => (int) $response['status'],
            'tags' => $tags,
            'tag_count' => count($tags),
            'required_missing' => $missing,
            'image' => $imageInfo,
            'preview' => $preview,
            'preview_note' => 'This preview renders the tag values exactly as they were found. Each platform crops, truncates and falls back differently; the real card is decided by that platform at share time.',
            'referenced_images' => isset($tags['og:image']) && $tags['og:image'] !== '' ? array($tags['og:image']) : array(),
            'summary' => count($tags) . ' social tag(s) found' . ($missing ? ', ' . count($missing) . ' required tag(s) missing.' : '; all required Open Graph tags are present.'),
        ), $warnings);
    }

    private function extractMeta($html, $baseUrl)
    {
        $tags = array();
        if (preg_match_all('/<meta\b[^>]*>/i', $html, $matches)) {
            foreach ($matches[0] as $element) {
                $attributes = array();
                if (preg_match_all('/([a-z:_\-]+)\s*=\s*("([^"]*)"|\'([^\']*)\'|([^\s>]+))/i', $element, $pairs, PREG_SET_ORDER)) {
                    foreach ($pairs as $pair) {
                        $name = strtolower($pair[1]);
                        $value = '';
                        foreach (array(3, 4, 5) as $index) {
                            if (isset($pair[$index]) && $pair[$index] !== '') {
                                $value = $pair[$index];
                                break;
                            }
                        }
                        $attributes[$name] = html_entity_decode(trim($value), ENT_QUOTES, 'UTF-8');
                    }
                }
                $key = '';
                if (isset($attributes['property'])) {
                    $key = strtolower($attributes['property']);
                } elseif (isset($attributes['name'])) {
                    $key = strtolower($attributes['name']);
                }
                if ($key === '' || !isset($attributes['content'])) {
                    continue;
                }
                if (strpos($key, 'og:') !== 0 && strpos($key, 'twitter:') !== 0 && !in_array($key, array('title', 'description'), true)) {
                    continue;
                }
                if ($key === 'title' || $key === 'description') {
                    $key = 'meta:' . $key;
                }
                if (!isset($tags[$key])) {
                    $tags[$key] = $attributes['content'];
                }
            }
        }
        if (preg_match('/<title[^>]*>(.*?)<\/title>/is', $html, $titleMatch)) {
            $tags['title'] = html_entity_decode(trim(strip_tags($titleMatch[1])), ENT_QUOTES, 'UTF-8');
        }
        if (isset($tags['og:image']) && $tags['og:image'] !== '') {
            $tags['og:image'] = $this->absolute($tags['og:image'], $baseUrl);
        }
        if (isset($tags['og:url']) && $tags['og:url'] !== '') {
            $tags['og:url'] = $this->absolute($tags['og:url'], $baseUrl);
        }
        if (isset($tags['twitter:image']) && $tags['twitter:image'] !== '') {
            $tags['twitter:image'] = $this->absolute($tags['twitter:image'], $baseUrl);
        }
        return $tags;
    }

    private function absolute($value, $baseUrl)
    {
        if (stripos($value, 'http://') === 0 || stripos($value, 'https://') === 0) {
            return $value;
        }
        if (strpos($value, '//') === 0) {
            return parse_url($baseUrl, PHP_URL_SCHEME) . ':' . $value;
        }
        $directory = preg_replace('#/[^/]*$#', '/', $baseUrl);
        return $directory . ltrim($value, '/');
    }
}
