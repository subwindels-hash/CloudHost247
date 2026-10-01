<?php
namespace CloudHost247\Builder\Site;

/**
 * Open Graph and Twitter-card tags for a builder page.
 *
 * Kept as a pure function of the resolver's meta array so the exact markup is testable
 * without WHMCS. Every value is escaped; relative image/canonical paths are made absolute
 * against the site URL because crawlers and social networks do not resolve them reliably.
 */
final class SocialMeta
{
    /**
     * @param array  $meta      The 'meta' element of a PageResolver result.
     * @param string $systemUrl WHMCS SystemURL (may be empty).
     */
    public static function tags(array $meta, $systemUrl = '')
    {
        $out = '';
        $title = isset($meta['title']) ? (string) $meta['title'] : '';
        $description = isset($meta['description']) ? (string) $meta['description'] : '';
        $image = self::absolute(isset($meta['og_image']) ? (string) $meta['og_image'] : '', $systemUrl);
        $canonical = self::absolute(isset($meta['canonical']) ? (string) $meta['canonical'] : '', $systemUrl);
        $siteName = isset($meta['site_name']) ? (string) $meta['site_name'] : '';

        if ($title !== '') {
            $out .= self::tag('property', 'og:title', $title) . self::tag('property', 'og:type', 'website');
        }
        if ($siteName !== '') { $out .= self::tag('property', 'og:site_name', $siteName); }
        if ($description !== '') { $out .= self::tag('property', 'og:description', $description); }
        if ($canonical !== '') { $out .= self::tag('property', 'og:url', $canonical); }
        if ($image !== '') {
            $out .= self::tag('property', 'og:image', $image);
            if (!empty($meta['og_image_alt'])) { $out .= self::tag('property', 'og:image:alt', (string) $meta['og_image_alt']); }
        }
        $out .= self::tag('name', 'twitter:card', $image !== '' ? 'summary_large_image' : 'summary');
        if ($title !== '') { $out .= self::tag('name', 'twitter:title', $title); }
        if ($description !== '') { $out .= self::tag('name', 'twitter:description', $description); }
        if ($image !== '') { $out .= self::tag('name', 'twitter:image', $image); }
        return $out;
    }

    /** Make a site-relative path absolute; only http(s) and site-relative values survive. */
    public static function absolute($url, $systemUrl)
    {
        $url = trim((string) $url);
        if ($url === '' || preg_match('/[\x00-\x20"<>]/', $url)) { return ''; }
        if (preg_match('#^https?://#i', $url)) { return $url; }
        if ($url[0] === '/' && !(isset($url[1]) && $url[1] === '/')) {
            $base = rtrim((string) $systemUrl, '/');
            return $base === '' ? '' : $base . $url;
        }
        return '';
    }

    private static function tag($attribute, $name, $content)
    {
        return '<meta ' . $attribute . '="' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8') . '" content="'
            . htmlspecialchars((string) $content, ENT_QUOTES, 'UTF-8') . '" />';
    }
}
