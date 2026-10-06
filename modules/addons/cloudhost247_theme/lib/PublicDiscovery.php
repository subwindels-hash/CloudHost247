<?php
namespace CloudHost247\Theme;

/** Shared publication rules for search and sitemap; never substitutes data on DB failure. */
final class PublicDiscovery
{
    public static function pages(ThemeRepository $repository, $locale = null)
    {
        $index = $repository->publicPageIndex($locale);
        $pages = array();
        $known = array();
        foreach (Site::catalog()['pages'] as $path => $definition) {
            $slug = $definition['slug'];
            $known[$slug] = true;
            if (array_key_exists($slug, $index)) {
                $page = $index[$slug];
            } else {
                // Retained policy templates have real text independently of CMS. Only
                // these three legal routes require a published CMS document.
                $cmsOnlyLegal = array('terms-of-service.php', 'legal-notice.php', 'data-protection-standards.php');
                $page = $definition['category'] === 'Legal' && !in_array($path, $cmsOnlyLegal, true)
                    ? $definition : Site::editorial($slug);
            }
            if ($page === null) { continue; }
            $pages[] = self::entry($path, $page, $definition['category'], $definition);
        }
        foreach ($index as $slug => $page) {
            if ($page === null || isset($known[$slug])) { continue; }
            $pages[] = self::entry('cloudhost247-page.php?slug=' . rawurlencode($slug), $page,
                $page['content_type'] === 'landing' ? 'Landing page' : 'Page');
        }
        return $pages;
    }

    public static function search(array $pages, $query)
    {
        $query = is_string($query) ? trim(substr($query, 0, 100)) : '';
        if ($query === '') { return array(); }
        $results = array();
        foreach ($pages as $page) {
            $match = function_exists('mb_stripos')
                ? mb_stripos($page['search_text'], $query, 0, 'UTF-8')
                : stripos($page['search_text'], $query);
            if ($match === false) { continue; }
            // Do not send entire CMS bodies or internal indexing fields to the template.
            $results[] = array_intersect_key($page, array_flip(array('title', 'summary', 'url', 'category')));
            if (count($results) >= 40) { break; }
        }
        return $results;
    }

    public static function sitemapPaths(array $pages)
    {
        $paths = array(''); // The homepage is a dedicated route, not an editorial CMS page.
        foreach ($pages as $page) {
            if ($page['sitemap']) { $paths[] = $page['url']; }
        }
        return array_values(array_unique($paths));
    }

    private static function entry($url, array $page, $category, array $fallback = array())
    {
        $title = self::text(isset($page['title']) ? $page['title'] : (isset($fallback['title']) ? $fallback['title'] : ''));
        $summary = self::text(isset($page['summary']) ? $page['summary'] : (isset($fallback['summary']) ? $fallback['summary'] : ''));
        $body = self::text(isset($page['body']) ? $page['body'] : '');
        return array(
            'url' => $url, 'title' => $title, 'summary' => $summary, 'category' => $category,
            'sitemap' => !isset($page['sitemap']) || (bool) $page['sitemap'],
            'search_text' => $title . ' ' . $summary . ' ' . $body,
        );
    }

    private static function text($value)
    {
        return html_entity_decode(strip_tags((string) $value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
}
