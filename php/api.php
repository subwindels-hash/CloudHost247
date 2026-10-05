<?php
/**
 * CloudHost247 — platform API client.
 *
 * A deliberately tiny read-only client for the platform's public endpoints.
 * Honesty rule: on any failure (network, timeout, non-200, bad JSON) every
 * helper returns null, and pages render an explicit "could not be loaded"
 * state rather than fallback numbers.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

/**
 * GET a platform API route and decode the JSON body.
 *
 * Returns the decoded associative array, or null when the API is unreachable,
 * slow (3s budget), answers with an error status, or sends something that is
 * not JSON. Never throws.
 */
function ch247_api_get(string $path, int $timeoutSeconds = 3): ?array
{
    static $cache = [];

    if (array_key_exists($path, $cache)) {
        return $cache[$path];
    }

    $result = null;
    if (function_exists('curl_init')) {
        $ch = curl_init(CH247_API_BASE . $path);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => max(1, $timeoutSeconds),
            CURLOPT_TIMEOUT => max(1, $timeoutSeconds),
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: CloudHost247-PHP/1.0'],
        ]);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($body !== false && $status >= 200 && $status < 300) {
            $decoded = json_decode((string) $body, true);
            if (is_array($decoded)) {
                $result = $decoded;
            }
        }
    } else {
        // No cURL extension: a bounded stream context keeps the page responsive.
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => max(1, $timeoutSeconds),
                'ignore_errors' => true,
                'header' => "Accept: application/json\r\nUser-Agent: CloudHost247-PHP/1.0\r\n",
            ],
        ]);
        $body = @file_get_contents(CH247_API_BASE . $path, false, $context);
        if ($body !== false) {
            $status = 0;
            if (isset($http_response_header[0]) && preg_match('#\s([1-5][0-9]{2})\s#', (string) $http_response_header[0], $m)) {
                $status = (int) $m[1];
            }
            if ($status >= 200 && $status < 300) {
                $decoded = json_decode($body, true);
                if (is_array($decoded)) {
                    $result = $decoded;
                }
            }
        }
    }

    $cache[$path] = $result;
    return $result;
}

/** Full published catalog (products with plans and pricing), or null. */
function ch247_catalog(): ?array
{
    return ch247_api_get('/api/v1/catalog');
}

/** One catalog product (with its plans) by slug, or null. */
function ch247_product(string $slug): ?array
{
    $catalog = ch247_catalog();
    if ($catalog === null || !isset($catalog['products']) || !is_array($catalog['products'])) {
        return null;
    }
    foreach ($catalog['products'] as $product) {
        if (isset($product['slug']) && $product['slug'] === $slug) {
            return $product;
        }
    }
    return null;
}

/** Published domain extensions with register/transfer/renew pricing, or null. */
function ch247_extensions(): ?array
{
    $data = ch247_api_get('/api/v1/domain-services/extensions');
    if ($data === null || !isset($data['extensions']) || !is_array($data['extensions'])) {
        return null;
    }
    return $data['extensions'];
}

/**
 * Operator-configured site information (contact details, socials, brand).
 * Only whitelisted, configured fields are ever present — the platform drops
 * anything else server-side.
 */
function ch247_site_info(): ?array
{
    return ch247_api_get('/api/v1/public/site-info');
}

/** Published articles of one kind (kb|blog), optionally searched. */
function ch247_articles(string $kind = 'kb', string $query = ''): ?array
{
    $path = '/api/v1/public/articles?kind=' . rawurlencode($kind);
    if ($query !== '') {
        $path .= '&q=' . rawurlencode($query);
    }
    $data = ch247_api_get($path, 4);
    if ($data === null || !isset($data['articles']) || !is_array($data['articles'])) {
        return null;
    }
    return $data['articles'];
}

/** One published article by slug, or null (drafts never resolve). */
function ch247_article(string $slug): ?array
{
    $data = ch247_api_get('/api/v1/public/articles/' . rawurlencode($slug), 4);
    if ($data === null || !isset($data['article']) || !is_array($data['article'])) {
        return null;
    }
    return $data['article'];
}

/** Live service status snapshot, or null. */
function ch247_status(): ?array
{
    return ch247_api_get('/api/v1/public/status');
}

/** Format an amount with its ISO currency code for display. */
function ch247_money($amount, $currency = 'USD'): string
{
    if ($amount === null || $amount === '' || !is_numeric($amount)) {
        return '—';
    }
    $code = strtoupper((string) $currency);
    $formatted = number_format((float) $amount, 2);
    if (preg_match('/^[A-Z]{3}$/', $code) !== 1) {
        return $formatted;
    }
    return $formatted . ' ' . $code;
}

/** HTML-escape helper used across every renderer. */
function ch247_e($value): string
{
    return htmlspecialchars((string) ($value ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
