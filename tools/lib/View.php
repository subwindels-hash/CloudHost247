<?php
namespace CloudHost247\Tools;

/** Escaped HTML for the tools hub and each tool page. */
final class View
{
    public static function fragment(array $page, $query, $base)
    {
        $base = rtrim((string) $base, '/');
        $kind = isset($page['kind']) ? $page['kind'] : 'tool';
        if ($kind === 'hub' || $kind === 'category') {
            return self::hub($page, $query, $base);
        }
        return self::tool($page, $base);
    }

    public static function document(array $page, $query, $base)
    {
        $title = isset($page['seoTitle']) ? $page['seoTitle'] : ($page['name'] . ' | CloudHost247');
        $description = isset($page['seoDescription']) ? $page['seoDescription'] : $page['summary'];
        $canonical = $base . $page['path'];
        $body = self::shellOpen() . self::fragment($page, $query, $base) . self::shellClose($base);
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            . '<title>' . self::e($title) . '</title>'
            . '<meta name="description" content="' . self::e($description) . '">'
            . '<link rel="canonical" href="' . self::e($canonical) . '">'
            . '<meta property="og:title" content="' . self::e($title) . '">'
            . '<meta property="og:description" content="' . self::e($description) . '">'
            . '<meta property="og:type" content="website">'
            . '<link rel="icon" href="' . self::e($base) . '/assets/images/cloudhost247/favicon/favicon.ico">'
            . '<link rel="stylesheet" href="' . self::e($base) . '/templates/cloudhost247/css/site.css?v=20261007">'
            . '<link rel="stylesheet" href="' . self::e($base) . '/templates/cloudhost247/css/tools.css?v=20261007">'
            . '</head><body class="ch-site ch-public">' . $body . '</body></html>';
    }

    private static function hub(array $page, $query, $base)
    {
        $category = isset($page['slug']) ? $page['slug'] : '';
        $published = Catalog::toolsInDiscovery($category);
        if ($published !== null) {
            // A published discovery category: the same taxonomy the menus and sitemaps use.
            $tools = $published;
        } elseif ($category === '') {
            $tools = Catalog::search($query);
        } else {
            // The catalogue's engine grouping, kept resolvable for older category URLs.
            $tools = array_values(array_filter(Catalog::enabledTools(), function ($tool) use ($category) {
                return $tool['category'] === $category;
            }));
        }
        if ($query !== '' && $category !== '') {
            $tools = array_values(array_filter($tools, function ($tool) use ($query) {
                return stripos($tool['name'] . $tool['summary'] . implode(' ', $tool['keywords']), $query) !== false;
            }));
        }
        $html = '<main id="ch-tools-content" class="ch-tools"><section class="ch-hero ch-tools-hero"><div class="ch-wrap ch-hero-grid"><div><p class="ch-kicker"><span class="ch-dot"></span> CloudHost247 Tools</p><h1>' . self::e($page['name']) . '</h1><p class="ch-lead">' . self::e($page['summary']) . '</p>'
            . '<form class="ch-tools-search" method="get" action="' . self::e($base . '/tools') . '" role="search"><label for="ch-tool-q">Search 100+ tools</label><div><input id="ch-tool-q" name="q" type="search" value="' . self::e($query) . '" placeholder="Search 100+ tools..." autocomplete="off"><button class="ch-btn" type="submit">Search</button></div></form></div>'
            . '<div class="ch-hero-visual"><img src="' . self::e($base) . '/assets/images/cloudhost247/tools/hero.svg" width="660" height="560" alt="Conceptual CloudHost247 network of diagnostic tools"></div></div></section>';
        $html .= '<nav class="ch-tool-cats" aria-label="Tool categories"><div class="ch-wrap">';
        $html .= '<a class="' . ($category === '' && $query === '' ? 'is-active' : '') . '" href="' . self::e($base . '/tools') . '">All Tools</a>';
        foreach (Catalog::discovery() as $slug => $label) {
            $html .= '<a class="' . ($category === $slug ? 'is-active' : '') . '" href="' . self::e($base . '/tools/category/' . $slug) . '">' . self::e($label) . '</a>';
        }
        $html .= '</div></nav><section class="ch-section"><div class="ch-wrap">';
        $html .= '<p class="ch-kicker" role="status">' . count($tools) . ' tools</p>';
        if (!$tools) {
            $html .= '<div class="ch-notice"><h2>No tools match that search.</h2><p>Try a category, or search for dns, ip or json.</p></div>';
        }
        $html .= '<div class="ch-tool-grid">';
        foreach ($tools as $tool) {
            $html .= self::card($tool, $base);
        }
        $html .= '</div></div></section></main>';
        return $html;
    }

    private static function card(array $tool, $base)
    {
        return '<article class="ch-tool-card"><div class="ch-tool-card-top"><img src="' . self::e($base) . '/assets/images/cloudhost247/tools/' . self::e($tool['category']) . '.svg" width="48" height="48" alt="" loading="lazy"><span class="ch-badge">' . self::e($tool['badge']) . '</span></div><p class="ch-kicker">' . self::e($tool['categoryLabel']) . '</p><h2>' . self::e($tool['name']) . '</h2><p>' . self::e($tool['summary']) . '</p><a class="ch-btn ch-btn-small" href="' . self::e($base . $tool['path']) . '">Open Tool</a></article>';
    }

    private static function tool(array $tool, $base)
    {
        $html = '<main id="ch-tools-content" class="ch-tools"><div class="ch-wrap ch-tool-page">';
        $discovery = Catalog::discoveryCategories($tool);
        $primary = $discovery ? $discovery[0] : '';
        $labels = Catalog::discovery();
        $html .= '<nav class="ch-tool-crumb" aria-label="Breadcrumb"><a href="' . self::e($base . '/tools') . '">Tools</a>';
        if ($primary !== '') {
            $html .= '<span aria-hidden="true">/</span><a href="' . self::e($base . '/tools/category/' . $primary) . '">' . self::e($labels[$primary]) . '</a>';
        }
        $html .= '<span aria-hidden="true">/</span><span>' . self::e($tool['name']) . '</span></nav>';
        $html .= '<header class="ch-tool-head"><p class="ch-kicker">' . self::e($tool['categoryLabel']) . ' <span class="ch-badge">' . self::e($tool['badge']) . '</span></p><h1>' . self::e($tool['name']) . '</h1><p class="ch-lead">' . self::e($tool['description']) . '</p></header>';
        if (empty($tool['enabled'])) {
            $html .= '<div class="ch-notice" role="status"><h2>This tool is disabled.</h2><p>An administrator has turned it off. No check will run.</p></div>';
        } elseif (!empty($tool['maintenance'])) {
            $html .= '<div class="ch-notice" role="status"><h2>Maintenance</h2><p>' . self::e($tool['maintenance']) . '</p></div>';
        } else {
            $html .= self::form($tool, $base);
        }
        $html .= '<section class="ch-tool-explain"><h2>What this does</h2><p>' . self::e($tool['description']) . '</p>';
        if (!empty($tool['sensitive']) || $tool['mode'] === 'local') {
            $html .= '<p class="ch-local-note">Processing stays in this browser. CloudHost247 does not receive or store the value.</p>';
        }
        $html .= '</section><section><h2>Questions</h2>';
        foreach ($tool['faq'] as $item) {
            $html .= '<details class="ch-faq"><summary>' . self::e($item['q']) . '</summary><p>' . self::e($item['a']) . '</p></details>';
        }
        $html .= '</section><section><h2>Related tools</h2><div class="ch-tool-related">';
        foreach ($tool['relatedTools'] as $slug) {
            $related = Catalog::find($slug);
            if ($related) {
                $html .= '<a href="' . self::e($base . $related['path']) . '">' . self::e($related['name']) . '</a>';
            }
        }
        $html .= '</div></section><section><h2>Related CloudHost247 services</h2><div class="ch-tool-related">';
        foreach ($tool['services'] as $service) {
            $href = $service['url'] === 'tools' ? $base . '/tools' : $base . '/' . $service['url'];
            $html .= '<a href="' . self::e($href) . '">' . self::e($service['label']) . '</a>';
        }
        $html .= '</div></section></div></main>';
        return $html;
    }

    private static function form(array $tool, $base)
    {
        $html = '<form class="ch-tool-form" method="post" action="' . self::e($base . '/tools/api.php') . '" data-mode="' . self::e($tool['mode']) . '" data-handler="' . self::e($tool['handler']) . '" data-slug="' . self::e($tool['slug']) . '">';
        $html .= '<input type="hidden" name="slug" value="' . self::e($tool['slug']) . '"><input type="hidden" name="format" value="html">';
        if (!empty($tool['options'])) {
            $html .= '<input type="hidden" name="options" value="' . self::e(json_encode($tool['options'])) . '">';
        }
        if (!$tool['inputs']) {
            $html .= '<p class="ch-muted">No input is required. Run the check when you are ready.</p>';
        }
        foreach ($tool['inputs'] as $field) {
            $id = 'f-' . $field['name'];
            $html .= '<label for="' . self::e($id) . '">' . self::e($field['label']) . ($field['required'] ? ' <span class="ch-req">required</span>' : '') . '</label>';
            $html .= self::control($id, $field);
        }
        $html .= '<div class="ch-actions"><button class="ch-btn" type="submit">Run check</button><button class="ch-btn ch-btn-dark" type="reset">Clear</button></div>';
        $html .= '<p class="ch-tool-state" data-state="empty" role="status">Nothing has been checked yet.</p>';
        $html .= '<div class="ch-tool-result" aria-live="polite"></div></form>';
        if ($tool['mode'] === 'local') {
            $html .= '<noscript><p>This tool runs in the browser. Enable JavaScript to use it. Nothing is sent to the server.</p></noscript>';
        }
        return $html;
    }

    private static function control($id, array $field)
    {
        $name = self::e($field['name']);
        $required = $field['required'] ? ' required' : '';
        $placeholder = self::e($field['placeholder']);
        if ($field['type'] === 'textarea') {
            return '<textarea id="' . self::e($id) . '" name="' . $name . '" rows="8" placeholder="' . $placeholder . '"' . $required . '></textarea>';
        }
        if ($field['type'] === 'select') {
            $html = '<select id="' . self::e($id) . '" name="' . $name . '"' . $required . '>';
            foreach (self::options($field['name']) as $value => $label) {
                $selected = ((string) $value === (string) $field['placeholder']) ? ' selected' : '';
                $html .= '<option value="' . self::e($value) . '"' . $selected . '>' . self::e($label) . '</option>';
            }
            return $html . '</select>';
        }
        if ($field['type'] === 'file') {
            return '<input id="' . self::e($id) . '" name="' . $name . '" type="file" accept="image/*"' . $required . '>';
        }
        $type = $field['type'] === 'password' ? 'password' : ($field['type'] === 'number' ? 'number' : ($field['type'] === 'url' ? 'url' : 'text'));
        $extra = $type === 'number' ? ' min="0" max="100000"' : ' maxlength="4000"';
        return '<input id="' . self::e($id) . '" name="' . $name . '" type="' . $type . '" placeholder="' . $placeholder . '" value=""' . $extra . $required . ' autocomplete="' . ($type === 'password' ? 'off' : 'on') . '">';
    }

    private static function options($name)
    {
        $maps = array(
            'type' => array('A' => 'A', 'AAAA' => 'AAAA', 'CNAME' => 'CNAME', 'MX' => 'MX', 'NS' => 'NS', 'TXT' => 'TXT', 'SOA' => 'SOA', 'CAA' => 'CAA', 'SRV' => 'SRV', 'PTR' => 'PTR', 'DNSKEY' => 'DNSKEY', 'DS' => 'DS'),
            'policy' => array('none' => 'none', 'quarantine' => 'quarantine', 'reject' => 'reject', '-all' => '-all', '~all' => '~all', '?all' => '?all'),
            'port' => array('25' => '25', '465' => '465', '587' => '587'),
            'op' => array('encode' => 'Encode', 'decode' => 'Decode'),
            'code' => array('301' => '301', '302' => '302'),
            'level' => array('0' => 'RAID 0', '1' => 'RAID 1', '5' => 'RAID 5', '6' => 'RAID 6', '10' => 'RAID 10'),
            'algo' => array('pbkdf2' => 'PBKDF2-SHA-256', 'sha256' => 'SHA-256', 'sha384' => 'SHA-384', 'sha512' => 'SHA-512'),
            'symbols' => array('yes' => 'Letters, numbers and symbols', 'no' => 'Letters and numbers'),
            'kind' => array('zwsp' => 'Zero-width space', 'zwnj' => 'Zero-width non-joiner', 'zwj' => 'Zero-width joiner', 'wj' => 'Word joiner'),
            'mode' => array('generate' => 'Generate an MRZ', 'validate' => 'Validate an MRZ', 'parse' => 'Parse an MRZ'),
            'sex' => array('F' => 'F — female', 'M' => 'M — male', '<' => '< — unspecified'),
        );
        return isset($maps[$name]) ? $maps[$name] : array('yes' => 'Yes', 'no' => 'No');
    }

    private static function shellOpen()
    {
        return '<a class="ch-skip" href="#ch-tools-content">Skip to main content</a><header class="ch-header"><div class="ch-nav ch-wrap"><a class="ch-brand" href="/"><img src="/assets/images/cloudhost247/brand/logo-horizontal-dark.svg" width="190" height="36" alt="CloudHost247"></a><nav aria-label="Main"><a href="/tools">Tools</a> <a href="/web-hosting.php">Hosting</a> <a href="/contact.php">Support</a></nav></div></header>';
    }

    private static function shellClose($base)
    {
        return '<footer class="ch-footer"><div class="ch-wrap"><p>© ' . gmdate('Y') . ' CloudHost247 Isc.</p><p><a href="' . self::e($base . '/tools') . '">All tools</a></p></div></footer><script type="module" src="' . self::e($base) . '/templates/cloudhost247/js/tools.js?v=20261007"></script>';
    }

    public static function resultHtml(array $result)
    {
        if (empty($result['ok'])) {
            return '<div class="ch-tool-error" role="alert"><h2>Check failed</h2><p>' . self::e(isset($result['error']) ? $result['error'] : 'Unknown error') . '</p></div>';
        }
        $html = '<div class="ch-tool-ok"><h2>' . self::e($result['summary']) . '</h2>';
        if (!empty($result['checkedAt'])) {
            $html .= '<p>Last checked ' . self::e($result['checkedAt']) . (isset($result['elapsedMs']) ? ' · ' . (int) $result['elapsedMs'] . ' ms' : '') . '</p>';
        }
        if (!empty($result['rows'])) {
            $html .= '<div class="ch-table-scroll"><table><thead><tr>';
            foreach (array_keys($result['rows'][0]) as $heading) {
                $html .= '<th>' . self::e($heading) . '</th>';
            }
            $html .= '</tr></thead><tbody>';
            foreach ($result['rows'] as $row) {
                $html .= '<tr>';
                foreach ($row as $cell) {
                    $html .= '<td>' . self::e(is_scalar($cell) ? (string) $cell : json_encode($cell)) . '</td>';
                }
                $html .= '</tr>';
            }
            $html .= '</tbody></table></div>';
        } else {
            $html .= '<p>The check finished with no rows.</p>';
        }
        foreach ($result['notes'] as $note) {
            $html .= '<p class="ch-muted">' . self::e($note) . '</p>';
        }
        return $html . '</div>';
    }

    public static function e($value)
    {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    }
}
