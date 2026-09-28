<?php
namespace CloudHost247\Builder\Admin;

use CloudHost247\Builder\Security\CapabilityPolicy;

/**
 * Website Builder admin screens.
 *
 * Plain HTML, escaped at every insertion point. The only unescaped strings are
 * the stylesheet and script tags this class writes itself; no value that came
 * from the database, the request or an import is ever echoed raw.
 *
 * Buttons that write are always inside a POST form carrying the WHMCS CSRF
 * token, and a control the administrator lacks the capability for is not
 * rendered at all -- the server still checks, so hiding it is a courtesy, not
 * the protection.
 */
class AdminView
{
    const SECTIONS = array(
        'dashboard' => 'Overview',
        'pages' => 'Pages',
        'templates' => 'Templates',
        'theme' => 'Theme Builder',
        'menus' => 'Navigation Menus',
        'styles' => 'Global Styles',
        'media' => 'Media Library',
        'forms' => 'Forms',
        'seo' => 'SEO Settings',
        'css' => 'Custom CSS',
        'settings' => 'Builder Settings',
        'activity' => 'Activity',
    );

    private $link;

    public function __construct($link)
    {
        $this->link = (string) $link;
    }

    public function render(array $data)
    {
        if (!empty($data['__handled'])) { return ''; }
        $view = isset($data['view']) ? $data['view'] : 'dashboard';
        if ($view === 'denied') { return $this->denied($data); }
        if ($view === 'editor') { return $this->editor($data); }

        switch ($view) {
            case 'pages': $body = $this->pages($data); break;
            case 'page': $body = $this->pageSettings($data); break;
            case 'revisions': $body = $this->revisions($data); break;
            case 'templates': $body = $this->templates($data); break;
            case 'theme': $body = $this->theme($data); break;
            case 'part': $body = $this->part($data); break;
            case 'menus': $body = $this->menus($data); break;
            case 'styles': $body = $this->styles($data); break;
            case 'media': $body = $this->media($data); break;
            case 'forms': $body = $this->forms($data); break;
            case 'submissions': $body = $this->submissions($data); break;
            case 'seo': $body = $this->seo($data); break;
            case 'css': $body = $this->css($data); break;
            case 'settings': $body = $this->settings($data); break;
            case 'activity': $body = $this->activity($data); break;
            default: $body = $this->dashboard($data);
        }
        return $this->layout($body, $data);
    }

    /* ---------------------------------------------------------------- shell */

    private function layout($body, array $data)
    {
        $view = isset($data['view']) ? $data['view'] : 'dashboard';
        $capabilities = isset($data['capabilities']) ? $data['capabilities'] : array();
        $navigation = '';
        foreach (self::SECTIONS as $key => $label) {
            $required = isset(AdminController::VIEW_CAPABILITIES[$key]) ? AdminController::VIEW_CAPABILITIES[$key] : 'builder.view';
            if (isset($capabilities[$required]) && !$capabilities[$required]) { continue; }
            $active = ($view === $key
                || ($key === 'pages' && in_array($view, array('page', 'revisions'), true))
                || ($key === 'theme' && $view === 'part')
                || ($key === 'forms' && $view === 'submissions')) ? ' class="is-active"' : '';
            $navigation .= '<li' . $active . '><a href="' . $this->url(array('view' => $key)) . '">' . $this->e($label) . '</a></li>';
        }

        $counts = isset($data['counts']) ? $data['counts'] : array();
        $summary = '';
        if ($counts) {
            $summary = '<p class="ch247b-nav__summary">' . (int) $counts['total'] . ' pages &middot; '
                . (int) $counts['published'] . ' published &middot; ' . (int) $counts['draft'] . ' draft</p>';
        }

        return '<link rel="stylesheet" href="' . $this->url(array('asset' => 'admin.css')) . '" />'
            . '<div class="ch247b">'
            . '<header class="ch247b__head"><div><h1>Website Builder</h1>'
            . '<p>Design, publish and manage the public CloudHost247 website. Drafts stay private until you publish them.</p></div>'
            . '<div class="ch247b__headlinks">' . $this->headerActions($data) . '</div></header>'
            . $this->alerts($data)
            . '<div class="ch247b__body"><nav class="ch247b__nav"><ul>' . $navigation . '</ul>' . $summary . '</nav>'
            . '<main class="ch247b__main">' . $body . '</main></div></div>';
    }

    private function headerActions(array $data)
    {
        $links = array();
        if ($this->can($data, 'builder.pages')) {
            $links[] = '<a class="ch247b-btn ch247b-btn--primary" href="' . $this->url(array('view' => 'pages')) . '#new">New page</a>';
        }
        $links[] = '<a class="ch247b-btn" href="' . $this->url(array('view' => 'activity')) . '">Activity log</a>';
        return implode(' ', $links);
    }

    private function alerts(array $data)
    {
        $html = '';
        if (!empty($data['error'])) {
            $html .= '<div class="ch247b-alert ch247b-alert--error"><strong>Not done.</strong> ' . $this->e($data['error']) . '</div>';
        }
        if (!empty($data['notice'])) {
            $html .= '<div class="ch247b-alert ch247b-alert--ok">' . $this->e($data['notice']) . '</div>';
        }
        if (!empty($data['flash']['export'])) {
            $html .= '<div class="ch247b-alert ch247b-alert--info"><p>Template package (JSON). Copy and store it, or paste it into another installation.</p>'
                . '<textarea class="ch247b-code" rows="10" readonly>' . $this->e($data['flash']['export']) . '</textarea></div>';
        }
        if (!empty($data['flash']['inspection'])) {
            $html .= $this->inspection($data['flash']['inspection'], isset($data['flash']['package']) ? $data['flash']['package'] : '', $data);
        }
        return $html;
    }

    private function inspection(array $inspection, $package, array $data)
    {
        $warnings = '';
        foreach ($inspection['warnings'] as $warning) {
            $warnings .= '<li>' . $this->e($warning) . '</li>';
        }
        return '<div class="ch247b-alert ch247b-alert--info"><h3>Package inspected, nothing imported yet</h3>'
            . '<ul class="ch247b-facts">'
            . '<li><span>Template</span><strong>' . $this->e($inspection['template']['name']) . ' (' . $this->e($inspection['template']['key']) . ')</strong></li>'
            . '<li><span>Category</span><strong>' . $this->e($inspection['template']['category']) . '</strong></li>'
            . '<li><span>Elements</span><strong>' . (int) $inspection['elements'] . '</strong></li>'
            . '<li><span>Widgets</span><strong>' . $this->e(implode(', ', $inspection['widgets'])) . '</strong></li>'
            . '<li><span>Checksum</span><strong>' . ($inspection['checksum_matches'] ? 'verified' : 'not verified') . '</strong></li>'
            . '</ul>'
            . ($warnings !== '' ? '<ul class="ch247b-warnings">' . $warnings . '</ul>' : '')
            . '<form method="post" action="' . $this->url(array('view' => 'templates')) . '">'
            . $this->tokenField($data)
            . '<input type="hidden" name="action" value="template.import" />'
            . '<input type="hidden" name="package" value="' . $this->e($package) . '" />'
            . '<button class="ch247b-btn ch247b-btn--primary" type="submit">Import this template</button>'
            . '</form></div>';
    }

    /* ------------------------------------------------------------ dashboard */

    private function dashboard(array $data)
    {
        $counts = isset($data['counts']) ? $data['counts'] : array('total' => 0, 'published' => 0, 'draft' => 0, 'scheduled' => 0);
        $health = isset($data['health']) ? $data['health'] : array();
        $cards = '<div class="ch247b-cards">'
            . $this->statCard('Pages', $counts['total'], 'all statuses')
            . $this->statCard('Published', $counts['published'], 'live on the site')
            . $this->statCard('Drafts', $counts['draft'], 'not publicly reachable')
            . $this->statCard('Scheduled', $counts['scheduled'], 'go live automatically')
            . '</div>';

        $checks = '';
        if ($health) {
            $checks = '<section class="ch247b-panel"><h2>System state</h2><ul class="ch247b-facts">'
                . $this->fact('WHMCS catalogue', $health['catalogue'] ? 'readable' : 'unavailable',
                    $health['catalogue'] ? 'Hosting widgets show live products and prices.' : $health['catalogue_reason'])
                . $this->fact('API &amp; Integrations centre', $health['integrations'] ? 'installed' : 'not installed',
                    $health['integrations'] ? 'The service status widget reports measured health.' : 'The service status widget will say it has nothing measured to show.')
                . $this->fact('Media directory', $health['media_writable'] ? 'writable' : 'not writable', $health['media_path'])
                . $this->fact('Public front controller', $health['front_controller'] ? 'present' : 'missing', $health['front_controller_path'])
                . $this->fact('DOM extension', $health['dom_extension'] ? 'loaded' : 'absent',
                    $health['dom_extension'] ? 'Rich text is sanitised with a DOM parser.' : 'Rich text falls back to the stricter regex filter.')
                . '</ul></section>';
        }

        $recent = '';
        foreach (array_slice($data['listing']['rows'], 0, 6) as $page) {
            $recent .= '<tr><td><a href="' . $this->url(array('view' => 'editor', 'id' => $page['id'])) . '">' . $this->e($page['title']) . '</a></td>'
                . '<td>' . $this->statusBadge($page) . '</td>'
                . '<td class="ch247b-dim">' . $this->e($page['updated_at']) . '</td></tr>';
        }
        $activity = '';
        foreach ($data['activity']['rows'] as $event) {
            $activity .= '<li><span class="ch247b-dim">' . $this->e($event['created_at']) . '</span> ' . $this->e($event['summary']) . '</li>';
        }

        return $cards . $checks
            . '<section class="ch247b-panel"><h2>Recently edited</h2>'
            . ($recent === '' ? '<p class="ch247b-empty">No pages yet. Create one from the Pages screen.</p>'
                : '<table class="ch247b-table"><thead><tr><th>Page</th><th>Status</th><th>Updated</th></tr></thead><tbody>' . $recent . '</tbody></table>')
            . '</section>'
            . '<section class="ch247b-panel"><h2>Recent activity</h2>'
            . ($activity === '' ? '<p class="ch247b-empty">Nothing recorded yet.</p>' : '<ul class="ch247b-log">' . $activity . '</ul>')
            . '</section>';
    }

    private function statCard($label, $value, $note)
    {
        return '<div class="ch247b-card"><span class="ch247b-card__value">' . (int) $value . '</span>'
            . '<span class="ch247b-card__label">' . $this->e($label) . '</span>'
            . '<span class="ch247b-card__note">' . $this->e($note) . '</span></div>';
    }

    private function fact($label, $state, $detail)
    {
        return '<li><span>' . $label . '</span><strong>' . $this->e($state) . '</strong><em>' . $this->e($detail) . '</em></li>';
    }

    /* ---------------------------------------------------------------- pages */

    private function pages(array $data)
    {
        $listing = $data['listing'];
        $rows = '';
        foreach ($listing['rows'] as $page) {
            $rows .= '<tr>'
                . '<td><strong>' . $this->e($page['title']) . '</strong>'
                . ($page['is_home'] ? ' <span class="ch247b-tag">front page</span>' : '')
                . '<br /><span class="ch247b-dim">/' . $this->e($page['slug']) . '</span></td>'
                . '<td>' . $this->statusBadge($page) . '</td>'
                . '<td class="ch247b-dim">' . $this->e($page['updated_at']) . '</td>'
                . '<td class="ch247b-actions">' . $this->pageActions($page, $data) . '</td>'
                . '</tr>';
        }

        $filters = '<form class="ch247b-filters" method="get" action="addonmodules.php">'
            . '<input type="hidden" name="module" value="cloudhost247_builder" />'
            . '<input type="hidden" name="view" value="pages" />'
            . '<input type="search" name="q" placeholder="Search title or address" value="' . $this->e(isset($_GET['q']) ? $_GET['q'] : '') . '" />'
            . '<select name="status"><option value="">Any status</option>';
        foreach (array('draft', 'scheduled', 'published', 'archived') as $status) {
            $selected = (isset($_GET['status']) && $_GET['status'] === $status) ? ' selected="selected"' : '';
            $filters .= '<option value="' . $status . '"' . $selected . '>' . ucfirst($status) . '</option>';
        }
        $filters .= '</select><button class="ch247b-btn" type="submit">Filter</button></form>';

        return '<section class="ch247b-panel"><h2>Pages</h2>' . $filters
            . ($rows === ''
                ? '<p class="ch247b-empty">No pages match. Create one below.</p>'
                : '<table class="ch247b-table"><thead><tr><th>Page</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead><tbody>' . $rows . '</tbody></table>')
            . '<p class="ch247b-dim">' . (int) $listing['total'] . ' page(s). Unlimited pages are supported; the only limit is your server storage.</p>'
            . '</section>'
            . $this->createPageForm($data);
    }

    private function pageActions(array $page, array $data)
    {
        $buttons = array();
        if ($this->can($data, 'builder.pages')) {
            $buttons[] = '<a class="ch247b-btn ch247b-btn--primary ch247b-btn--sm" href="' . $this->url(array('view' => 'editor', 'id' => $page['id'])) . '">Edit</a>';
            $buttons[] = '<a class="ch247b-btn ch247b-btn--sm" href="' . $this->url(array('view' => 'page', 'id' => $page['id'])) . '">Settings</a>';
            $buttons[] = '<a class="ch247b-btn ch247b-btn--sm" href="' . $this->url(array('view' => 'revisions', 'id' => $page['id'])) . '">Revisions</a>';
        }
        if ($page['status'] === 'published') {
            $buttons[] = '<a class="ch247b-btn ch247b-btn--sm" href="' . $this->e($page['public_url']) . '" target="_blank" rel="noopener">View</a>';
        }
        if ($this->can($data, 'builder.publish')) {
            $buttons[] = $page['status'] === 'published'
                ? $this->inlineForm($data, 'page.unpublish', array('page_id' => $page['id']), 'Unpublish', 'ch247b-btn--sm')
                : $this->inlineForm($data, 'page.publish', array('page_id' => $page['id']), 'Publish', 'ch247b-btn--sm ch247b-btn--go');
        }
        if ($this->can($data, 'builder.pages')) {
            $buttons[] = $this->inlineForm($data, 'page.duplicate', array('page_id' => $page['id']), 'Duplicate', 'ch247b-btn--sm');
        }
        return implode(' ', $buttons);
    }

    private function createPageForm(array $data)
    {
        if (!$this->can($data, 'builder.pages')) { return ''; }
        $templates = '';
        foreach ($data['templates'] as $template) {
            if ($template['category'] !== 'page' && $template['category'] !== 'landing') { continue; }
            $templates .= '<option value="' . (int) $template['id'] . '">' . $this->e($template['name']) . '</option>';
        }
        return '<section class="ch247b-panel" id="new"><h2>Create a page</h2>'
            . '<form method="post" action="' . $this->url(array('view' => 'pages')) . '">'
            . $this->tokenField($data)
            . '<input type="hidden" name="action" value="page.create" />'
            . '<div class="ch247b-grid">'
            . $this->field('Title', '<input type="text" name="title" required maxlength="200" placeholder="Managed WordPress hosting" />')
            . $this->field('Address (optional)', '<input type="text" name="slug" maxlength="96" placeholder="managed-wordpress-hosting" />',
                'Leave blank to derive it from the title. Lowercase letters, numbers and hyphens.')
            . $this->field('Start from', '<select name="template_id"><option value="0">Blank page</option>' . $templates . '</select>')
            . $this->field('Visibility', '<select name="visibility">'
                . '<option value="public">Public</option><option value="clients">Signed-in customers</option>'
                . '<option value="admins">Administrators only</option></select>')
            . '</div>'
            . '<label class="ch247b-check"><input type="checkbox" name="start_blank" value="1" checked="checked" /> Add a starter heading and text block</label>'
            . '<button class="ch247b-btn ch247b-btn--primary" type="submit">Create page</button>'
            . '</form></section>';
    }

    private function pageSettings(array $data)
    {
        if (empty($data['page'])) {
            return '<p class="ch247b-empty">' . $this->e(isset($data['error']) ? $data['error'] : 'Page not found.') . '</p>';
        }
        $page = $data['page'];
        $headerOptions = $this->partOptions($data['parts'], $page['header_part']);
        $footerOptions = $this->partOptions($data['parts'], $page['footer_part']);

        $form = '<form method="post" action="' . $this->url(array('view' => 'page', 'id' => $page['id'])) . '">'
            . $this->tokenField($data)
            . '<input type="hidden" name="action" value="page.meta" />'
            . '<input type="hidden" name="page_id" value="' . (int) $page['id'] . '" />'
            . '<div class="ch247b-grid">'
            . $this->field('Title', '<input type="text" name="title" value="' . $this->e($page['title']) . '" maxlength="200" required />')
            . $this->field('Address', '<input type="text" name="slug" value="' . $this->e($page['slug']) . '" maxlength="96" required />',
                'Public URL: ' . $this->e($data['public_url']))
            . $this->field('Visibility', $this->select('visibility', array(
                'public' => 'Public', 'clients' => 'Signed-in customers', 'admins' => 'Administrators only',
            ), $page['visibility']))
            . $this->field('Search engines', $this->select('meta_robots', array(
                'index,follow' => 'Index and follow', 'noindex,follow' => 'No index, follow',
                'index,nofollow' => 'Index, no follow', 'noindex,nofollow' => 'No index, no follow',
            ), $page['meta_robots']))
            . $this->field('SEO title', '<input type="text" name="seo_title" value="' . $this->e($page['seo_title']) . '" maxlength="200" />',
                'Defaults to the page title.')
            . $this->field('Canonical URL', '<input type="text" name="canonical_url" value="' . $this->e($page['canonical_url']) . '" maxlength="300" />')
            . $this->field('Header part', '<select name="header_part">' . $headerOptions . '</select>')
            . $this->field('Footer part', '<select name="footer_part">' . $footerOptions . '</select>')
            . '</div>'
            . $this->field('Meta description', '<textarea name="meta_description" rows="3" maxlength="320">' . $this->e($page['meta_description']) . '</textarea>',
                'Up to 320 characters. Shown in search results.')
            . '<button class="ch247b-btn ch247b-btn--primary" type="submit">Save settings</button>'
            . '</form>';

        $publishing = '<section class="ch247b-panel"><h2>Publishing</h2><ul class="ch247b-facts">'
            . $this->fact('Status', $page['status'], $page['status'] === 'published'
                ? 'Live at ' . $data['public_url'] : 'Not reachable by the public.')
            . $this->fact('Unpublished changes', $page['has_unpublished_changes'] ? 'yes' : 'no',
                $page['has_unpublished_changes'] ? 'The draft differs from the live page.' : 'The draft matches what is live.')
            . $this->fact('Last published', $page['published_at'] !== '' ? $page['published_at'] : 'never', '')
            . '</ul>';
        if ($this->can($data, 'builder.publish')) {
            $publishing .= '<div class="ch247b-row">'
                . $this->inlineForm($data, 'page.publish', array('page_id' => $page['id']), 'Publish now', 'ch247b-btn--go')
                . $this->inlineForm($data, 'page.unpublish', array('page_id' => $page['id']), 'Unpublish', '')
                . $this->inlineForm($data, 'page.home', array('page_id' => $page['id']), 'Set as front page', '')
                . '</div>'
                . '<form class="ch247b-row" method="post" action="' . $this->url(array('view' => 'page', 'id' => $page['id'])) . '">'
                . $this->tokenField($data)
                . '<input type="hidden" name="action" value="page.schedule" />'
                . '<input type="hidden" name="page_id" value="' . (int) $page['id'] . '" />'
                . '<input type="datetime-local" name="publish_at" required />'
                . '<button class="ch247b-btn" type="submit">Schedule</button>'
                . '<span class="ch247b-dim">A scheduled page stays unavailable until its time arrives.</span>'
                . '</form>';
        }
        $publishing .= '</section>';

        $danger = '';
        if ($this->can($data, 'builder.delete')) {
            $danger = '<section class="ch247b-panel ch247b-panel--danger"><h2>Remove this page</h2>'
                . '<p>Archiving keeps the content and takes the page offline. Deleting removes the page and its revision history permanently.</p>'
                . $this->inlineForm($data, 'page.archive', array('page_id' => $page['id']), 'Archive', '')
                . '<form method="post" action="' . $this->url(array('view' => 'pages')) . '" class="ch247b-row">'
                . $this->tokenField($data)
                . '<input type="hidden" name="action" value="page.delete" />'
                . '<input type="hidden" name="page_id" value="' . (int) $page['id'] . '" />'
                . '<input type="text" name="confirm_slug" placeholder="Type ' . $this->e($page['slug']) . ' to confirm" required />'
                . '<button class="ch247b-btn ch247b-btn--danger" type="submit">Delete permanently</button>'
                . '</form></section>';
        }

        return '<section class="ch247b-panel"><h2>' . $this->e($page['title']) . '</h2>'
            . '<p><a class="ch247b-btn ch247b-btn--primary" href="' . $this->url(array('view' => 'editor', 'id' => $page['id'])) . '">Open the visual editor</a></p>'
            . $form . '</section>' . $publishing . $danger;
    }

    private function partOptions(array $parts, $current)
    {
        $options = '<option value="inherit"' . ($current === 'inherit' ? ' selected="selected"' : '') . '>Use the matching theme part</option>'
            . '<option value="none"' . ($current === 'none' ? ' selected="selected"' : '') . '>None</option>';
        foreach ($parts as $part) {
            $options .= '<option value="' . $this->e($part['part_key']) . '"' . ($current === $part['part_key'] ? ' selected="selected"' : '') . '>'
                . $this->e($part['name'] . ' (' . $part['part_type'] . ')') . '</option>';
        }
        return $options;
    }

    private function revisions(array $data)
    {
        if (empty($data['page'])) {
            return '<p class="ch247b-empty">' . $this->e(isset($data['error']) ? $data['error'] : 'Page not found.') . '</p>';
        }
        $rows = '';
        foreach ($data['revisions'] as $revision) {
            $rows .= '<tr><td>#' . (int) $revision['revision_no'] . '</td>'
                . '<td>' . $this->e($revision['note'])
                . ($revision['is_published_snapshot'] ? ' <span class="ch247b-tag">published snapshot</span>' : '')
                . ($revision['is_autosave'] ? ' <span class="ch247b-tag ch247b-tag--dim">autosave</span>' : '') . '</td>'
                . '<td class="ch247b-dim">' . $this->e($revision['created_at']) . '</td>'
                . '<td class="ch247b-dim">admin #' . (int) $revision['author_id'] . '</td>'
                . '<td>' . ($this->can($data, 'builder.pages')
                    ? $this->inlineForm($data, 'page.restore', array('page_id' => $data['page']['id'], 'revision_id' => $revision['id']), 'Restore', 'ch247b-btn--sm')
                    : '') . '</td></tr>';
        }
        return '<section class="ch247b-panel"><h2>Revisions &amp; backups: ' . $this->e($data['page']['title']) . '</h2>'
            . '<p>Every saved change is kept. Restoring loads that version into the draft; the live page only changes when you publish.</p>'
            . ($rows === '' ? '<p class="ch247b-empty">No revisions yet.</p>'
                : '<table class="ch247b-table"><thead><tr><th>#</th><th>Note</th><th>Saved</th><th>By</th><th></th></tr></thead><tbody>' . $rows . '</tbody></table>')
            . '</section>';
    }

    /* ------------------------------------------------------------ templates */

    private function templates(array $data)
    {
        $groups = array();
        foreach ($data['templates'] as $template) { $groups[$template['category']][] = $template; }
        $html = '';
        foreach ($data['categories'] as $category) {
            if (empty($groups[$category])) { continue; }
            $cards = '';
            foreach ($groups[$category] as $template) {
                $actions = '';
                if ($this->can($data, 'builder.templates')) {
                    $actions .= $this->inlineForm($data, 'template.export', array('template_id' => $template['id']), 'Export', 'ch247b-btn--sm');
                    if (!$template['is_builtin']) {
                        $actions .= ' ' . $this->inlineForm($data, 'template.delete', array('template_id' => $template['id']), 'Delete', 'ch247b-btn--sm ch247b-btn--danger');
                    }
                }
                $cards .= '<div class="ch247b-tile"><h3>' . $this->e($template['name'])
                    . ($template['is_builtin'] ? ' <span class="ch247b-tag">built-in</span>' : '') . '</h3>'
                    . '<p class="ch247b-dim">' . $this->e($template['description']) . '</p>'
                    . '<p class="ch247b-dim">Key: ' . $this->e($template['template_key']) . '</p>'
                    . '<div class="ch247b-row">' . $actions . '</div></div>';
            }
            $html .= '<section class="ch247b-panel"><h2>' . $this->e(ucfirst($category)) . '</h2><div class="ch247b-tiles">' . $cards . '</div></section>';
        }
        if ($html === '') { $html = '<section class="ch247b-panel"><p class="ch247b-empty">No templates yet.</p></section>'; }

        $import = '';
        if ($this->can($data, 'builder.templates')) {
            $import = '<section class="ch247b-panel"><h2>Import a template</h2>'
                . '<p>Packages are JSON documents. Import validates every element against the widget library before saving, '
                . 'and never executes PHP, JavaScript or any file from the package.</p>'
                . '<form method="post" action="' . $this->url(array('view' => 'templates')) . '" enctype="multipart/form-data">'
                . $this->tokenField($data)
                . '<input type="hidden" name="action" value="template.import" />'
                . '<input type="hidden" name="inspect_only" value="1" />'
                . $this->field('Package file', '<input type="file" name="package_file" accept="application/json,.json" />')
                . $this->field('Or paste the package', '<textarea class="ch247b-code" name="package" rows="6"></textarea>')
                . '<button class="ch247b-btn ch247b-btn--primary" type="submit">Inspect package</button>'
                . '<span class="ch247b-dim">Inspection shows what the package contains. Nothing is saved until you confirm.</span>'
                . '</form></section>';
        }
        return $html . $import;
    }

    /* ---------------------------------------------------------------- theme */

    private function theme(array $data)
    {
        $rows = '';
        foreach ($data['parts'] as $part) {
            $rows .= '<tr><td><strong>' . $this->e($part['name']) . '</strong><br /><span class="ch247b-dim">'
                . $this->e($part['part_key']) . '</span></td>'
                . '<td>' . $this->e(isset($data['part_types'][$part['part_type']]) ? $data['part_types'][$part['part_type']] : $part['part_type']) . '</td>'
                . '<td>' . $this->e($part['status'])
                . ($part['has_unpublished_changes'] ? ' <span class="ch247b-tag">unpublished changes</span>' : '') . '</td>'
                . '<td class="ch247b-dim">' . $this->e($part['conditions_summary']) . '</td>'
                . '<td class="ch247b-actions">'
                . '<a class="ch247b-btn ch247b-btn--sm ch247b-btn--primary" href="' . $this->url(array('view' => 'editor', 'part' => $part['id'])) . '">Edit</a> '
                . '<a class="ch247b-btn ch247b-btn--sm" href="' . $this->url(array('view' => 'part', 'id' => $part['id'])) . '">Conditions</a> '
                . $this->inlineForm($data, 'part.publish', array('part_id' => $part['id']), 'Publish', 'ch247b-btn--sm ch247b-btn--go') . ' '
                . $this->inlineForm($data, 'part.disable', array('part_id' => $part['id']), 'Disable', 'ch247b-btn--sm')
                . '</td></tr>';
        }
        $typeOptions = '';
        foreach ($data['part_types'] as $key => $label) {
            $typeOptions .= '<option value="' . $this->e($key) . '">' . $this->e($label) . '</option>';
        }
        return '<section class="ch247b-panel"><h2>Theme Builder</h2>'
            . '<p>Theme parts are additive layers rendered around builder pages. Your HostX theme files are never modified, '
            . 'and a part only appears where its display conditions match.</p>'
            . ($rows === '' ? '<p class="ch247b-empty">No theme parts yet.</p>'
                : '<table class="ch247b-table"><thead><tr><th>Part</th><th>Type</th><th>Status</th><th>Shown on</th><th>Actions</th></tr></thead><tbody>' . $rows . '</tbody></table>')
            . '</section>'
            . '<section class="ch247b-panel"><h2>New theme part</h2>'
            . '<form method="post" action="' . $this->url(array('view' => 'theme')) . '">'
            . $this->tokenField($data)
            . '<input type="hidden" name="action" value="part.create" />'
            . '<div class="ch247b-grid">'
            . $this->field('Name', '<input type="text" name="name" required maxlength="160" placeholder="Main site header" />')
            . $this->field('Key', '<input type="text" name="part_key" required maxlength="64" placeholder="main-header" />')
            . $this->field('Type', '<select name="part_type">' . $typeOptions . '</select>')
            . $this->field('Priority', '<input type="number" name="priority" value="10" min="1" max="999" />',
                'Lower numbers win when several parts of the same type match.')
            . '</div>'
            . '<button class="ch247b-btn ch247b-btn--primary" type="submit">Create part</button>'
            . '</form></section>';
    }

    private function part(array $data)
    {
        if (empty($data['part'])) {
            return '<p class="ch247b-empty">' . $this->e(isset($data['error']) ? $data['error'] : 'Part not found.') . '</p>';
        }
        $part = $data['part'];
        $typeOptions = '';
        foreach ($data['part_types'] as $key => $label) {
            $typeOptions .= '<option value="' . $this->e($key) . '"' . ($part['part_type'] === $key ? ' selected="selected"' : '') . '>' . $this->e($label) . '</option>';
        }
        return '<section class="ch247b-panel"><h2>' . $this->e($part['name']) . '</h2>'
            . '<p class="ch247b-dim">' . $this->e($data['conditions_summary']) . '</p>'
            . '<p><a class="ch247b-btn ch247b-btn--primary" href="' . $this->url(array('view' => 'editor', 'part' => $part['id'])) . '">Open the visual editor</a></p>'
            . '<form method="post" action="' . $this->url(array('view' => 'part', 'id' => $part['id'])) . '">'
            . $this->tokenField($data)
            . '<input type="hidden" name="action" value="part.update" />'
            . '<input type="hidden" name="part_id" value="' . (int) $part['id'] . '" />'
            . '<div class="ch247b-grid">'
            . $this->field('Name', '<input type="text" name="name" value="' . $this->e($part['name']) . '" maxlength="160" />')
            . $this->field('Type', '<select name="part_type">' . $typeOptions . '</select>')
            . $this->field('Priority', '<input type="number" name="priority" value="' . (int) $part['priority'] . '" min="1" max="999" />')
            . $this->field('Status', $this->select('status', array(
                'draft' => 'Draft', 'published' => 'Published', 'disabled' => 'Disabled',
            ), $part['status']))
            . '</div>'
            . '<h3>Show this part on</h3>' . $this->ruleRows('include', $part['conditions']['include'], $data)
            . '<h3>Except on</h3>' . $this->ruleRows('exclude', isset($part['conditions']['exclude']) ? $part['conditions']['exclude'] : array(), $data)
            . '<button class="ch247b-btn ch247b-btn--primary" type="submit">Save conditions</button>'
            . '</form>'
            . '<div class="ch247b-row">'
            . $this->inlineForm($data, 'part.publish', array('part_id' => $part['id']), 'Publish part', 'ch247b-btn--go')
            . $this->inlineForm($data, 'part.delete', array('part_id' => $part['id']), 'Delete part', 'ch247b-btn--danger')
            . '</div></section>';
    }

    private function ruleRows($bucket, array $rules, array $data)
    {
        $html = '';
        $rules[] = array('type' => '', 'value' => '');
        foreach ($rules as $rule) {
            $options = '<option value="">No rule</option>';
            foreach ($data['rule_types'] as $key => $label) {
                $options .= '<option value="' . $this->e($key) . '"' . ($rule['type'] === $key ? ' selected="selected"' : '') . '>'
                    . $this->e($label) . '</option>';
            }
            $html .= '<div class="ch247b-row"><select name="' . $this->e($bucket) . '_type[]">' . $options . '</select>'
                . '<input type="text" name="' . $this->e($bucket) . '_value[]" value="' . $this->e($rule['value'])
                . '" placeholder="page id, slug prefix or page type" /></div>';
        }
        return $html;
    }

    /* ---------------------------------------------------------------- menus */

    private function menus(array $data)
    {
        $existing = '';
        foreach ($data['menus'] as $menu) {
            $items = '';
            $index = 0;
            foreach ($menu['items'] as $item) {
                $items .= $this->menuRow($index, $item, '');
                $parentIndex = $index;
                $index++;
                foreach (isset($item['children']) && is_array($item['children']) ? $item['children'] : array() as $child) {
                    $items .= $this->menuRow($index, $child, (string) $parentIndex);
                    $index++;
                }
            }
            $items .= $this->menuRow($index, array('label' => '', 'url' => '', 'target' => 'self'), '');
            $items .= $this->menuRow($index + 1, array('label' => '', 'url' => '', 'target' => 'self'), '');

            $existing .= '<section class="ch247b-panel"><h2>' . $this->e($menu['name']) . '</h2>'
                . '<form method="post" action="' . $this->url(array('view' => 'menus')) . '">'
                . $this->tokenField($data)
                . '<input type="hidden" name="action" value="menu.save" />'
                . '<input type="hidden" name="menu_key" value="' . $this->e($menu['menu_key']) . '" />'
                . '<input type="hidden" name="name" value="' . $this->e($menu['name']) . '" />'
                . '<table class="ch247b-table"><thead><tr><th>Label</th><th>Link</th><th>Opens</th><th>Nested under row</th></tr></thead><tbody>'
                . $items . '</tbody></table>'
                . '<button class="ch247b-btn ch247b-btn--primary" type="submit">Save menu</button>'
                . '</form> '
                . $this->inlineForm($data, 'menu.delete', array('menu_id' => $menu['id']), 'Delete menu', 'ch247b-btn--danger')
                . '</section>';
        }

        $create = '<section class="ch247b-panel"><h2>New menu</h2>'
            . '<form method="post" action="' . $this->url(array('view' => 'menus')) . '">'
            . $this->tokenField($data)
            . '<input type="hidden" name="action" value="menu.save" />'
            . '<div class="ch247b-grid">'
            . $this->field('Name', '<input type="text" name="name" required maxlength="160" placeholder="Main navigation" />')
            . $this->field('Key', '<input type="text" name="menu_key" required maxlength="64" placeholder="main-navigation" />')
            . '</div>'
            . '<table class="ch247b-table"><thead><tr><th>Label</th><th>Link</th><th>Opens</th><th>Nested under row</th></tr></thead><tbody>'
            . $this->menuRow(0, array('label' => 'Hosting', 'url' => 'cart.php', 'target' => 'self'), '')
            . $this->menuRow(1, array('label' => 'Domains', 'url' => 'domainchecker.php', 'target' => 'self'), '')
            . $this->menuRow(2, array('label' => '', 'url' => '', 'target' => 'self'), '')
            . '</tbody></table>'
            . '<button class="ch247b-btn ch247b-btn--primary" type="submit">Create menu</button>'
            . '</form></section>';

        return ($existing === ''
            ? '<section class="ch247b-panel"><p class="ch247b-empty">No menus yet. Create one below, then add it to a header with the Navigation menu widget.</p></section>'
            : $existing) . $create;
    }

    private function menuRow($index, array $item, $parent)
    {
        $target = isset($item['target']) ? $item['target'] : 'self';
        return '<tr>'
            . '<td><input type="text" name="item_label[' . (int) $index . ']" value="' . $this->e(isset($item['label']) ? $item['label'] : '') . '" maxlength="80" /></td>'
            . '<td><input type="text" name="item_url[' . (int) $index . ']" value="' . $this->e(isset($item['url']) ? $item['url'] : '') . '" maxlength="300" placeholder="cart.php or https://..." /></td>'
            . '<td><select name="item_target[' . (int) $index . ']">'
            . '<option value="self"' . ($target === 'self' ? ' selected="selected"' : '') . '>Same tab</option>'
            . '<option value="blank"' . ($target === 'blank' ? ' selected="selected"' : '') . '>New tab</option>'
            . '</select></td>'
            . '<td><input type="text" name="item_parent[' . (int) $index . ']" value="' . $this->e($parent) . '" size="4" /></td>'
            . '</tr>';
    }

    /* --------------------------------------------------------------- styles */

    private function styles(array $data)
    {
        $colors = '';
        $fonts = '';
        $sizes = '';
        foreach ($data['defaults'] as $name => $default) {
            $value = isset($data['styles'][$name]) ? $data['styles'][$name] : $default;
            $label = $this->e(ucfirst(str_replace('-', ' ', $name)));
            $note = isset($data['overrides'][$name]) ? 'customised' : 'default';
            $input = '<input type="text" name="style[' . $this->e($name) . ']" value="' . $this->e($value) . '" maxlength="160" />';
            if (strncmp($name, 'color-', 6) === 0) {
                $colors .= $this->field($label, $input . '<span class="ch247b-swatch" style="background:' . $this->e($value) . '"></span>', $note);
            } elseif (strncmp($name, 'font-', 5) === 0) {
                $fonts .= $this->field($label, $input, $note);
            } else {
                $sizes .= $this->field($label, $input, $note);
            }
        }
        return '<section class="ch247b-panel"><h2>Global styles</h2>'
            . '<p>These become CSS custom properties on every builder page. Widgets reference them by name, so changing a '
            . 'colour here updates every page that uses it without touching a single element.</p>'
            . '<form method="post" action="' . $this->url(array('view' => 'styles')) . '">'
            . $this->tokenField($data)
            . '<input type="hidden" name="action" value="styles.save" />'
            . '<h3>Palette</h3><div class="ch247b-grid">' . $colors . '</div>'
            . '<h3>Typography</h3><div class="ch247b-grid">' . $fonts . '</div>'
            . '<h3>Layout</h3><div class="ch247b-grid">' . $sizes . '</div>'
            . '<button class="ch247b-btn ch247b-btn--primary" type="submit">Save global styles</button>'
            . '<p class="ch247b-dim">Values that are not valid colours, font stacks or lengths are rejected rather than stored.</p>'
            . '</form></section>';
    }

    /* ---------------------------------------------------------------- media */

    private function media(array $data)
    {
        $tiles = '';
        foreach ($data['media']['rows'] as $item) {
            $preview = $item['is_image']
                ? '<img src="' . $this->e($item['url_path']) . '" alt="' . $this->e($item['alt_text']) . '" loading="lazy" />'
                : '<span class="ch247b-filetype">' . $this->e(strtoupper($item['extension'])) . '</span>';
            $categories = '';
            foreach ($data['categories'] as $category) {
                $categories .= '<option value="' . $this->e($category) . '"' . ($item['category'] === $category ? ' selected="selected"' : '') . '>'
                    . $this->e($category) . '</option>';
            }
            $tiles .= '<div class="ch247b-tile ch247b-tile--media">' . $preview
                . '<p><strong>' . $this->e($item['file_name']) . '</strong></p>'
                . '<p class="ch247b-dim">' . $this->e($item['mime']) . ' &middot; ' . $this->bytes($item['size_bytes'])
                . ($item['width'] > 0 ? ' &middot; ' . (int) $item['width'] . '&times;' . (int) $item['height'] : '') . '</p>'
                . '<form method="post" action="' . $this->url(array('view' => 'media')) . '">'
                . $this->tokenField($data)
                . '<input type="hidden" name="action" value="media.update" />'
                . '<input type="hidden" name="media_id" value="' . (int) $item['id'] . '" />'
                . '<input type="text" name="alt_text" value="' . $this->e($item['alt_text']) . '" placeholder="Alt text" maxlength="250" />'
                . '<select name="category">' . $categories . '</select>'
                . '<button class="ch247b-btn ch247b-btn--sm" type="submit">Save</button></form>'
                . $this->inlineForm($data, 'media.delete', array('media_id' => $item['id']), 'Delete', 'ch247b-btn--sm ch247b-btn--danger')
                . '</div>';
        }

        $upload = '';
        if ($this->can($data, 'builder.media')) {
            $upload = '<section class="ch247b-panel"><h2>Upload</h2>'
                . ($data['storage_ready'] ? '' : '<div class="ch247b-alert ch247b-alert--error">The media directory is not writable: '
                    . $this->e($data['storage_path']) . '</div>')
                . '<form method="post" action="' . $this->url(array('view' => 'media')) . '" enctype="multipart/form-data">'
                . $this->tokenField($data)
                . '<input type="hidden" name="action" value="media.upload" />'
                . '<div class="ch247b-grid">'
                . $this->field('File', '<input type="file" name="file" required />',
                    'Allowed: ' . $this->e(implode(', ', $data['allowed'])) . '. Maximum ' . $this->bytes($data['max_bytes']) . '.')
                . $this->field('Alt text', '<input type="text" name="alt_text" maxlength="250" />',
                    'Describes the image for screen readers and search engines.')
                . '</div>'
                . '<button class="ch247b-btn ch247b-btn--primary" type="submit">Upload</button>'
                . '<p class="ch247b-dim">Files are checked by extension, MIME type and leading bytes, renamed by the server, '
                . 'and stored in a directory where script execution is disabled. SVG is refused because it can carry script.</p>'
                . '</form></section>';
        }

        return '<section class="ch247b-panel"><h2>Media library</h2>'
            . '<p class="ch247b-dim">' . (int) $data['media']['total'] . ' item(s), ' . $this->bytes($data['total_bytes'])
            . ' stored in ' . $this->e($data['storage_path']) . '</p>'
            . ($tiles === '' ? '<p class="ch247b-empty">Nothing uploaded yet.</p>' : '<div class="ch247b-tiles">' . $tiles . '</div>')
            . '</section>' . $upload;
    }

    /* ---------------------------------------------------------------- forms */

    private function forms(array $data)
    {
        $rows = '';
        foreach ($data['forms'] as $form) {
            $rows .= '<tr><td><strong>' . $this->e($form['name']) . '</strong><br /><span class="ch247b-dim">' . $this->e($form['form_key']) . '</span></td>'
                . '<td>' . count($form['fields']) . '</td>'
                . '<td>' . ($form['enabled'] ? 'accepting submissions' : 'disabled') . '</td>'
                . '<td>' . (int) $form['submission_count'] . '</td>'
                . '<td class="ch247b-actions">'
                . '<a class="ch247b-btn ch247b-btn--sm" href="' . $this->url(array('view' => 'submissions', 'id' => $form['id'])) . '">Submissions</a> '
                . $this->inlineForm($data, 'form.toggle', array('form_id' => $form['id'], 'enabled' => $form['enabled'] ? 0 : 1),
                    $form['enabled'] ? 'Disable' : 'Enable', 'ch247b-btn--sm') . ' '
                . $this->inlineForm($data, 'form.delete', array('form_id' => $form['id']), 'Delete', 'ch247b-btn--sm ch247b-btn--danger')
                . '</td></tr>';
        }

        $defaults = array(
            array('name' => 'full_name', 'label' => 'Full name', 'type' => 'text', 'required' => true),
            array('name' => 'email', 'label' => 'Email address', 'type' => 'email', 'required' => true),
            array('name' => 'message', 'label' => 'Message', 'type' => 'textarea', 'required' => true),
            array('name' => '', 'label' => '', 'type' => 'text', 'required' => false),
            array('name' => '', 'label' => '', 'type' => 'text', 'required' => false),
        );
        $fieldRows = '';
        foreach ($defaults as $index => $field) {
            $types = '';
            foreach ($data['field_types'] as $type) {
                $types .= '<option value="' . $this->e($type) . '"' . ($field['type'] === $type ? ' selected="selected"' : '') . '>'
                    . $this->e($type) . '</option>';
            }
            $fieldRows .= '<tr>'
                . '<td><input type="text" name="field_name[' . $index . ']" value="' . $this->e($field['name']) . '" placeholder="field_name" /></td>'
                . '<td><input type="text" name="field_label[' . $index . ']" value="' . $this->e($field['label']) . '" /></td>'
                . '<td><select name="field_type[' . $index . ']">' . $types . '</select></td>'
                . '<td><input type="checkbox" name="field_required[' . $index . ']" value="1"' . ($field['required'] ? ' checked="checked"' : '') . ' /></td>'
                . '<td><input type="text" name="field_placeholder[' . $index . ']" /></td>'
                . '<td><input type="text" name="field_options[' . $index . ']" placeholder="A|B|C" /></td>'
                . '</tr>';
        }

        $departments = '<option value="0">Do not open a ticket</option>';
        foreach ($data['departments'] as $id => $name) {
            $departments .= '<option value="' . (int) $id . '">' . $this->e($name) . '</option>';
        }

        return '<section class="ch247b-panel"><h2>Forms</h2>'
            . ($rows === '' ? '<p class="ch247b-empty">No forms yet.</p>'
                : '<table class="ch247b-table"><thead><tr><th>Form</th><th>Fields</th><th>State</th><th>Submissions</th><th>Actions</th></tr></thead><tbody>' . $rows . '</tbody></table>')
            . '<p class="ch247b-dim">Submissions are always stored here first, then optionally opened as a ticket or emailed. '
            . 'Mail transport uses WHMCS, so no SMTP credentials are stored by the builder.</p></section>'
            . '<section class="ch247b-panel"><h2>Create a form</h2>'
            . '<form method="post" action="' . $this->url(array('view' => 'forms')) . '">'
            . $this->tokenField($data)
            . '<input type="hidden" name="action" value="form.save" />'
            . '<div class="ch247b-grid">'
            . $this->field('Name', '<input type="text" name="name" required maxlength="160" placeholder="Contact us" />')
            . $this->field('Key', '<input type="text" name="form_key" required maxlength="64" placeholder="contact-us" />')
            . '</div>'
            . '<table class="ch247b-table"><thead><tr><th>Name</th><th>Label</th><th>Type</th><th>Required</th><th>Placeholder</th><th>Choices (A|B|C)</th></tr></thead><tbody>'
            . $fieldRows . '</tbody></table>'
            . '<div class="ch247b-grid">'
            . $this->field('Confirmation message', '<input type="text" name="settings[success_message]" value="Thank you. Your message has been received." maxlength="300" />')
            . $this->field('Redirect after submit', '<input type="text" name="settings[redirect_url]" placeholder="optional" maxlength="300" />')
            . $this->field('Notify admins by email', '<input type="text" name="settings[notify_email]" placeholder="ops@example.com" maxlength="160" />',
                'Sent through the WHMCS mail system.')
            . $this->field('Open a ticket in', '<select name="settings[ticket_department]">' . $departments . '</select>')
            . '</div>'
            . '<label class="ch247b-check"><input type="checkbox" name="settings[create_ticket]" value="1" /> Open a support ticket for each submission</label>'
            . '<label class="ch247b-check"><input type="checkbox" name="settings[link_client]" value="1" checked="checked" /> Link submissions to an existing client when the email matches</label>'
            . '<label class="ch247b-check"><input type="checkbox" name="enabled" value="1" checked="checked" /> Accept submissions immediately</label>'
            . '<button class="ch247b-btn ch247b-btn--primary" type="submit">Save form</button>'
            . '</form></section>';
    }

    private function submissions(array $data)
    {
        $rows = '';
        foreach ($data['submissions']['rows'] as $submission) {
            $values = '';
            foreach ($submission['payload'] as $key => $value) {
                $values .= '<div><span class="ch247b-dim">' . $this->e($key) . ':</span> ' . $this->e($value) . '</div>';
            }
            $rows .= '<tr><td class="ch247b-dim">#' . (int) $submission['id'] . '<br />' . $this->e($submission['created_at']) . '</td>'
                . '<td>' . $values . '</td>'
                . '<td>' . $this->e($submission['status'])
                . ($submission['ticket_id'] > 0 ? '<br /><a href="supporttickets.php?action=view&amp;id=' . (int) $submission['ticket_id'] . '">Ticket #' . (int) $submission['ticket_id'] . '</a>' : '')
                . ($submission['client_id'] > 0 ? '<br /><a href="clientssummary.php?userid=' . (int) $submission['client_id'] . '">Client #' . (int) $submission['client_id'] . '</a>' : '')
                . '<br /><span class="ch247b-dim">' . $this->e($submission['notify_result']) . '</span></td></tr>';
        }
        return '<section class="ch247b-panel"><h2>Submissions'
            . (!empty($data['form']) ? ': ' . $this->e($data['form']['name']) : '') . '</h2>'
            . ($rows === '' ? '<p class="ch247b-empty">No submissions yet.</p>'
                : '<table class="ch247b-table"><thead><tr><th>When</th><th>Values</th><th>Outcome</th></tr></thead><tbody>' . $rows . '</tbody></table>')
            . '<p class="ch247b-dim">' . (int) $data['submissions']['total']
            . ' stored submission(s). Visitor IP addresses are stored only as a salted hash.</p></section>';
    }

    /* ------------------------------------------------------- seo, css, etc. */

    private function seo(array $data)
    {
        $settings = $data['settings'];
        $robots = '';
        foreach ($data['robots'] as $value) {
            $robots .= '<option value="' . $this->e($value) . '"' . ($settings['seo_default_robots'] === $value ? ' selected="selected"' : '') . '>'
                . $this->e($value) . '</option>';
        }
        return '<section class="ch247b-panel"><h2>SEO defaults</h2>'
            . '<form method="post" action="' . $this->url(array('view' => 'seo')) . '">'
            . $this->tokenField($data)
            . '<input type="hidden" name="action" value="seo.save" />'
            . '<div class="ch247b-grid">'
            . $this->field('Title suffix', '<input type="text" name="seo_title_suffix" value="' . $this->e($settings['seo_title_suffix']) . '" maxlength="120" />',
                'Appended to page titles that do not already contain it.')
            . $this->field('Default robots', '<select name="seo_default_robots">' . $robots . '</select>')
            . $this->field('Social share image', '<input type="text" name="social_image_url" value="' . $this->e($settings['social_image_url']) . '" maxlength="300" />')
            . '</div>'
            . $this->field('Default meta description', '<textarea name="seo_default_description" rows="3" maxlength="300">'
                . $this->e($settings['seo_default_description']) . '</textarea>', 'Used when a page has none of its own.')
            . '<button class="ch247b-btn ch247b-btn--primary" type="submit">Save SEO defaults</button>'
            . '</form></section>';
    }

    private function css(array $data)
    {
        return '<section class="ch247b-panel"><h2>Custom CSS</h2>'
            . '<p>Applied to builder pages only. This is a restricted capability: the CSS is validated before it is stored, and '
            . '<code>@import</code>, <code>expression()</code>, <code>behavior:</code>, <code>javascript:</code> URLs, remote '
            . '<code>url()</code> references and anything that could close the style element are rejected outright.</p>'
            . '<form method="post" action="' . $this->url(array('view' => 'css')) . '">'
            . $this->tokenField($data)
            . '<input type="hidden" name="action" value="css.save" />'
            . '<textarea class="ch247b-code" name="custom_css" rows="18" maxlength="' . (int) $data['max_length'] . '">'
            . $this->e($data['custom_css']) . '</textarea>'
            . '<button class="ch247b-btn ch247b-btn--primary" type="submit">Validate and save</button>'
            . '</form></section>';
    }

    private function settings(array $data)
    {
        $settings = $data['settings'];
        $capabilities = '';
        foreach ($data['capability_labels'] as $capability => $label) {
            $roles = isset($data['policy'][$capability]) ? $data['policy'][$capability] : array();
            $capabilities .= '<li><span>' . $this->e($label) . '</span><strong>'
                . ($roles ? 'roles ' . $this->e(implode(', ', $roles)) : 'no policy row: standard WHMCS addon access')
                . '</strong><em>' . $this->e($capability)
                . (in_array($capability, CapabilityPolicy::PRIVILEGED, true) ? ' (privileged)' : '') . '</em></li>';
        }
        return '<section class="ch247b-panel"><h2>Builder settings</h2>'
            . '<form method="post" action="' . $this->url(array('view' => 'settings')) . '">'
            . $this->tokenField($data)
            . '<input type="hidden" name="action" value="settings.save" />'
            . '<div class="ch247b-grid">'
            . $this->field('Site title', '<input type="text" name="site_title" value="' . $this->e($settings['site_title']) . '" maxlength="120" />')
            . $this->field('Revisions kept per page', '<input type="number" name="revision_limit" value="' . (int) $settings['revision_limit'] . '" min="5" max="200" />',
                'Published snapshots are always kept.')
            . $this->field('Autosave interval (seconds)', '<input type="number" name="autosave_seconds" value="' . (int) $settings['autosave_seconds'] . '" min="15" max="600" />')
            . $this->field('Preview link lifetime (minutes)', '<input type="number" name="preview_ttl_minutes" value="' . (int) $settings['preview_ttl_minutes'] . '" min="5" max="1440" />')
            . $this->field('Maximum upload size (MiB)', '<input type="number" name="media_max_mib" value="' . (int) $settings['media_max_mib'] . '" min="1" max="256" />')
            . $this->field('Form submissions per 5 minutes', '<input type="number" name="form_rate_limit" value="' . (int) $settings['form_rate_limit'] . '" min="1" max="60" />')
            . $this->field('Public page path', '<input type="text" name="public_base_path" value="' . $this->e($settings['public_base_path']) . '" maxlength="120" />',
                'The front controller that serves builder pages.')
            . '</div>'
            . '<button class="ch247b-btn ch247b-btn--primary" type="submit">Save settings</button>'
            . '</form></section>'
            . '<section class="ch247b-panel"><h2>Who can do what</h2>'
            . '<p>Capabilities are enforced server-side on every action. Edit the role assignments under CloudHost247 Foundation.</p>'
            . '<ul class="ch247b-facts">' . $capabilities . '</ul></section>';
    }

    private function activity(array $data)
    {
        $rows = '';
        foreach ($data['activity']['rows'] as $event) {
            $rows .= '<tr><td class="ch247b-dim">' . $this->e($event['created_at']) . '</td>'
                . '<td>' . $this->e($event['event_type']) . '</td>'
                . '<td>' . $this->e($event['summary']) . '</td>'
                . '<td class="ch247b-dim">admin #' . (int) $event['admin_id'] . '</td>'
                . '<td>' . $this->e($event['result']) . '</td></tr>';
        }
        return '<section class="ch247b-panel"><h2>Activity</h2>'
            . '<p class="ch247b-dim">Recorded for every builder change. Values that look like credentials are dropped before writing, '
            . 'and visitor addresses are stored only as a salted hash.</p>'
            . ($rows === '' ? '<p class="ch247b-empty">Nothing recorded yet.</p>'
                : '<table class="ch247b-table"><thead><tr><th>When</th><th>Event</th><th>Detail</th><th>By</th><th>Result</th></tr></thead><tbody>'
                . $rows . '</tbody></table>')
            . '</section>';
    }

    /* --------------------------------------------------------------- editor */

    private function editor(array $data)
    {
        if (!empty($data['error'])) {
            return '<div class="ch247b"><div class="ch247b-alert ch247b-alert--error">' . $this->e($data['error']) . '</div>'
                . '<p><a class="ch247b-btn" href="' . $this->url(array('view' => 'pages')) . '">Back to pages</a></p></div>';
        }
        $page = isset($data['page']) ? $data['page'] : null;
        $part = isset($data['part']) ? $data['part'] : null;
        $config = array(
            'api' => isset($data['api_base']) ? $data['api_base'] : '',
            'token' => isset($data['token']) ? $data['token'] : '',
            'pageId' => $page ? (int) $page['id'] : 0,
            'partId' => $part ? (int) $part['id'] : 0,
            'title' => $page ? $page['title'] : ($part ? $part['name'] : ''),
            'backUrl' => $this->url(array('view' => $part ? 'theme' : 'pages')),
            'settingsUrl' => $page ? $this->url(array('view' => 'page', 'id' => $page['id'])) : '',
            'kind' => $part ? 'part' : 'page',
        );
        $json = json_encode($config, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);

        return '<link rel="stylesheet" href="' . $this->url(array('asset' => 'editor.css')) . '" />'
            . '<link rel="stylesheet" href="' . $this->url(array('asset' => 'runtime.css')) . '" />'
            . '<div id="ch247-editor" class="ch247-editor" data-config="' . $this->e($json) . '">'
            . '<div class="ch247-editor__boot">Loading the editor&hellip;</div></div>'
            . '<script src="' . $this->url(array('asset' => 'editor.js')) . '" defer></script>';
    }

    private function denied(array $data)
    {
        return '<link rel="stylesheet" href="' . $this->url(array('asset' => 'admin.css')) . '" />'
            . '<div class="ch247b"><div class="ch247b-alert ch247b-alert--error"><strong>Access denied.</strong> '
            . $this->e(isset($data['error']) ? $data['error'] : 'You do not have permission to use the Website Builder.')
            . '</div><p class="ch247b-dim">Capabilities are managed under CloudHost247 Foundation. Publishing, deletion, settings '
            . 'and custom CSS default to Super Admin roles only.</p></div>';
    }

    /* --------------------------------------------------------------- helpers */

    private function statusBadge(array $page)
    {
        $status = $page['status'];
        $label = $status;
        if ($status === 'scheduled' && $page['publish_at'] !== '') { $label .= ' for ' . $page['publish_at']; }
        if ($status === 'published' && $page['has_unpublished_changes']) { $label .= ' (draft differs)'; }
        return '<span class="ch247b-status ch247b-status--' . $this->e($status) . '">' . $this->e($label) . '</span>';
    }

    private function field($label, $control, $note = '')
    {
        return '<label class="ch247b-field"><span class="ch247b-field__label">' . $label . '</span>' . $control
            . ($note !== '' ? '<small class="ch247b-field__note">' . $note . '</small>' : '') . '</label>';
    }

    private function select($name, array $options, $current)
    {
        $html = '<select name="' . $this->e($name) . '">';
        foreach ($options as $value => $label) {
            $html .= '<option value="' . $this->e($value) . '"' . ((string) $current === (string) $value ? ' selected="selected"' : '') . '>'
                . $this->e($label) . '</option>';
        }
        return $html . '</select>';
    }

    private function inlineForm(array $data, $action, array $fields, $label, $class)
    {
        $inputs = '';
        foreach ($fields as $name => $value) {
            $inputs .= '<input type="hidden" name="' . $this->e($name) . '" value="' . $this->e($value) . '" />';
        }
        return '<form class="ch247b-inline" method="post" action="'
            . $this->url(array('view' => isset($data['view']) ? $data['view'] : 'pages')) . '">'
            . $this->tokenField($data)
            . '<input type="hidden" name="action" value="' . $this->e($action) . '" />' . $inputs
            . '<button class="ch247b-btn ' . $this->e($class) . '" type="submit">' . $this->e($label) . '</button></form>';
    }

    private function tokenField(array $data)
    {
        return '<input type="hidden" name="token" value="' . $this->e(isset($data['token']) ? $data['token'] : '') . '" />';
    }

    private function can(array $data, $capability)
    {
        return !isset($data['capabilities'][$capability]) || $data['capabilities'][$capability];
    }

    private function url(array $params)
    {
        $url = $this->link;
        foreach ($params as $key => $value) {
            $url .= '&amp;' . rawurlencode($key) . '=' . rawurlencode((string) $value);
        }
        return $url;
    }

    private function bytes($bytes)
    {
        $bytes = (int) $bytes;
        if ($bytes >= 1048576) { return round($bytes / 1048576, 1) . ' MiB'; }
        if ($bytes >= 1024) { return round($bytes / 1024) . ' KiB'; }
        return $bytes . ' B';
    }

    private function e($value)
    {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    }
}
