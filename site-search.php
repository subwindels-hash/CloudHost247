<?php
/** Public, bounded editorial search. No account records, draft bodies or credentials. */
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/Site.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/PublicDiscovery.php';
$ca = new \WHMCS\ClientArea();
$ca->initPage();
$ca->setPageTitle('Search CloudHost247');
$query = isset($_GET['q']) && is_string($_GET['q']) ? trim(substr($_GET['q'], 0, 100)) : '';
$results = array();
$toolResults = array();
$unavailable = false;
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, follow');
if ($query !== '') {
    try {
        require_once __DIR__ . '/modules/addons/cloudhost247_core/bootstrap.php';
        require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/ThemeRepository.php';
        $repository = new \CloudHost247\Theme\ThemeRepository();
        $pages = \CloudHost247\Theme\PublicDiscovery::pages($repository);
        $results = \CloudHost247\Theme\PublicDiscovery::search($pages, $query);
    } catch (\Throwable $e) {
        // A failed publication lookup must not rediscover intentionally hidden pages.
        $unavailable = true;
        http_response_code(503);
        header('Retry-After: 300');
    }
    // Tools are not CMS pages, so they come from the read-only tools catalogue: the same box
    // finds "mrz", "json" or "dns" and links straight to the tool's own page. Only enabled entries
    // are returned, and a failure here never invents a result.
    try {
        require_once __DIR__ . '/tools/lib/bootstrap.php';
        foreach (\CloudHost247\Tools\Catalog::search($query) as $tool) {
            if (empty($tool['enabled']) || empty($tool['path'])) {
                continue;
            }
            $toolResults[] = array(
                'url' => ltrim($tool['path'], '/'),
                'title' => $tool['name'],
                'summary' => isset($tool['summary']) ? $tool['summary'] : '',
                'category' => 'Tool',
            );
            if (count($toolResults) >= 12) {
                break;
            }
        }
    } catch (\Throwable $e) {
        // The page search stays usable when the tools catalogue is unavailable.
        $toolResults = array();
    }
}
$ca->assign('chSearchUnavailable', $unavailable);
$ca->assign('chSearchQuery', $query);
$ca->assign('chSearchResults', $results);
$ca->assign('chSearchTools', $toolResults);
$ca->setTemplate('cloudhost247-search');
$ca->output();
