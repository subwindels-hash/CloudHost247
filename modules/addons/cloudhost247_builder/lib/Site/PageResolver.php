<?php
namespace CloudHost247\Builder\Site;

use CloudHost247\Builder\Catalog\WhmcsDataSource;
use CloudHost247\Builder\Contracts\LiveDataSource;
use CloudHost247\Builder\Render\RenderContext;
use CloudHost247\Builder\Render\Renderer;
use CloudHost247\Builder\Repositories\MediaRepository;
use CloudHost247\Builder\Repositories\PageRepository;
use CloudHost247\Builder\Services\FormService;
use CloudHost247\Builder\Services\MenuService;
use CloudHost247\Builder\Services\PageService;
use CloudHost247\Builder\Services\Settings;
use CloudHost247\Builder\Services\ThemeService;
use CloudHost247\Builder\Support\CssSanitizer;
use CloudHost247\Builder\Support\Slug;

/**
 * Turns a public request into a rendered page.
 *
 * This is the gate between the builder and the internet, and it is deliberately
 * strict about what may be served:
 *
 *   - only the published copy is ever rendered for a visitor;
 *   - a draft is reachable only with a valid, unexpired preview token, and is
 *     always marked noindex;
 *   - a scheduled page stays unavailable until its moment arrives, even though
 *     its content is already stored;
 *   - client-only and admin-only pages check the real WHMCS session.
 *
 * Anything else is an honest 404. There is no code path that renders draft
 * content to an anonymous visitor.
 */
class PageResolver
{
    const STATUS_OK = 200;
    const STATUS_FORBIDDEN = 403;
    const STATUS_NOT_FOUND = 404;

    private $pages;
    private $theme;
    private $settings;
    private $renderer;
    private $data;
    private $menus;
    private $forms;
    private $media;

    public function __construct(
        PageService $pages = null,
        ThemeService $theme = null,
        Settings $settings = null,
        Renderer $renderer = null,
        LiveDataSource $data = null,
        MenuService $menus = null,
        FormService $forms = null,
        MediaRepository $media = null
    ) {
        $this->media = $media ? $media : new MediaRepository();
        $this->settings = $settings ? $settings : new Settings();
        $this->pages = $pages ? $pages : new PageService();
        $this->theme = $theme ? $theme : new ThemeService();
        $this->renderer = $renderer ? $renderer : new Renderer(null, $this->settings->compiler());
        $this->data = $data ? $data : new WhmcsDataSource();
        $this->menus = $menus ? $menus : new MenuService();
        $this->forms = $forms ? $forms : new FormService();
    }

    /**
     * @param array $options array('preview' => token, 'session' => array('client_id','admin_id'), 'form_result' => array)
     * @return array
     */
    public function resolve($slug, array $options = array())
    {
        $slug = (string) $slug;
        if ($slug === '' || !Slug::isValid($slug)) {
            return $this->notFound('No page address was supplied.');
        }
        $page = $this->pages->repository()->findBySlug($slug);
        if (!$page) {
            return $this->notFound('No page is published at that address.');
        }

        $previewToken = isset($options['preview']) ? (string) $options['preview'] : '';
        $isPreview = $previewToken !== '' && $this->pages->repository()->verifyPreviewToken($page['id'], $previewToken);

        if (!$isPreview) {
            $live = $this->isLive($page);
            if ($live !== true) { return $this->notFound($live); }
        }

        $access = $this->checkVisibility($page, isset($options['session']) ? $options['session'] : array());
        if ($access !== true) { return $access; }

        $document = $isPreview ? $this->pages->draft($page) : $this->pages->published($page);
        if ($document->isEmpty() && !$isPreview) {
            return $this->notFound('That page has no published content.');
        }

        $context = $this->context($page, $isPreview, $options);
        $rendered = $this->renderer->render($document, $context);

        $partsHtml = array('header' => '', 'footer' => '');
        $partsCss = '';
        $conditionContext = array(
            'page_id' => $page['id'],
            'slug' => $page['slug'],
            'page_type' => 'page',
            'is_front_page' => !empty($page['is_home']),
        );
        foreach (array('header', 'footer') as $type) {
            $choice = $type === 'header' ? $page['header_part'] : $page['footer_part'];
            if ($choice === 'none') { continue; }
            $part = $choice !== '' && $choice !== 'inherit'
                ? $this->partByKey($choice)
                : $this->theme->resolve($type, $conditionContext);
            if (!$part || $part['status'] !== 'published') { continue; }
            $partDocument = $this->theme->published($part);
            if ($partDocument->isEmpty()) { continue; }
            $partRender = $this->renderer->render($partDocument, $context);
            $partsHtml[$type] = $partRender['html'];
            $partsCss .= $partRender['css'];
        }

        $compiler = $this->settings->compiler();
        $css = $compiler->rootCss('.ch247-root') . $partsCss . $rendered['css'];
        $customCss = (string) $this->settings->get('custom_css', '');
        if (trim($customCss) !== '') { $css .= CssSanitizer::forStyleElement($customCss); }

        return array(
            'found' => true,
            'status' => self::STATUS_OK,
            'preview' => $isPreview,
            'page' => $page,
            'html' => $rendered['html'],
            'header_html' => $partsHtml['header'],
            'footer_html' => $partsHtml['footer'],
            'css' => $css,
            'meta' => $this->meta($page, $isPreview),
            'form_result' => isset($options['form_result']) ? $options['form_result'] : null,
            'reason' => '',
        );
    }

    /** Render context shared by the page and its theme parts. */
    private function context(array $page, $isPreview, array $options)
    {
        $forms = $this->forms;
        $settings = $this->settings;
        return new RenderContext(
            $isPreview ? RenderContext::MODE_PREVIEW : RenderContext::MODE_PUBLISH,
            $this->data,
            array(
                'menus' => $this->menus->resolver(),
                'forms' => function ($id) use ($forms) { return $forms->publicDefinition($id); },
                'form_token' => function ($id) use ($forms) { return $forms->issueToken($id); },
                'form_action' => $settings->get('public_base_path', 'builder-page.php') . '?slug=' . rawurlencode($page['slug']),
                'page' => $page,
            )
        );
    }

    private function partByKey($key)
    {
        $part = $this->theme->all();
        foreach ($part as $candidate) {
            if ($candidate['part_key'] === $key) { return $candidate; }
        }
        return null;
    }

    /** @return true|string true when the page may be served publicly */
    private function isLive(array $page)
    {
        if ($page['status'] === 'draft') { return 'That page is a draft and is not published.'; }
        if ($page['status'] === 'archived') { return 'That page has been archived.'; }
        if ($page['status'] === 'scheduled') {
            $when = $page['publish_at'] !== '' ? strtotime($page['publish_at']) : 0;
            if (!$when || $when > time()) { return 'That page is scheduled and is not published yet.'; }
        }
        if (trim((string) $page['published_json']) === '') { return 'That page has no published content.'; }
        return true;
    }

    private function checkVisibility(array $page, array $session)
    {
        if ($page['visibility'] === 'public') { return true; }
        $clientId = isset($session['client_id']) ? (int) $session['client_id'] : (int) (isset($_SESSION['uid']) ? $_SESSION['uid'] : 0);
        $adminId = isset($session['admin_id']) ? (int) $session['admin_id'] : (int) (isset($_SESSION['adminid']) ? $_SESSION['adminid'] : 0);
        if ($page['visibility'] === 'clients' && $clientId <= 0 && $adminId <= 0) {
            return array(
                'found' => false, 'status' => self::STATUS_FORBIDDEN, 'preview' => false, 'page' => $page,
                'html' => '', 'header_html' => '', 'footer_html' => '', 'css' => '',
                'meta' => array('title' => 'Sign in required', 'robots' => 'noindex,nofollow', 'description' => '',
                    'canonical' => '', 'og_image' => ''),
                'reason' => 'This page is available to signed-in customers.',
                'login_url' => 'clientarea.php',
            );
        }
        if ($page['visibility'] === 'admins' && $adminId <= 0) {
            return $this->notFound('No page is published at that address.');
        }
        return true;
    }

    private function meta(array $page, $isPreview)
    {
        $image = $this->socialImage($page);
        $suffix = (string) $this->settings->get('seo_title_suffix', '');
        $title = $page['seo_title'] !== '' ? $page['seo_title'] : $page['title'];
        $description = $page['meta_description'] !== ''
            ? $page['meta_description']
            : (string) $this->settings->get('seo_default_description', '');
        return array(
            'title' => $title . ($suffix !== '' && strpos($title, trim($suffix)) === false ? $suffix : ''),
            'description' => $description,
            // A preview is never indexable, whatever the page says.
            'robots' => $isPreview ? 'noindex,nofollow' : ($page['meta_robots'] !== '' ? $page['meta_robots'] : 'index,follow'),
            'canonical' => $isPreview ? '' : $page['canonical_url'],
            'og_image' => $image['url'],
            'og_image_alt' => $image['alt'],
            'site_name' => (string) $this->settings->get('site_title', ''),
        );
    }

    /**
     * Social-sharing image for a page: its own social image, then its featured image, then
     * the site-wide default. Only stored image media qualifies; anything else is skipped
     * rather than emitted as a broken tag.
     *
     * @return array{url:string,alt:string}
     */
    private function socialImage(array $page)
    {
        foreach (array('og_media_id', 'featured_media_id') as $field) {
            $id = isset($page[$field]) ? (int) $page[$field] : 0;
            if ($id <= 0) { continue; }
            try {
                $media = $this->media->find($id);
            } catch (\Throwable $unavailable) {
                $media = null;
            }
            if ($media && !empty($media['is_image']) && $media['url_path'] !== '') {
                return array('url' => (string) $media['url_path'], 'alt' => (string) $media['alt_text']);
            }
        }
        return array('url' => (string) $this->settings->get('social_image_url', ''), 'alt' => '');
    }

    private function notFound($reason)
    {
        return array(
            'found' => false,
            'status' => self::STATUS_NOT_FOUND,
            'preview' => false,
            'page' => null,
            'html' => '',
            'header_html' => '',
            'footer_html' => '',
            'css' => '',
            'meta' => array('title' => 'Page not found', 'description' => '', 'robots' => 'noindex,nofollow',
                'canonical' => '', 'og_image' => ''),
            'reason' => $reason,
        );
    }

    /** Status counts for the admin dashboard. */
    public function repository() { return $this->pages->repository(); }

    public function statuses() { return PageRepository::STATUSES; }
}
