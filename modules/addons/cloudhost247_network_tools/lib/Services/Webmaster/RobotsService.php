<?php
namespace CloudHost247\NetworkTools\Services\Webmaster;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;

/**
 * robots.txt generator and validator (docs section 36).
 *
 * The parser understands the directives crawlers actually honour, groups them
 * per user agent, keeps the order the user entered, and reports the mistakes
 * that make a real crawler ignore a line instead of silently tidying them away.
 */
final class RobotsService extends Service
{
    private static $knownDirectives = array('user-agent', 'allow', 'disallow', 'sitemap', 'crawl-delay', 'host', 'clean-param', 'request-rate', 'visit-time', 'noindex');

    protected function execute()
    {
        $raw = str_replace(array("\r\n", "\r"), "\n", (string) $this->input['rules']);
        $lines = explode("\n", $raw);
        $groups = array();
        $sitemaps = array();
        $issues = array();
        $warnings = array();
        $currentAgents = array();
        $sawDirective = false;
        $lineNumber = 0;
        foreach ($lines as $line) {
            $lineNumber++;
            $trimmed = trim($line);
            if ($trimmed === '' || $trimmed[0] === '#') {
                continue;
            }
            $position = strpos($trimmed, ':');
            if ($position === false) {
                $issues[] = array('line' => $lineNumber, 'text' => $trimmed, 'message' => 'Missing ":" — a crawler ignores this line entirely.');
                continue;
            }
            $directive = strtolower(trim(substr($trimmed, 0, $position)));
            $value = trim(substr($trimmed, $position + 1));
            if (!in_array($directive, self::$knownDirectives, true)) {
                $issues[] = array('line' => $lineNumber, 'text' => $trimmed, 'message' => 'Unknown directive "' . $directive . '". Crawlers ignore unknown directives, so this line has no effect.');
                continue;
            }
            if ($directive === 'user-agent') {
                if ($sawDirective && $currentAgents) {
                    $currentAgents = array();
                }
                if ($value === '') {
                    $issues[] = array('line' => $lineNumber, 'text' => $trimmed, 'message' => 'User-agent needs a value. "*" means every crawler.');
                    continue;
                }
                $currentAgents[] = $value;
                $sawDirective = false;
                if (!isset($groups[$value])) {
                    $groups[$value] = array('user_agent' => $value, 'rules' => array());
                }
                continue;
            }
            if ($directive === 'sitemap') {
                if ($value === '') {
                    $issues[] = array('line' => $lineNumber, 'text' => $trimmed, 'message' => 'Sitemap needs an absolute URL.');
                } elseif (stripos($value, 'http') !== 0) {
                    $warnings[] = 'Line ' . $lineNumber . ': sitemap URLs should be absolute (start with https://).';
                    $sitemaps[] = $value;
                } else {
                    $sitemaps[] = $value;
                }
                continue;
            }
            if ($directive === 'crawl-delay' && (!is_numeric($value) || (float) $value < 0)) {
                $issues[] = array('line' => $lineNumber, 'text' => $trimmed, 'message' => 'Crawl-delay must be a number of seconds (for example 10 or 0.5).');
                continue;
            }
            if (in_array($directive, array('allow', 'disallow'), true) && $value !== '' && $value[0] !== '/' && $value !== '*') {
                $warnings[] = 'Line ' . $lineNumber . ': "' . $value . '" does not start with "/". Crawlers treat it as a path that will not match anything.';
            }
            $sawDirective = true;
            if (!$currentAgents) {
                $issues[] = array('line' => $lineNumber, 'text' => $trimmed, 'message' => 'A rule before any "User-agent" line is ignored: groups start with a user agent.');
                continue;
            }
            foreach ($currentAgents as $agent) {
                $groups[$agent]['rules'][] = array('directive' => $directive, 'value' => $value, 'line' => $lineNumber);
            }
        }
        $normalised = array();
        foreach ($groups as $agent => $group) {
            $hasRule = false;
            foreach ($group['rules'] as $rule) {
                if ($rule['directive'] === 'allow' || $rule['directive'] === 'disallow') {
                    $hasRule = true;
                }
            }
            if (!$hasRule) {
                $warnings[] = 'The group for "' . $agent . '" has no Allow/Disallow rule, so it does not change anything.';
            }
            if (strtolower($agent) === '*' && $group['rules'] === array()) {
                $warnings[] = 'The wildcard group is empty; every crawler will be free to crawl everything not blocked elsewhere.';
            }
            $normalised[] = array('user_agent' => $agent, 'rules' => $group['rules']);
        }
        if (!$normalised) {
            return ToolResult::invalid('Add at least one "User-agent:" line with an Allow or Disallow rule.');
        }
        if (!$sitemaps) {
            $warnings[] = 'No Sitemap line was included. Adding one helps crawlers discover pages they cannot reach by following links.';
        }
        return ToolResult::success(array(
            'content' => $this->render($normalised, $sitemaps),
            'groups' => $normalised,
            'group_count' => count($normalised),
            'sitemaps' => array_values(array_unique($sitemaps)),
            'issues' => $issues,
            'filename' => 'robots.txt',
            'explanation' => 'robots.txt is served from the site root and is a request to crawlers, not an access control. Anything that must be private needs authentication, and a page blocked only by robots.txt can still appear in search results if other sites link to it.',
            'summary' => count($normalised) . ' user-agent group(s) generated' . ($issues ? ' with ' . count($issues) . ' line(s) a crawler would ignore.' : '.'),
        ), $warnings);
    }

    private function render(array $groups, array $sitemaps)
    {
        $output = array('# robots.txt generated by CloudHost247 Network Tools');
        foreach ($groups as $group) {
            $output[] = '';
            $output[] = 'User-agent: ' . $group['user_agent'];
            foreach ($group['rules'] as $rule) {
                $output[] = ucfirst($rule['directive']) . ': ' . $rule['value'];
            }
        }
        if ($sitemaps) {
            $output[] = '';
            foreach (array_values(array_unique($sitemaps)) as $sitemap) {
                $output[] = 'Sitemap: ' . $sitemap;
            }
        }
        return implode("\n", $output) . "\n";
    }
}
