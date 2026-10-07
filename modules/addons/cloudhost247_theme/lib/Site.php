<?php
namespace CloudHost247\Theme;

/** Read-only presentation registry. No prices, provider images or customer data live here. */
final class Site
{
    public static function catalog()
    {
        static $catalog;
        if ($catalog === null) {
            $catalog = json_decode(file_get_contents(dirname(__DIR__) . '/resources/site.json'), true);
            if (!is_array($catalog)) { throw new \RuntimeException('Website registry is invalid.'); }
        }
        return $catalog;
    }

    public static function context(array $vars, array $settings = array())
    {
        $catalog = self::catalog();
        $script = basename(isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : 'index.php');
        $page = isset($catalog['pages'][$script]) ? $catalog['pages'][$script] : null;
        $home = isset($vars['templatefile']) && $vars['templatefile'] === 'homepage';
        $base = rtrim(isset($vars['WEB_ROOT']) ? (string) $vars['WEB_ROOT'] : '', '/');
        $system = isset($vars['systemurl']) ? rtrim((string) $vars['systemurl'], '/') : '';
        if (!preg_match('~^https?://[^/]+~', $system)) { $system = ''; }
        $platform = isset($settings['platform_base_path']) ? self::platformPath($settings['platform_base_path']) : '';
        $result = array(
            'navigation' => $catalog['navigation'], 'footer' => $catalog['footer'],
            'toolCategories' => isset($catalog['toolCategories']) && is_array($catalog['toolCategories']) ? $catalog['toolCategories'] : array(),
            'pages' => $catalog['pages'], 'page' => $page, 'home' => $home,
            'public' => $home || $page !== null || in_array($script, array('notfound.php', 'site-search.php', 'service-error.php'), true),
            'path' => $script, 'base' => $base, 'platform' => $platform,
            'title' => $home ? 'Build. Host. Deploy. Scale.' : ($page ? $page['title'] : (isset($vars['pagetitle']) ? strip_tags($vars['pagetitle']) : 'Client Area')),
            'description' => $home ? 'CloudHost247 gives businesses, developers and organizations the infrastructure they need to build and operate online — from domains and websites to cloud servers, applications and deployment platforms.' : ($page ? $page['summary'] : 'Access your CloudHost247 account, services, billing and support.'),
            'canonical' => $system && ($home || $page) ? $system . '/' . ($home ? '' : $script) : '',
            'social' => ($system ?: $base) . '/assets/images/cloudhost247/social/cloudhost247-social.png',
        );
        if (!$page && !empty($vars['cloudhost247Page']['slug']) && empty($vars['cloudhost247Page']['missing'])) {
            $result['public'] = true;
            $result['title'] = $vars['cloudhost247Page']['title'];
            $result['description'] = isset($vars['cloudhost247Page']['summary']) ? $vars['cloudhost247Page']['summary'] : '';
            $result['canonical'] = $system ? $system . '/cloudhost247-page.php?slug=' . rawurlencode($vars['cloudhost247Page']['slug']) : '';
        }
        if (!empty($vars['cloudhost247ToolsPage']['path'])) {
            $toolPage = $vars['cloudhost247ToolsPage'];
            $result['title'] = $toolPage['name'];
            $result['description'] = $toolPage['summary'];
            if (empty($toolPage['unserved'])) {
                $result['public'] = true;
                $result['canonical'] = $system ? $system . $toolPage['path'] : '';
            } else {
                // The capability lives in the platform application; this PHP route only explains
                // where to find it. It is a signpost, not a published page, so it gets no canonical
                // and the head marks it `noindex` — a thin duplicate of a working tool page is
                // exactly what a crawler should not be handed.
                $result['public'] = false;
                $result['canonical'] = '';
            }
        }
        if (!empty($vars['cloudhost247Page']['seo_description'])) { $result['description'] = $vars['cloudhost247Page']['seo_description']; }
        $result['schema_json'] = '';
        if ($result['canonical'] !== '') {
            $result['schema_json'] = json_encode(array('@context' => 'https://schema.org', '@type' => $home ? 'WebSite' : 'WebPage', 'name' => $home ? 'CloudHost247' : $result['title'], 'url' => $result['canonical'], 'description' => $result['description']), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
        }
        return $result;
    }

    /** Same-origin reverse-proxy mount only; never a browser-facing localhost URL. */
    public static function platformPath($path)
    {
        $path = rtrim(trim((string) $path), '/');
        return preg_match('~^/(?:[a-zA-Z0-9_-]+/)*[a-zA-Z0-9_-]+$~D', $path) ? $path : '';
    }

    /** Editorial defaults only: never prices, legal terms or backend availability. */
    public static function editorial($slug)
    {
        foreach (self::catalog()['pages'] as $path => $page) {
            if ($page['slug'] !== $slug || $page['category'] === 'Legal') { continue; }
            $body = '<h2>' . htmlspecialchars($page['title'], ENT_QUOTES, 'UTF-8') . '</h2><p>' . htmlspecialchars($page['summary'], ENT_QUOTES, 'UTF-8') . '</p>';
            $destinations = array(
                'blog' => array('announcements.php', 'Read published updates'),
                'help-center' => array('knowledgebase.php', 'Explore the knowledgebase'),
                'offers' => array('cloudhost247-hosting.php', 'Compare current plans'),
                'domain' => array('cart.php?a=add&amp;domain=register', 'Search domains'),
            );
            if (isset($destinations[$slug])) {
                $destination = $destinations[$slug];
                $body .= '<p><a href="' . $destination[0] . '">' . $destination[1] . '</a></p>';
            }
            return array('id' => 0, 'slug' => $slug, 'title' => $page['title'], 'summary' => $page['summary'], 'body' => $body,
                'seo_title' => $page['title'], 'seo_description' => $page['summary'], 'og_title' => '', 'og_description' => '',
                'canonical_url' => '', 'sitemap' => true, 'editorial_default' => true);
        }
        return null;
    }

    /** Import reviewed copy as drafts. Existing drafts and published pages are never overwritten. */
    public static function importDrafts(ThemeRepository $repository)
    {
        $existing = array();
        foreach ($repository->all() as $item) { $existing[$item['slug']] = true; }
        $count = 0;
        foreach (self::catalog()['pages'] as $path => $page) {
            if (isset($existing[$page['slug']]) || $page['category'] === 'Legal') { continue; }
            $body = '<h2>Built around your project</h2><p>' . htmlspecialchars($page['summary'], ENT_QUOTES, 'UTF-8') . '</p>';
            foreach ($page['features'] as $feature) {
                $body .= '<h3>' . htmlspecialchars($feature[0], ENT_QUOTES, 'UTF-8') . '</h3><p>' . htmlspecialchars($feature[1], ENT_QUOTES, 'UTF-8') . '</p>';
            }
            $repository->saveContent(array('content_type' => 'page', 'slug' => $page['slug'], 'title' => $page['title'], 'summary' => $page['summary'], 'body' => $body, 'seo_title' => $page['title'], 'seo_description' => $page['summary'], 'published' => 0));
            $count++;
        }
        return $count;
    }
}
