<?php
namespace CloudHost247\NetworkTools\Core\Registry;

/**
 * Category taxonomy for the Tools dashboard (docs section 2).
 *
 * Categories are structure, not content: they are code-owned so a new tool can
 * never appear in a phantom category, and the dashboard renders exactly these
 * nine sections in this order.
 */
final class ToolCategories
{
    public static function all()
    {
        return array(
            'dns' => array(
                'name' => 'DNS Tools',
                'icon' => 'globe',
                'description' => 'Look up, validate and monitor DNS records, email authentication and DNSSEC.',
            ),
            'ip' => array(
                'name' => 'IP Tools',
                'icon' => 'map-pin',
                'description' => 'Address intelligence, WHOIS, reverse DNS, geolocation and ASN information.',
            ),
            'network' => array(
                'name' => 'Network Tools',
                'icon' => 'activity',
                'description' => 'Reachability, ports, subnets, MAC addresses and connection speed.',
            ),
            'developer' => array(
                'name' => 'Developer Tools',
                'icon' => 'code',
                'description' => 'HTTP, JSON, encoding, URL, SMTP and email-header diagnostics.',
            ),
            'webmaster' => array(
                'name' => 'Webmaster & SEO Tools',
                'icon' => 'search',
                'description' => 'Crawl checks, Open Graph previews, robots.txt and search-result previews.',
            ),
            'security' => array(
                'name' => 'Security Tools',
                'icon' => 'shield',
                'description' => 'TLS certificates, blocklists, password utilities and BIN intelligence.',
            ),
            'domain' => array(
                'name' => 'Domain Tools',
                'icon' => 'link',
                'description' => 'IDN conversion and availability checks through the configured registrar.',
            ),
            'productivity' => array(
                'name' => 'Productivity Tools',
                'icon' => 'clipboard',
                'description' => 'Text, QR, colour and time-card utilities that run entirely in the browser or locally.',
            ),
            'diagnostics' => array(
                'name' => 'Diagnostics & Monitoring',
                'icon' => 'pulse',
                'description' => 'Domain health centre, saved reports and customer monitoring.',
            ),
        );
    }

    public static function exists($id)
    {
        $all = self::all();
        return isset($all[(string) $id]);
    }

    public static function name($id)
    {
        $all = self::all();
        return isset($all[$id]) ? $all[$id]['name'] : 'Tools';
    }

    public static function icon($id)
    {
        $all = self::all();
        return isset($all[$id]) ? $all[$id]['icon'] : 'tool';
    }
}
