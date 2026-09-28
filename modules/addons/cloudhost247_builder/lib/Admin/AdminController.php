<?php
namespace CloudHost247\Builder\Admin;

use CloudHost247\Builder\Catalog\WhmcsDataSource;
use CloudHost247\Builder\Render\Renderer;
use CloudHost247\Builder\Repositories\EventRepository;
use CloudHost247\Builder\Repositories\LibraryRepository;
use CloudHost247\Builder\Schema\Document;
use CloudHost247\Builder\Schema\SchemaValidator;
use CloudHost247\Builder\Security\CapabilityPolicy;
use CloudHost247\Builder\Services\DisplayConditions;
use CloudHost247\Builder\Services\FormService;
use CloudHost247\Builder\Services\MediaService;
use CloudHost247\Builder\Services\MenuService;
use CloudHost247\Builder\Services\PageService;
use CloudHost247\Builder\Services\Settings;
use CloudHost247\Builder\Services\Starters;
use CloudHost247\Builder\Services\TemplateService;
use CloudHost247\Builder\Services\ThemeService;
use CloudHost247\Builder\Support\BuilderException;
use CloudHost247\Builder\Support\Paths;
use CloudHost247\Builder\Widgets\WidgetCatalog;
use CloudHost247\Foundation\Security\AdminGuard;
use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Foundation\Support\SafeError;

/**
 * Admin routing for the Website Builder.
 *
 * Every request passes three gates before anything happens: an authenticated
 * WHMCS administrator, the capability for that specific action, and -- for
 * anything that writes -- a POST with a valid WHMCS CSRF token. Read-only
 * views need only the first two.
 *
 * The editor talks to the same controller over a small JSON API. It sends a
 * document and gets back rendered markup produced by the published renderer,
 * which is what makes the canvas a real preview rather than a lookalike.
 */
class AdminController
{
    const MODULE = 'cloudhost247_builder';

    /** view => capability required to open it. */
    const VIEW_CAPABILITIES = array(
        'dashboard' => 'builder.view',
        'pages' => 'builder.view',
        'page' => 'builder.pages',
        'editor' => 'builder.pages',
        'revisions' => 'builder.pages',
        'backups' => 'builder.pages',
        'templates' => 'builder.templates',
        'theme' => 'builder.theme',
        'headers' => 'builder.theme',
        'part' => 'builder.theme',
        'menus' => 'builder.theme',
        'styles' => 'builder.settings',
        'media' => 'builder.media',
        'forms' => 'builder.forms',
        'submissions' => 'builder.forms',
        'seo' => 'builder.settings',
        'css' => 'builder.css',
        'settings' => 'builder.settings',
        'activity' => 'builder.view',
    );

    /** action => capability required to perform it. */
    const ACTION_CAPABILITIES = array(
        'page.create' => 'builder.pages', 'page.meta' => 'builder.pages', 'page.duplicate' => 'builder.pages',
        'page.publish' => 'builder.publish', 'page.unpublish' => 'builder.publish', 'page.schedule' => 'builder.publish',
        'page.home' => 'builder.publish', 'page.archive' => 'builder.delete', 'page.delete' => 'builder.delete',
        'page.restore' => 'builder.pages',
        'template.save' => 'builder.templates', 'template.delete' => 'builder.templates',
        'template.import' => 'builder.templates', 'template.export' => 'builder.templates',
        'part.create' => 'builder.theme', 'part.update' => 'builder.theme', 'part.publish' => 'builder.theme',
        'part.disable' => 'builder.theme', 'part.delete' => 'builder.theme',
        'menu.save' => 'builder.theme', 'menu.delete' => 'builder.theme',
        'media.upload' => 'builder.media', 'media.update' => 'builder.media', 'media.delete' => 'builder.media',
        'form.save' => 'builder.forms', 'form.delete' => 'builder.forms', 'form.toggle' => 'builder.forms',
        'settings.save' => 'builder.settings', 'styles.save' => 'builder.settings',
        'seo.save' => 'builder.settings', 'css.save' => 'builder.css',
    );

    /** Editor API operation => capability. */
    const API_CAPABILITIES = array(
        'state' => 'builder.pages', 'render' => 'builder.pages', 'save' => 'builder.pages',
        'autosave' => 'builder.pages', 'publish' => 'builder.publish', 'preview' => 'builder.pages',
        'media' => 'builder.media', 'upload' => 'builder.media', 'template.insert' => 'builder.pages',
        'template.save' => 'builder.templates', 'part.save' => 'builder.theme', 'part.publish' => 'builder.theme',
    );

    const ASSETS = array(
        'editor.js' => 'application/javascript; charset=utf-8',
        'editor.css' => 'text/css; charset=utf-8',
        'admin.css' => 'text/css; charset=utf-8',
        'runtime.css' => 'text/css; charset=utf-8',
        'runtime.js' => 'application/javascript; charset=utf-8',
    );

    private $link;
    private $pages;
    private $templates;
    private $theme;
    private $menus;
    private $media;
    private $forms;
    private $settings;
    private $events;
    private $library;
    private $catalog;
    private $validator;
    private $renderer;

    public function __construct($moduleLink = 'addonmodules.php?module=cloudhost247_builder', array $services = array())
    {
        $this->link = (string) $moduleLink;
        $this->settings = isset($services['settings']) ? $services['settings'] : new Settings();
        $this->library = isset($services['library']) ? $services['library'] : new LibraryRepository();
        $this->validator = isset($services['validator']) ? $services['validator'] : new SchemaValidator();
        $this->pages = isset($services['pages']) ? $services['pages'] : new PageService(null, null, $this->settings, $this->validator);
        $this->templates = isset($services['templates']) ? $services['templates'] : new TemplateService($this->library, null, $this->validator);
        $this->theme = isset($services['theme']) ? $services['theme'] : new ThemeService($this->library, null, $this->validator);
        $this->menus = isset($services['menus']) ? $services['menus'] : new MenuService($this->library);
        $this->media = isset($services['media']) ? $services['media'] : new MediaService(null, null, $this->settings);
        $this->forms = isset($services['forms']) ? $services['forms'] : new FormService(null, null, $this->settings, $this->library);
        $this->events = isset($services['events']) ? $services['events'] : new EventRepository();
        $this->catalog = isset($services['catalog']) ? $services['catalog'] : new WidgetCatalog();
        $this->renderer = isset($services['renderer']) ? $services['renderer'] : new Renderer($this->catalog, $this->settings->compiler());
    }

    /* --------------------------------------------------------------- routing */

    public function handle()
    {
        try {
            $adminId = AdminGuard::requireAdmin();
        } catch (\Throwable $denied) {
            return array('view' => 'denied', 'error' => 'An authenticated WHMCS administrator is required.', 'link' => $this->link);
        }

        $asset = isset($_GET['asset']) ? (string) $_GET['asset'] : '';
        if ($asset !== '') { return $this->serveAsset($asset); }

        if (!empty($_GET['ajax'])) { return $this->api($adminId); }

        $view = isset($_GET['view']) ? (string) $_GET['view'] : 'dashboard';
        if (!isset(self::VIEW_CAPABILITIES[$view])) { $view = 'dashboard'; }

        $notice = '';
        $error = '';
        $flash = array();

        if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
            $result = $this->dispatch((string) $_POST['action'], $adminId);
            $notice = $result['notice'];
            $error = $result['error'];
            $flash = $result['data'];
            if ($result['view'] !== '') { $view = $result['view']; }
        }

        try {
            AdminGuard::requireCapability(self::MODULE, self::VIEW_CAPABILITIES[$view]);
        } catch (\Throwable $denied) {
            return array(
                'view' => 'denied', 'link' => $this->link,
                'error' => 'Your administrator role does not have the "' . CapabilityPolicy::label(self::VIEW_CAPABILITIES[$view]) . '" capability.',
                'capabilities' => $this->capabilityMap(),
            );
        }

        $data = $this->viewData($view, $adminId);
        $data['view'] = $view;
        $data['link'] = $this->link;
        $data['notice'] = $notice;
        $data['error'] = $error;
        $data['flash'] = $flash;
        $data['token'] = function_exists('generate_token') ? generate_token('plain') : '';
        $data['capabilities'] = $this->capabilityMap();
        $data['counts'] = $this->pages->repository()->counts();
        return $data;
    }

    /* --------------------------------------------------------------- actions */

    private function dispatch($action, $adminId)
    {
        $result = array('notice' => '', 'error' => '', 'view' => '', 'data' => array());
        if (!isset(self::ACTION_CAPABILITIES[$action])) {
            $result['error'] = 'Unknown action.';
            return $result;
        }
        try {
            AdminGuard::requirePostToken();
            AdminGuard::requireCapability(self::MODULE, self::ACTION_CAPABILITIES[$action]);
            $result = array_merge($result, $this->perform($action, $adminId));
        } catch (BuilderException $expected) {
            $result['error'] = $expected->getMessage();
        } catch (\RuntimeException $denied) {
            $result['error'] = $denied->getMessage();
        } catch (\Throwable $unexpected) {
            $safe = SafeError::from($unexpected, self::MODULE, $action);
            $result['error'] = $safe['display'];
        }
        return $result;
    }

    private function perform($action, $adminId)
    {
        $post = $_POST;
        switch ($action) {
            case 'page.create':
                $document = null;
                $templateId = isset($post['template_id']) ? (int) $post['template_id'] : 0;
                if ($templateId > 0) {
                    $template = $this->templates->find($templateId);
                    if ($template) { $document = Document::fromJson($template['document_json'], $this->validator, false); }
                } elseif (!empty($post['start_blank'])) {
                    $document = Document::fromArray(array('children' => Starters::blankPage()), $this->validator, false);
                }
                $page = $this->pages->create($post, $adminId, $document);
                $this->audit('page.create', $page['id'], null, $page, $adminId);
                return array('notice' => 'Created "' . $page['title'] . '". Open the editor to design it.', 'view' => 'pages');

            case 'page.meta':
                $page = $this->pages->updateMeta((int) $post['page_id'], $post, $adminId);
                $this->audit('page.update', $page['id'], null, $page, $adminId);
                return array('notice' => 'Page settings saved.', 'view' => 'page');

            case 'page.duplicate':
                $page = $this->pages->duplicate((int) $post['page_id'], $adminId);
                return array('notice' => 'Duplicated as "' . $page['title'] . '".', 'view' => 'pages');

            case 'page.publish':
                $page = $this->pages->publish((int) $post['page_id'], $adminId);
                $this->audit('page.publish', $page['id'], null, array('slug' => $page['slug'], 'status' => $page['status']), $adminId);
                return array('notice' => 'Published. The page is live at ' . $this->pages->publicUrl($page) . '.', 'view' => 'pages');

            case 'page.unpublish':
                $page = $this->pages->unpublish((int) $post['page_id'], $adminId);
                $this->audit('page.unpublish', $page['id'], null, array('slug' => $page['slug']), $adminId);
                return array('notice' => 'Unpublished. The public URL now returns not found; the draft is untouched.', 'view' => 'pages');

            case 'page.schedule':
                $page = $this->pages->schedule((int) $post['page_id'], isset($post['publish_at']) ? $post['publish_at'] : '', $adminId);
                return array('notice' => 'Scheduled for ' . $page['publish_at'] . '. It stays unavailable until then.', 'view' => 'pages');

            case 'page.home':
                $page = $this->pages->setHome((int) $post['page_id'], $adminId);
                return array('notice' => '"' . $page['title'] . '" is now the builder front page.', 'view' => 'pages');

            case 'page.archive':
                $page = $this->pages->archive((int) $post['page_id'], $adminId);
                return array('notice' => 'Archived "' . $page['title'] . '". Its content is kept and can be restored.', 'view' => 'pages');

            case 'page.delete':
                $page = $this->pages->repository()->find((int) $post['page_id']);
                if (!$page) { throw BuilderException::notFound('That page no longer exists.'); }
                if (!isset($post['confirm_slug']) || (string) $post['confirm_slug'] !== $page['slug']) {
                    throw BuilderException::validation('Type the page address exactly to confirm deletion.');
                }
                $this->pages->delete((int) $post['page_id'], $adminId);
                $this->audit('page.delete', (int) $post['page_id'], $page, null, $adminId);
                return array('notice' => 'Deleted "' . $page['title'] . '" and its revision history.', 'view' => 'pages');

            case 'page.restore':
                $restored = $this->pages->restoreRevision((int) $post['page_id'], (int) $post['revision_id'], $adminId);
                return array(
                    'notice' => 'Restored revision #' . $restored['restored_revision']
                        . ' into the draft. The live page is unchanged until you publish.',
                    'view' => 'revisions',
                );

            case 'template.save':
                $page = $this->pages->repository()->find((int) $post['page_id']);
                if (!$page) { throw BuilderException::notFound('That page no longer exists.'); }
                $template = $this->templates->saveFromDocument($post, $this->pages->draft($page), $adminId);
                return array('notice' => 'Saved template "' . $template['name'] . '".', 'view' => 'templates');

            case 'template.delete':
                $this->templates->delete((int) $post['template_id'], $adminId);
                return array('notice' => 'Template deleted.', 'view' => 'templates');

            case 'template.import':
                $json = isset($post['package']) ? (string) $post['package'] : '';
                if ($json === '' && !empty($_FILES['package_file']['tmp_name'])) {
                    $uploaded = $_FILES['package_file'];
                    if ((int) $uploaded['size'] > TemplateService::MAX_PACKAGE_BYTES) {
                        throw BuilderException::import('That template package is too large.');
                    }
                    $json = (string) @file_get_contents($uploaded['tmp_name']);
                }
                if (!empty($post['inspect_only'])) {
                    $inspection = $this->templates->inspect($json);
                    return array(
                        'notice' => 'Package read successfully. Nothing has been imported yet.',
                        'view' => 'templates',
                        'data' => array('inspection' => $this->describeInspection($inspection), 'package' => $json),
                    );
                }
                $imported = $this->templates->import($json, $adminId);
                $warnings = $imported['inspection']['warnings'];
                return array(
                    'notice' => 'Imported "' . $imported['template']['name'] . '" with '
                        . $imported['inspection']['elements'] . ' element(s). '
                        . ($imported['inspection']['checksum_matches'] ? 'Checksum verified.' : 'Checksum not verified.')
                        . ($warnings ? ' ' . implode(' ', $warnings) : ''),
                    'view' => 'templates',
                );

            case 'template.export':
                $json = $this->templates->export((int) $post['template_id'], $adminId);
                return array(
                    'notice' => 'Export ready. Copy the package below.',
                    'view' => 'templates',
                    'data' => array('export' => $json),
                );

            case 'part.create':
                $part = $this->theme->create($post, $adminId);
                return array('notice' => 'Created theme part "' . $part['name'] . '". Open the editor to design it.', 'view' => 'theme');

            case 'part.update':
                $input = $post;
                $input['conditions'] = DisplayConditions::fromInput($post);
                $part = $this->theme->update((int) $post['part_id'], $input, $adminId);
                return array('notice' => 'Saved "' . $part['name'] . '". ' . DisplayConditions::describe($part['conditions']), 'view' => 'theme');

            case 'part.publish':
                $part = $this->theme->publish((int) $post['part_id'], $adminId);
                return array('notice' => 'Published "' . $part['name'] . '". ' . DisplayConditions::describe($part['conditions']), 'view' => 'theme');

            case 'part.disable':
                $part = $this->theme->disable((int) $post['part_id'], $adminId);
                return array('notice' => 'Disabled "' . $part['name'] . '". It no longer appears anywhere.', 'view' => 'theme');

            case 'part.delete':
                $this->theme->delete((int) $post['part_id'], $adminId);
                return array('notice' => 'Theme part deleted.', 'view' => 'theme');

            case 'menu.save':
                $menu = $this->menus->save(array(
                    'menu_key' => isset($post['menu_key']) ? $post['menu_key'] : '',
                    'name' => isset($post['name']) ? $post['name'] : '',
                    'items' => $this->menuItemsFromInput($post),
                ), $adminId);
                return array('notice' => 'Saved menu "' . $menu['name'] . '" with ' . count($menu['items']) . ' item(s).', 'view' => 'menus');

            case 'menu.delete':
                $this->menus->delete((int) $post['menu_id'], $adminId);
                return array('notice' => 'Menu deleted.', 'view' => 'menus');

            case 'media.upload':
                if (empty($_FILES['file'])) { throw BuilderException::upload('Choose a file to upload.'); }
                $uploaded = $this->media->upload($_FILES['file'], $adminId, $_POST);
                return array(
                    'notice' => $uploaded['duplicate']
                        ? 'That file is already in the library as ' . $uploaded['media']['file_name'] . '; the existing copy was reused.'
                        : 'Uploaded ' . $uploaded['media']['file_name'] . '.',
                    'view' => 'media',
                );

            case 'media.update':
                $item = $this->media->updateMeta((int) $post['media_id'], $post, $adminId);
                return array('notice' => 'Updated ' . $item['file_name'] . '.', 'view' => 'media');

            case 'media.delete':
                $outcome = $this->media->delete((int) $post['media_id'], $adminId);
                $used = count($outcome['usage']);
                return array(
                    'notice' => 'Media deleted.' . ($used > 0
                        ? ' Note: it was referenced by ' . $used . ' page(s); those blocks will now show no image.' : ''),
                    'view' => 'media',
                );

            case 'form.save':
                $form = $this->forms->save(array(
                    'form_key' => isset($post['form_key']) ? $post['form_key'] : '',
                    'name' => isset($post['name']) ? $post['name'] : '',
                    'enabled' => !empty($post['enabled']),
                    'fields' => $this->formFieldsFromInput($post),
                    'settings' => isset($post['settings']) && is_array($post['settings']) ? $post['settings'] : array(),
                ), $adminId);
                return array('notice' => 'Saved form "' . $form['name'] . '".', 'view' => 'forms');

            case 'form.delete':
                $this->forms->delete((int) $post['form_id'], $adminId);
                return array('notice' => 'Form and its stored submissions deleted.', 'view' => 'forms');

            case 'form.toggle':
                $form = $this->forms->repository()->setEnabled((int) $post['form_id'], !empty($post['enabled']));
                return array('notice' => '"' . $form['name'] . '" is now ' . ($form['enabled'] ? 'accepting' : 'not accepting') . ' submissions.', 'view' => 'forms');

            case 'settings.save':
                $changed = $this->settings->save($post, $adminId, array(
                    'site_title', 'revision_limit', 'autosave_seconds', 'preview_ttl_minutes',
                    'media_max_mib', 'form_rate_limit', 'public_base_path', 'pretty_urls',
                ));
                $this->events->record('settings.update', array(
                    'entity_type' => 'settings', 'admin_id' => $adminId,
                    'summary' => $changed ? 'Updated ' . implode(', ', $changed) : 'No settings changed',
                ));
                return array('notice' => $changed ? 'Saved: ' . implode(', ', $changed) . '.' : 'Nothing changed.', 'view' => 'settings');

            case 'seo.save':
                $changed = $this->settings->save($post, $adminId, array(
                    'seo_title_suffix', 'seo_default_description', 'seo_default_robots', 'social_image_url',
                ));
                return array('notice' => $changed ? 'SEO defaults saved.' : 'Nothing changed.', 'view' => 'seo');

            case 'styles.save':
                $styles = array();
                foreach (isset($post['style']) && is_array($post['style']) ? $post['style'] : array() as $name => $value) {
                    $styles[(string) $name] = (string) $value;
                }
                $changed = $this->settings->save(array('global_styles' => $styles), $adminId, array('global_styles'));
                $this->events->record('settings.update', array(
                    'entity_type' => 'styles', 'admin_id' => $adminId,
                    'summary' => $changed ? 'Updated global styles' : 'Global styles unchanged',
                ));
                return array('notice' => $changed ? 'Global styles saved and applied to every builder page.' : 'Nothing changed.', 'view' => 'styles');

            case 'css.save':
                $this->settings->save(array('custom_css' => isset($post['custom_css']) ? $post['custom_css'] : ''), $adminId, array('custom_css'));
                $this->events->record('css.update', array(
                    'entity_type' => 'settings', 'admin_id' => $adminId,
                    'summary' => 'Updated custom CSS (' . strlen((string) $post['custom_css']) . ' characters, validated)',
                ));
                $this->audit('css.update', 0, null, array('length' => strlen((string) $post['custom_css'])), $adminId);
                return array('notice' => 'Custom CSS validated and saved.', 'view' => 'css');
        }
        return array('error' => 'Unhandled action.');
    }

    /* ------------------------------------------------------------ editor API */

    private function api($adminId)
    {
        $operation = isset($_GET['op']) ? (string) $_GET['op'] : '';
        $response = array('ok' => false, 'error' => 'Unknown operation.');
        $status = 400;
        try {
            if (!isset(self::API_CAPABILITIES[$operation])) {
                throw BuilderException::notFound('Unknown operation.');
            }
            $writes = !in_array($operation, array('state', 'render', 'media'), true);
            if ($writes || $_SERVER['REQUEST_METHOD'] === 'POST') { AdminGuard::requirePostToken(); }
            AdminGuard::requireCapability(self::MODULE, self::API_CAPABILITIES[$operation]);
            $response = $this->apiOperation($operation, $adminId);
            $response['ok'] = true;
            $status = 200;
        } catch (BuilderException $expected) {
            $response = array('ok' => false, 'error' => $expected->getMessage(), 'reason' => $expected->reason(), 'details' => $expected->details());
            $status = $expected->httpStatus();
        } catch (\RuntimeException $denied) {
            $response = array('ok' => false, 'error' => $denied->getMessage(), 'reason' => 'permission');
            $status = 403;
        } catch (\Throwable $unexpected) {
            $safe = SafeError::from($unexpected, self::MODULE, 'api.' . $operation);
            $response = array('ok' => false, 'error' => $safe['display'], 'reason' => 'internal');
            $status = 500;
        }
        $this->emitJson($response, $status);
        return array('__handled' => true);
    }

    private function apiOperation($operation, $adminId)
    {
        $pageId = isset($_REQUEST['page_id']) ? (int) $_REQUEST['page_id'] : 0;
        $partId = isset($_REQUEST['part_id']) ? (int) $_REQUEST['part_id'] : 0;

        switch ($operation) {
            case 'state':
                return $this->editorState($pageId, $partId);

            case 'render':
                $document = $this->documentFromRequest();
                $rendered = $this->renderer->render($document, EditorContext::make($this->context()));
                return array(
                    'html' => $rendered['html'],
                    'css' => $rendered['css'],
                    'notices' => $rendered['notices'],
                    'checksum' => $document->checksum(),
                    'elements' => $document->nodeCount(),
                );

            case 'save':
            case 'autosave':
                $document = $this->documentFromRequest();
                $saved = $this->pages->saveDraft($pageId, $document, $adminId, $operation === 'autosave');
                return array(
                    'saved' => true,
                    'changed' => $saved['changed'],
                    'checksum' => $saved['checksum'],
                    'revision_id' => $saved['revision_id'],
                    'page' => $this->pageSummary($saved['page']),
                    'message' => $saved['changed']
                        ? ($operation === 'autosave' ? 'Autosaved' : 'Draft saved')
                        : 'No changes to save',
                );

            case 'publish':
                $document = $this->documentFromRequest();
                $this->pages->saveDraft($pageId, $document, $adminId, false);
                $page = $this->pages->publish($pageId, $adminId);
                $this->audit('page.publish', $page['id'], null, array('slug' => $page['slug']), $adminId);
                return array(
                    'page' => $this->pageSummary($page),
                    'url' => $this->pages->publicUrl($page),
                    'message' => 'Published to ' . $this->pages->publicUrl($page),
                );

            case 'preview':
                $document = $this->documentFromRequest();
                $this->pages->saveDraft($pageId, $document, $adminId, true);
                $preview = $this->pages->issuePreview($pageId, $adminId);
                return array('url' => $preview['url'], 'expires_in' => $preview['expires_in']);

            case 'media':
                $listing = $this->media->repository()->all(array(
                    'search' => isset($_GET['q']) ? (string) $_GET['q'] : '',
                    'images_only' => !empty($_GET['images_only']),
                ), 1, 60);
                return array('items' => $listing['rows'], 'total' => $listing['total']);

            case 'upload':
                if (empty($_FILES['file'])) { throw BuilderException::upload('No file was received.'); }
                $uploaded = $this->media->upload($_FILES['file'], $adminId, $_POST);
                return array('media' => $uploaded['media'], 'duplicate' => $uploaded['duplicate']);

            case 'template.insert':
                $template = $this->templates->find(isset($_REQUEST['template_id']) ? (int) $_REQUEST['template_id'] : 0);
                if (!$template) { throw BuilderException::notFound('That template no longer exists.'); }
                $document = Document::fromJson($template['document_json'], $this->validator, false);
                return array('children' => $this->withFreshIds($document), 'name' => $template['name']);

            case 'template.save':
                $document = $this->documentFromRequest();
                $nodeId = isset($_POST['node_id']) ? (string) $_POST['node_id'] : '';
                $selection = $nodeId !== '' ? $this->templates->documentFromNode($document, $nodeId) : $document;
                $template = $this->templates->saveFromDocument($_POST, $selection, $adminId);
                return array('template' => $template, 'message' => 'Saved as template "' . $template['name'] . '".');

            case 'part.save':
                $document = $this->documentFromRequest();
                $part = $this->theme->saveDraft($partId, $document, $adminId);
                return array('part' => $part, 'message' => 'Theme part draft saved.');

            case 'part.publish':
                $document = $this->documentFromRequest();
                $this->theme->saveDraft($partId, $document, $adminId);
                $part = $this->theme->publish($partId, $adminId);
                return array('part' => $part, 'message' => 'Theme part published.');
        }
        throw BuilderException::notFound('Unknown operation.');
    }

    private function editorState($pageId, $partId)
    {
        $data = array(
            'widgets' => $this->catalog->toArray(),
            'categories' => $this->catalog->categories(),
            'style_properties' => array_keys(\CloudHost247\Builder\Schema\StyleSchema::properties()),
            'devices' => \CloudHost247\Builder\Schema\StyleSchema::DEVICES,
            'breakpoints' => \CloudHost247\Builder\Schema\StyleSchema::BREAKPOINTS,
        );
        $target = array();
        if ($partId > 0) {
            $part = $this->theme->find($partId);
            if (!$part) { throw BuilderException::notFound('That theme part no longer exists.'); }
            $document = $this->theme->draft($part);
            $target = array('kind' => 'part', 'id' => $part['id'], 'title' => $part['name'], 'status' => $part['status']);
        } else {
            $page = $this->pages->repository()->find($pageId);
            if (!$page) { throw BuilderException::notFound('That page no longer exists.'); }
            $document = $this->pages->draft($page);
            $target = array(
                'kind' => 'page', 'id' => $page['id'], 'title' => $page['title'], 'status' => $page['status'],
                'slug' => $page['slug'], 'url' => $this->pages->publicUrl($page),
                'has_unpublished_changes' => $page['has_unpublished_changes'],
            );
        }
        $rendered = $this->renderer->render($document, EditorContext::make($this->context()));
        return array(
            'target' => $target,
            'document' => $document->toArray(),
            'checksum' => $document->checksum(),
            'html' => $rendered['html'],
            'css' => $rendered['css'],
            'root_css' => $this->settings->compiler()->rootCss('.ch247-canvas'),
            'notices' => $rendered['notices'],
            'catalog' => $data,
            'icons' => \CloudHost247\Builder\Render\Icons::keys(),
            'templates' => $this->templateSummaries(),
            'menus' => $this->menuSummaries(),
            'forms' => $this->formSummaries(),
            'products' => $this->productSummaries(),
            'product_groups' => $this->groupSummaries(),
            'autosave_seconds' => $this->settings->integer('autosave_seconds'),
            'can_publish' => CapabilityPolicy::allows('builder.publish'),
            'can_media' => CapabilityPolicy::allows('builder.media'),
            'can_templates' => CapabilityPolicy::allows('builder.templates'),
        );
    }

    /** Documents arrive as JSON in the POST body field "document". */
    private function documentFromRequest()
    {
        $raw = isset($_POST['document']) ? (string) $_POST['document'] : '';
        if ($raw === '') { throw BuilderException::schema('No page document was received.'); }
        return Document::fromJson($raw, $this->validator, true);
    }

    private function withFreshIds(Document $document)
    {
        $children = array();
        foreach ($document->children() as $child) {
            $children[] = \CloudHost247\Builder\Schema\Node::regenerateIds($child);
        }
        return $children;
    }

    /* ----------------------------------------------------------- view data */

    private function viewData($view, $adminId)
    {
        switch ($view) {
            case 'pages':
            case 'dashboard':
                $listing = $this->pages->repository()->all(array(
                    'status' => isset($_GET['status']) ? (string) $_GET['status'] : '',
                    'search' => isset($_GET['q']) ? (string) $_GET['q'] : '',
                ), isset($_GET['p']) ? (int) $_GET['p'] : 1, 25);
                foreach ($listing['rows'] as $index => $page) {
                    $listing['rows'][$index]['public_url'] = $this->pages->publicUrl($page);
                }
                return array(
                    'listing' => $listing,
                    'templates' => $this->templates->all(),
                    'activity' => $this->events->recent(array(), 1, 8),
                    'health' => $this->health(),
                );

            case 'page':
                $page = $this->pages->repository()->find(isset($_GET['id']) ? (int) $_GET['id'] : 0);
                if (!$page) { return array('error' => 'That page no longer exists.', 'listing' => $this->pages->repository()->all()); }
                return array(
                    'page' => $page,
                    'public_url' => $this->pages->publicUrl($page),
                    'parts' => $this->theme->all(),
                    'media' => $this->media->repository()->all(array('images_only' => true), 1, 40),
                    'revisions' => $this->pages->revisions($page['id'], 10),
                );

            case 'editor':
                $page = null;
                $part = null;
                if (!empty($_GET['part'])) {
                    $part = $this->theme->find((int) $_GET['part']);
                    if (!$part) { return array('error' => 'That theme part no longer exists.'); }
                } else {
                    $page = $this->pages->repository()->find(isset($_GET['id']) ? (int) $_GET['id'] : 0);
                    if (!$page) { return array('error' => 'That page no longer exists.'); }
                }
                return array(
                    'page' => $page,
                    'part' => $part,
                    'asset_base' => $this->link . '&asset=',
                    'api_base' => $this->link . '&ajax=1&op=',
                );

            case 'revisions':
                $page = $this->pages->repository()->find(isset($_GET['id']) ? (int) $_GET['id'] : 0);
                if (!$page) { return array('error' => 'That page no longer exists.'); }
                return array('page' => $page, 'revisions' => $this->pages->revisions($page['id'], 60));

            case 'backups':
                // Revision index: every page with how much history it carries.
                $listing = $this->pages->repository()->all(array(), 1, 100);
                $rows = array();
                foreach ($listing['rows'] as $page) {
                    $history = $this->pages->revisions($page['id'], 200);
                    $snapshots = 0;
                    foreach ($history as $revision) {
                        if ($revision['is_published_snapshot']) { $snapshots++; }
                    }
                    $rows[] = array(
                        'page' => $page,
                        'revisions' => count($history),
                        'snapshots' => $snapshots,
                        'latest' => $history ? $history[0] : null,
                    );
                }
                return array('backups' => $rows, 'revision_limit' => $this->settings->integer('revision_limit'));

            case 'templates':
                return array('templates' => $this->templates->all(), 'categories' => LibraryRepository::TEMPLATE_CATEGORIES);

            case 'headers':
                // The same parts, narrowed to the two that wrap every page.
                $siteParts = array();
                foreach ($this->theme->all() as $part) {
                    if ($part['part_type'] !== 'header' && $part['part_type'] !== 'footer') { continue; }
                    $part['conditions_summary'] = DisplayConditions::describe($part['conditions']);
                    $siteParts[] = $part;
                }
                return array(
                    'parts' => $siteParts,
                    'part_types' => array('header' => LibraryRepository::PART_TYPES['header'],
                        'footer' => LibraryRepository::PART_TYPES['footer']),
                    'pages' => $this->pages->repository()->all(array(), 1, 100),
                    'menus' => $this->menus->all(),
                );

            case 'theme':
                $parts = $this->theme->all();
                foreach ($parts as $index => $part) {
                    $parts[$index]['conditions_summary'] = DisplayConditions::describe($part['conditions']);
                }
                return array(
                    'parts' => $parts,
                    'part_types' => LibraryRepository::PART_TYPES,
                    'rule_types' => DisplayConditions::RULE_TYPES,
                    'page_types' => DisplayConditions::PAGE_TYPES,
                    'pages' => $this->pages->repository()->all(array(), 1, 100),
                );

            case 'part':
                $part = $this->theme->find(isset($_GET['id']) ? (int) $_GET['id'] : 0);
                if (!$part) { return array('error' => 'That theme part no longer exists.'); }
                return array(
                    'part' => $part,
                    'part_types' => LibraryRepository::PART_TYPES,
                    'rule_types' => DisplayConditions::RULE_TYPES,
                    'page_types' => DisplayConditions::PAGE_TYPES,
                    'conditions_summary' => DisplayConditions::describe($part['conditions']),
                );

            case 'menus':
                return array('menus' => $this->menus->all(), 'pages' => $this->pages->repository()->all(array(), 1, 100));

            case 'styles':
                return array(
                    'styles' => $this->settings->effectiveStyles(),
                    'overrides' => $this->settings->globalStyles(),
                    'defaults' => \CloudHost247\Builder\Render\StyleCompiler::DEFAULT_VARIABLES,
                );

            case 'media':
                return array(
                    'media' => $this->media->repository()->all(array(
                        'category' => isset($_GET['category']) ? (string) $_GET['category'] : '',
                        'search' => isset($_GET['q']) ? (string) $_GET['q'] : '',
                    ), isset($_GET['p']) ? (int) $_GET['p'] : 1, 48),
                    'categories' => \CloudHost247\Builder\Repositories\MediaRepository::CATEGORIES,
                    'allowed' => array_keys(MediaService::ALLOWED),
                    'max_bytes' => $this->media->maxBytes(),
                    'storage_ready' => $this->media->storageReady(),
                    'storage_path' => Paths::mediaRoot(),
                    'total_bytes' => $this->media->repository()->totalBytes(),
                );

            case 'forms':
                return array(
                    'forms' => $this->forms->repository()->all(),
                    'field_types' => FormService::FIELD_TYPES,
                    'departments' => $this->departments(),
                );

            case 'submissions':
                $formId = isset($_GET['id']) ? (int) $_GET['id'] : 0;
                return array(
                    'form' => $formId > 0 ? $this->forms->repository()->find($formId) : null,
                    'submissions' => $this->forms->repository()->submissions($formId, isset($_GET['p']) ? (int) $_GET['p'] : 1, 25),
                    'forms' => $this->forms->repository()->all(),
                );

            case 'seo':
                return array('settings' => $this->settings->all(), 'robots' => Settings::ROBOTS);

            case 'css':
                return array('custom_css' => $this->settings->get('custom_css', ''), 'max_length' => \CloudHost247\Builder\Support\CssSanitizer::MAX_LENGTH);

            case 'settings':
                return array(
                    'settings' => $this->settings->all(),
                    'health' => $this->health(),
                    'capability_labels' => CapabilityPolicy::CAPABILITIES,
                    'policy' => CapabilityPolicy::current(),
                );

            case 'activity':
                return array('activity' => $this->events->recent(array(
                    'event_type' => isset($_GET['event']) ? (string) $_GET['event'] : '',
                ), isset($_GET['p']) ? (int) $_GET['p'] : 1, 50), 'event_types' => EventRepository::EVENT_TYPES);
        }
        return array();
    }

    /* --------------------------------------------------------------- helpers */

    private function context()
    {
        return array(
            'menus' => $this->menus->resolver(),
            'forms' => array($this->forms, 'publicDefinition'),
            'data' => new WhmcsDataSource(),
        );
    }

    private function health()
    {
        $data = new WhmcsDataSource();
        return array(
            'catalogue' => $data->available(),
            'catalogue_reason' => $data->available() ? '' : $data->unavailableReason(),
            'integrations' => class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager'),
            'media_writable' => $this->media->storageReady(),
            'media_path' => Paths::mediaRoot(),
            'dom_extension' => class_exists('DOMDocument'),
            'front_controller' => is_file(Paths::applicationRoot() . '/' . $this->settings->get('public_base_path', 'builder-page.php')),
            'front_controller_path' => $this->settings->get('public_base_path', 'builder-page.php'),
        );
    }

    private function capabilityMap()
    {
        $map = array();
        foreach (CapabilityPolicy::keys() as $capability) {
            $map[$capability] = CapabilityPolicy::allows($capability);
        }
        return $map;
    }

    private function pageSummary(array $page)
    {
        return array(
            'id' => $page['id'], 'title' => $page['title'], 'slug' => $page['slug'], 'status' => $page['status'],
            'updated_at' => $page['updated_at'], 'published_at' => $page['published_at'],
            'has_unpublished_changes' => $page['has_unpublished_changes'],
        );
    }

    private function templateSummaries()
    {
        $summaries = array();
        foreach ($this->templates->all() as $template) {
            $summaries[] = array(
                'id' => $template['id'], 'name' => $template['name'], 'category' => $template['category'],
                'description' => $template['description'], 'builtin' => $template['is_builtin'],
            );
        }
        return $summaries;
    }

    private function menuSummaries()
    {
        $summaries = array();
        foreach ($this->menus->all() as $menu) {
            $summaries[] = array('id' => $menu['id'], 'name' => $menu['name'], 'items' => count($menu['items']));
        }
        return $summaries;
    }

    private function formSummaries()
    {
        $summaries = array();
        foreach ($this->forms->repository()->all() as $form) {
            $summaries[] = array('id' => $form['id'], 'name' => $form['name'], 'enabled' => $form['enabled'], 'fields' => count($form['fields']));
        }
        return $summaries;
    }

    private function productSummaries()
    {
        $data = new WhmcsDataSource();
        $products = $data->products(0, 48);
        if ($products === null) { return array('available' => false, 'reason' => $data->unavailableReason(), 'items' => array()); }
        $items = array();
        foreach ($products as $product) {
            $items[] = array(
                'id' => $product['id'], 'name' => $product['name'], 'group' => $product['group'],
                'price' => $product['price'] === null ? '' : $product['price']['formatted'],
            );
        }
        return array('available' => true, 'reason' => '', 'items' => $items);
    }

    private function groupSummaries()
    {
        $data = new WhmcsDataSource();
        $groups = $data->productGroups();
        if ($groups === null) { return array('available' => false, 'reason' => $data->unavailableReason(), 'items' => array()); }
        return array('available' => true, 'reason' => '', 'items' => $groups);
    }

    private function departments()
    {
        if (!class_exists('WHMCS\\Database\\Capsule')) { return array(); }
        try {
            $rows = \WHMCS\Database\Capsule::table('tblticketdepartments')->orderBy('order')->get();
        } catch (\Throwable $unavailable) {
            return array();
        }
        $departments = array();
        foreach ($rows as $row) {
            $departments[(int) $row->id] = (string) $row->name;
        }
        return $departments;
    }

    /**
     * Build a two-level menu from the repeatable rows the menu form posts.
     *
     * Each row names its parent row; a row that points at a missing parent, at
     * itself, or at a row that is already a child becomes a top-level item, so
     * a malformed post can never produce an infinite tree.
     */
    private function menuItemsFromInput(array $post)
    {
        $labels = isset($post['item_label']) && is_array($post['item_label']) ? $post['item_label'] : array();
        $urls = isset($post['item_url']) && is_array($post['item_url']) ? $post['item_url'] : array();
        $targets = isset($post['item_target']) && is_array($post['item_target']) ? $post['item_target'] : array();
        $parents = isset($post['item_parent']) && is_array($post['item_parent']) ? $post['item_parent'] : array();

        $rows = array();
        foreach ($labels as $index => $label) {
            if (trim((string) $label) === '') { continue; }
            $key = (string) $index;
            $rows[$key] = array(
                'label' => (string) $label,
                'url' => isset($urls[$index]) ? (string) $urls[$index] : '',
                'target' => isset($targets[$index]) && $targets[$index] === 'blank' ? 'blank' : 'self',
                'parent' => isset($parents[$index]) ? (string) $parents[$index] : '',
                'children' => array(),
            );
        }
        foreach ($rows as $key => $row) {
            $parent = $row['parent'];
            $nested = $parent !== '' && isset($rows[$parent]) && $parent !== $key && $rows[$parent]['parent'] === '';
            if (!$nested) { continue; }
            $child = $row;
            unset($child['parent'], $child['children']);
            $child['children'] = array();
            $rows[$parent]['children'][] = $child;
        }

        $items = array();
        foreach ($rows as $key => $row) {
            $parent = $row['parent'];
            if ($parent !== '' && isset($rows[$parent]) && $parent !== $key && $rows[$parent]['parent'] === '') { continue; }
            unset($row['parent']);
            $items[] = $row;
        }
        return $items;
    }

    private function formFieldsFromInput(array $post)
    {
        $fields = array();
        $names = isset($post['field_name']) && is_array($post['field_name']) ? $post['field_name'] : array();
        foreach ($names as $index => $name) {
            if (trim((string) $name) === '') { continue; }
            $options = isset($post['field_options'][$index]) ? (string) $post['field_options'][$index] : '';
            $fields[] = array(
                'name' => $name,
                'label' => isset($post['field_label'][$index]) ? $post['field_label'][$index] : $name,
                'type' => isset($post['field_type'][$index]) ? $post['field_type'][$index] : 'text',
                'required' => !empty($post['field_required'][$index]),
                'placeholder' => isset($post['field_placeholder'][$index]) ? $post['field_placeholder'][$index] : '',
                'help' => isset($post['field_help'][$index]) ? $post['field_help'][$index] : '',
                'options' => $options === '' ? array() : array_map('trim', explode('|', $options)),
            );
        }
        return $fields;
    }

    private function describeInspection(array $inspection)
    {
        return array(
            'template' => $inspection['template'],
            'elements' => $inspection['elements'],
            'widgets' => $inspection['widgets'],
            'checksum_matches' => $inspection['checksum_matches'],
            'warnings' => $inspection['warnings'],
        );
    }

    private function audit($action, $resourceId, $before, $after, $adminId)
    {
        try {
            AuditLogger::record(self::MODULE, $action, 'builder', (string) $resourceId, $before, $after, 'success', null, $adminId);
        } catch (\Throwable $ignored) {
            // The audit trail is best effort here; the builder event log already recorded it.
        }
    }

    private function serveAsset($asset)
    {
        if (!isset(self::ASSETS[$asset])) {
            http_response_code(404);
            echo 'Not found';
            return array('__handled' => true);
        }
        $path = Paths::assetDirectory() . '/' . (substr($asset, -3) === '.js' ? 'js/' : 'css/') . $asset;
        if (!is_file($path)) {
            http_response_code(404);
            echo 'Not found';
            return array('__handled' => true);
        }
        header('Content-Type: ' . self::ASSETS[$asset]);
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: private, max-age=300');
        echo (string) file_get_contents($path);
        return array('__handled' => true);
    }

    private function emitJson(array $payload, $status)
    {
        if (!headers_sent()) {
            http_response_code((int) $status);
            header('Content-Type: application/json; charset=utf-8');
            header('X-Content-Type-Options: nosniff');
            header('Cache-Control: no-store');
        }
        echo (string) json_encode($payload, JSON_UNESCAPED_SLASHES);
    }
}
