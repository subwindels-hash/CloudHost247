<?php
namespace CloudHost247\Builder\Services;

use CloudHost247\Builder\Repositories\PageRepository;
use CloudHost247\Builder\Site\SocialMeta;

/**
 * XML sitemap of the pages the builder serves publicly.
 *
 * A page is listed only when a search engine could legitimately index it:
 *   - public visibility (client-only and admin-only pages never appear);
 *   - published, or scheduled with its publish time already reached;
 *   - not marked noindex;
 *   - not pointing its canonical URL at a different address.
 * Drafts, archived pages and previews are never listed. URLs are built exactly as
 * PageService::publicUrl() builds them, so a listed URL is a URL that resolves.
 */
final class SitemapService
{
    const MAX_URLS = 50000;

    private $pages;
    private $settings;

    public function __construct(PageRepository $pages = null, Settings $settings = null)
    {
        $this->pages = $pages ? $pages : new PageRepository();
        $this->settings = $settings ? $settings : new Settings();
    }

    /** @return array<int,array{loc:string,lastmod:string}> */
    public function entries($systemUrl, $now = null)
    {
        $now = $now === null ? time() : (int) $now;
        $base = rtrim((string) $systemUrl, '/');
        $path = (string) $this->settings->get('public_base_path', 'builder-page.php');
        $pretty = $this->settings->flag('pretty_urls');
        $entries = array();
        foreach ($this->pages->sitemapCandidates(self::MAX_URLS) as $page) {
            if ($page['status'] === 'scheduled') {
                $when = $page['publish_at'] !== '' ? strtotime($page['publish_at']) : 0;
                if (!$when || $when > $now) { continue; }
            }
            if (strpos(strtolower($page['meta_robots']), 'noindex') !== false) { continue; }

            $relative = $pretty ? '/' . $page['slug'] : '/' . ltrim($path, '/') . '?slug=' . rawurlencode($page['slug']);
            $loc = $base . $relative;
            if ($page['canonical_url'] !== '') {
                $canonical = SocialMeta::absolute($page['canonical_url'], $systemUrl);
                if ($canonical !== '' && $canonical !== $loc) { continue; }
            }
            $stamp = $page['published_at'] !== '' ? $page['published_at'] : $page['updated_at'];
            $time = $stamp !== '' ? strtotime($stamp) : 0;
            $entries[] = array('loc' => $loc, 'lastmod' => $time ? gmdate('Y-m-d', $time) : '');
        }
        return $entries;
    }

    public function xml($systemUrl, $now = null)
    {
        $xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n";
        foreach ($this->entries($systemUrl, $now) as $entry) {
            $xml .= '<url><loc>' . htmlspecialchars($entry['loc'], ENT_XML1 | ENT_QUOTES, 'UTF-8') . '</loc>'
                . ($entry['lastmod'] !== '' ? '<lastmod>' . $entry['lastmod'] . '</lastmod>' : '')
                . "</url>\n";
        }
        return $xml . "</urlset>\n";
    }
}
