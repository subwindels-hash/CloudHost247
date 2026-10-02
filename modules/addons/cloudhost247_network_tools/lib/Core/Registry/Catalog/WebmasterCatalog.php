<?php
namespace CloudHost247\NetworkTools\Core\Registry\Catalog;

/**
 * Webmaster & SEO tools (docs sections 34-37).
 */
final class WebmasterCatalog
{
    public static function definitions()
    {
        return array(
            'webmaster/broken-links' => array(
                'name' => 'Broken Link Checker',
                'category' => 'webmaster',
                'icon' => 'link-2',
                'summary' => 'Crawl a site within strict limits and report broken or redirected links.',
                'description' => 'Performs a bounded same-site crawl, checks each discovered link and reports status, type, redirect target and the page it was found on.',
                'explanation' => 'Only a sample of a site can be crawled inside the configured page, link, size and time budget. Links outside the site are not crawled, only checked once.',
                'fields' => array(
                    array('name' => 'url', 'type' => 'url', 'label' => 'Start URL', 'required' => true, 'placeholder' => 'https://example.com', 'target' => true),
                    array('name' => 'max_pages', 'type' => 'number', 'label' => 'Maximum pages', 'required' => false, 'default' => 10, 'min' => 1, 'max' => 25),
                    array('name' => 'max_links', 'type' => 'number', 'label' => 'Maximum links', 'required' => false, 'default' => 150, 'min' => 10, 'max' => 400),
                    array('name' => 'check_external', 'type' => 'checkbox', 'label' => 'Check external links (one request each)', 'default' => false),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Webmaster\\BrokenLinksService',
                'rate_tier' => 'high_risk',
                'high_risk' => true,
                'target_field' => 'url',
                'timeout_seconds' => 30,
                'cache_seconds' => 300,
                'exports' => array('json', 'csv', 'pdf'),
                'result_view' => 'links',
                'capabilities' => array('curl'),
            ),
            'webmaster/open-graph' => array(
                'name' => 'Open Graph Checker',
                'category' => 'webmaster',
                'icon' => 'share',
                'summary' => 'Check the Open Graph and Twitter/X card tags a page publishes.',
                'description' => 'Reads the page, extracts og:* and twitter:* tags, validates image URLs and dimensions where they are declared, and renders the preview a social platform would build from them.',
                'explanation' => 'The preview is produced from the tags found in the HTML. Each platform applies its own rules, so the preview is a representation of the data, not a guarantee of how any specific platform will render it.',
                'fields' => array(
                    array('name' => 'url', 'type' => 'url', 'label' => 'URL', 'required' => true, 'target' => true),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Webmaster\\OpenGraphService',
                'target_field' => 'url',
                'cache_seconds' => 300,
                'exports' => array('json', 'pdf', 'png'),
                'result_view' => 'opengraph',
                'capabilities' => array('curl'),
            ),
            'webmaster/robots-generator' => array(
                'name' => 'robots.txt Generator',
                'category' => 'webmaster',
                'icon' => 'robot',
                'summary' => 'Build a robots.txt with user-agent groups, allow/disallow and sitemaps.',
                'description' => 'Generates a correctly ordered robots.txt from the rules you enter, with validation of paths and sitemap URLs, ready to copy or download.',
                'explanation' => 'robots.txt is a request, not an access control: it only guides well-behaved crawlers. Content that must be protected needs authentication, not a Disallow line.',
                'fields' => array(
                    array('name' => 'rules', 'type' => 'textarea', 'label' => 'Rules', 'required' => true, 'rows' => 8, 'maxlength' => 8192, 'default' => "User-agent: *\nDisallow: /admin/\nAllow: /", 'help' => 'One directive per line: User-agent, Allow, Disallow, Sitemap, Crawl-delay.'),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Webmaster\\RobotsService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'exports' => array('json', 'txt'),
                'result_view' => 'generated',
            ),
            'webmaster/serp-simulator' => array(
                'name' => 'SERP Simulator',
                'category' => 'webmaster',
                'icon' => 'search',
                'summary' => 'Preview how a title, URL and description could appear in a search result.',
                'description' => 'Renders a search-result-style preview from the values you enter, with length guidance for titles and descriptions.',
                'explanation' => 'This is a simulator, not a live ranking or a Google preview. Actual search results depend on the query, the device, personalisation and many factors this tool cannot see.',
                'fields' => array(
                    array('name' => 'title', 'type' => 'text', 'label' => 'Title', 'required' => true, 'maxlength' => 255),
                    array('name' => 'url', 'type' => 'text', 'label' => 'Display URL', 'required' => true, 'maxlength' => 255),
                    array('name' => 'description', 'type' => 'textarea', 'label' => 'Description', 'required' => false, 'rows' => 4, 'maxlength' => 1024),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Webmaster\\SerpService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'exports' => array('json', 'png'),
                'result_view' => 'serp',
            ),
        );
    }
}
