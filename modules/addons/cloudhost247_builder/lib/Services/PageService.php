<?php
namespace CloudHost247\Builder\Services;

use CloudHost247\Builder\Repositories\EventRepository;
use CloudHost247\Builder\Repositories\PageRepository;
use CloudHost247\Builder\Schema\Document;
use CloudHost247\Builder\Schema\SchemaValidator;
use CloudHost247\Builder\Support\BuilderException;
use CloudHost247\Builder\Support\HtmlSanitizer;
use CloudHost247\Builder\Support\Slug;
use CloudHost247\Builder\Support\UrlPolicy;

/**
 * Page lifecycle: create, edit, revise, publish, schedule, unpublish, restore.
 *
 * Two invariants hold everywhere in this class.
 *
 * 1. Draft and live are separate. Saving never changes what visitors see;
 *    only publish() copies the draft into the published column, and
 *    unpublish() removes the published copy outright rather than hiding it.
 * 2. Nothing is stored that has not been through SchemaValidator, so a page
 *    cannot be published with content the renderer would have to guess about.
 */
class PageService
{
    const MAX_TITLE = 200;

    private $pages;
    private $events;
    private $settings;
    private $validator;
    private $sanitizer;

    public function __construct(
        PageRepository $pages = null,
        EventRepository $events = null,
        Settings $settings = null,
        SchemaValidator $validator = null,
        HtmlSanitizer $sanitizer = null
    ) {
        $this->pages = $pages ? $pages : new PageRepository();
        $this->events = $events ? $events : new EventRepository();
        $this->settings = $settings ? $settings : new Settings();
        $this->validator = $validator ? $validator : new SchemaValidator();
        $this->sanitizer = $sanitizer ? $sanitizer : new HtmlSanitizer();
    }

    public function repository() { return $this->pages; }

    /* --------------------------------------------------------------- create */

    public function create(array $input, $adminId, Document $document = null)
    {
        $title = $this->sanitizer->text(isset($input['title']) ? $input['title'] : '', self::MAX_TITLE);
        if ($title === '') {
            throw BuilderException::validation('Give the page a title.');
        }
        $requested = isset($input['slug']) && trim((string) $input['slug']) !== '' ? $input['slug'] : $title;
        $repository = $this->pages;
        $slug = Slug::unique($requested, function ($candidate) use ($repository) {
            return $repository->slugExists($candidate);
        }, 'page');

        $document = $document ? $document : Document::blank();
        $data = array(
            'slug' => $slug,
            'title' => $title,
            'status' => 'draft',
            'visibility' => isset($input['visibility']) ? $input['visibility'] : 'public',
            'template_key' => isset($input['template_key']) ? (string) $input['template_key'] : '',
            'seo_title' => $this->sanitizer->text(isset($input['seo_title']) ? $input['seo_title'] : '', self::MAX_TITLE),
            'meta_description' => $this->sanitizer->text(isset($input['meta_description']) ? $input['meta_description'] : '', 320),
            'document_json' => $document->toJson(),
        );
        $id = $this->pages->create($data, $adminId);
        $this->pages->addRevision($id, $document, array(
            'title' => $title, 'status' => 'draft', 'note' => 'Page created', 'admin_id' => $adminId,
        ));
        $this->events->record('page.create', array(
            'entity_type' => 'page', 'entity_id' => (string) $id, 'admin_id' => $adminId,
            'summary' => 'Created page "' . $title . '" (/' . $slug . ')',
        ));
        return $this->pages->find($id);
    }

    public function duplicate($pageId, $adminId)
    {
        $page = $this->mustFind($pageId);
        $repository = $this->pages;
        $slug = Slug::unique($page['slug'] . '-copy', function ($candidate) use ($repository) {
            return $repository->slugExists($candidate);
        }, 'page-copy');
        $document = $this->draft($page);
        $id = $this->pages->create(array(
            'slug' => $slug,
            'title' => substr($page['title'] . ' (copy)', 0, self::MAX_TITLE),
            'status' => 'draft',
            'visibility' => $page['visibility'],
            'template_key' => $page['template_key'],
            'seo_title' => $page['seo_title'],
            'meta_description' => $page['meta_description'],
            'header_part' => $page['header_part'],
            'footer_part' => $page['footer_part'],
            'document_json' => $document->toJson(),
        ), $adminId);
        $this->events->record('page.create', array(
            'entity_type' => 'page', 'entity_id' => (string) $id, 'admin_id' => $adminId,
            'summary' => 'Duplicated page #' . (int) $pageId . ' as /' . $slug,
        ));
        return $this->pages->find($id);
    }

    /* ----------------------------------------------------------------- edit */

    public function updateMeta($pageId, array $input, $adminId)
    {
        $page = $this->mustFind($pageId);
        $data = array();
        if (isset($input['title'])) {
            $title = $this->sanitizer->text($input['title'], self::MAX_TITLE);
            if ($title === '') { throw BuilderException::validation('The page title cannot be empty.'); }
            $data['title'] = $title;
        }
        if (isset($input['slug'])) {
            $slug = Slug::make($input['slug']);
            if ($slug === '' || !Slug::isValid($slug)) {
                throw BuilderException::validation('That page address cannot be used. Use lowercase letters, numbers and hyphens.');
            }
            if ($this->pages->slugExists($slug, (int) $pageId)) {
                throw BuilderException::conflict('Another page already uses the address /' . $slug . '.');
            }
            $data['slug'] = $slug;
        }
        foreach (array('seo_title' => self::MAX_TITLE, 'meta_description' => 320) as $field => $length) {
            if (isset($input[$field])) { $data[$field] = $this->sanitizer->text($input[$field], $length); }
        }
        if (isset($input['meta_robots'])) {
            $data['meta_robots'] = in_array($input['meta_robots'], Settings::ROBOTS, true) ? $input['meta_robots'] : 'index,follow';
        }
        if (isset($input['canonical_url'])) {
            $canonical = UrlPolicy::link($input['canonical_url']);
            if ($canonical === null) { throw BuilderException::validation('The canonical URL is not acceptable.'); }
            $data['canonical_url'] = $canonical;
        }
        if (isset($input['visibility'])) {
            $data['visibility'] = in_array($input['visibility'], PageRepository::VISIBILITIES, true) ? $input['visibility'] : 'public';
        }
        foreach (array('featured_media_id', 'og_media_id') as $field) {
            if (isset($input[$field])) { $data[$field] = (int) $input[$field]; }
        }
        foreach (array('header_part', 'footer_part') as $field) {
            if (isset($input[$field])) {
                $value = (string) $input[$field];
                $data[$field] = preg_match('/^(inherit|none|[a-z][a-z0-9_-]{1,63})$/', $value) === 1 ? $value : 'inherit';
            }
        }
        if (isset($input['template_key'])) {
            $data['template_key'] = preg_match('/^[a-z0-9_-]{0,64}$/', (string) $input['template_key']) === 1 ? (string) $input['template_key'] : '';
        }
        if (!$data) { return $page; }

        $updated = $this->pages->update($pageId, $data, $adminId);
        $this->events->record('page.update', array(
            'entity_type' => 'page', 'entity_id' => (string) $pageId, 'admin_id' => $adminId,
            'summary' => 'Updated page settings for "' . $updated['title'] . '"',
            'metadata' => array('fields' => array_keys($data)),
        ));
        return $updated;
    }

    /**
     * Store the working copy.
     *
     * A revision is written whenever the content actually changed. Autosaves
     * are flagged so they can be pruned first and never masquerade as a
     * deliberate save point.
     */
    public function saveDraft($pageId, $documentData, $adminId, $autosave = false)
    {
        $page = $this->mustFind($pageId);
        $document = $documentData instanceof Document
            ? $documentData
            : Document::fromArray($documentData, $this->validator, true);

        $changed = $document->checksum() !== $page['draft_checksum'];
        $this->pages->saveDraft($pageId, $document, $adminId);

        $revisionId = 0;
        if ($changed) {
            $revisionId = $this->pages->addRevision($pageId, $document, array(
                'title' => $page['title'],
                'status' => $page['status'],
                'note' => $autosave ? 'Autosave' : 'Draft saved',
                'autosave' => $autosave,
                'admin_id' => $adminId,
            ));
            $this->pages->pruneRevisions($pageId, $this->settings->integer('revision_limit'));
        }
        if ($changed && !$autosave) {
            $this->events->record('page.draft_saved', array(
                'entity_type' => 'page', 'entity_id' => (string) $pageId, 'admin_id' => $adminId,
                'summary' => 'Saved draft of "' . $page['title'] . '"',
                'metadata' => array('elements' => $document->nodeCount(), 'revision_id' => $revisionId),
            ));
        }
        return array(
            'page' => $this->pages->find($pageId),
            'changed' => $changed,
            'revision_id' => $revisionId,
            'checksum' => $document->checksum(),
        );
    }

    /* -------------------------------------------------------------- publish */

    public function publish($pageId, $adminId)
    {
        $page = $this->mustFind($pageId);
        $document = $this->draft($page);
        if ($document->isEmpty()) {
            throw BuilderException::state('There is nothing to publish yet: add at least one section first.');
        }
        $revisionId = $this->pages->addRevision($pageId, $document, array(
            'title' => $page['title'], 'status' => 'published', 'note' => 'Published',
            'published' => true, 'admin_id' => $adminId,
        ));
        $updated = $this->pages->publish($pageId, $document, $revisionId, $adminId, 'published');
        $this->events->record('page.publish', array(
            'entity_type' => 'page', 'entity_id' => (string) $pageId, 'admin_id' => $adminId,
            'summary' => 'Published "' . $page['title'] . '" at /' . $page['slug'],
            'metadata' => array('revision_id' => $revisionId, 'elements' => $document->nodeCount()),
        ));
        return $updated;
    }

    /**
     * Schedule a publication.
     *
     * The draft is snapshotted into the published column immediately but the
     * status stays "scheduled", so the resolver refuses to serve it until the
     * moment arrives. That makes scheduling work correctly even if the cron is
     * not running: nothing goes live early, and nothing depends on a job to go
     * live on time.
     */
    public function schedule($pageId, $when, $adminId)
    {
        $page = $this->mustFind($pageId);
        $timestamp = is_numeric($when) ? (int) $when : strtotime((string) $when);
        if (!$timestamp) {
            throw BuilderException::validation('That publication date could not be understood.');
        }
        if ($timestamp <= time()) {
            throw BuilderException::validation('Choose a publication time in the future, or publish now.');
        }
        $document = $this->draft($page);
        if ($document->isEmpty()) {
            throw BuilderException::state('There is nothing to schedule yet: add at least one section first.');
        }
        $revisionId = $this->pages->addRevision($pageId, $document, array(
            'title' => $page['title'], 'status' => 'scheduled', 'note' => 'Scheduled', 'admin_id' => $adminId,
        ));
        $this->pages->publish($pageId, $document, $revisionId, $adminId, 'scheduled');
        $updated = $this->pages->setStatus($pageId, 'scheduled', $adminId, array(
            'publish_at' => date('Y-m-d H:i:s', $timestamp), 'published_at' => null,
        ));
        $this->events->record('page.schedule', array(
            'entity_type' => 'page', 'entity_id' => (string) $pageId, 'admin_id' => $adminId,
            'summary' => 'Scheduled "' . $page['title'] . '" for ' . date('Y-m-d H:i', $timestamp),
        ));
        return $updated;
    }

    public function unpublish($pageId, $adminId)
    {
        $page = $this->mustFind($pageId);
        $updated = $this->pages->setStatus($pageId, 'draft', $adminId, array(
            // Remove the live copy outright: an unpublished page has no public content.
            'published_json' => null,
            'published_checksum' => '',
            'published_at' => null,
            'publish_at' => null,
        ));
        $this->events->record('page.unpublish', array(
            'entity_type' => 'page', 'entity_id' => (string) $pageId, 'admin_id' => $adminId,
            'summary' => 'Unpublished "' . $page['title'] . '"; the public URL now returns not found',
        ));
        return $updated;
    }

    public function archive($pageId, $adminId)
    {
        $page = $this->mustFind($pageId);
        $updated = $this->pages->setStatus($pageId, 'archived', $adminId, array(
            'published_json' => null, 'published_checksum' => '', 'published_at' => null, 'publish_at' => null,
        ));
        $this->events->record('page.archive', array(
            'entity_type' => 'page', 'entity_id' => (string) $pageId, 'admin_id' => $adminId,
            'summary' => 'Archived "' . $page['title'] . '"',
        ));
        return $updated;
    }

    public function delete($pageId, $adminId)
    {
        $page = $this->mustFind($pageId);
        $revisions = count($this->pages->revisions($pageId, 200));
        $this->pages->delete($pageId);
        $this->events->record('page.delete', array(
            'entity_type' => 'page', 'entity_id' => (string) $pageId, 'admin_id' => $adminId,
            'summary' => 'Deleted "' . $page['title'] . '" (/' . $page['slug'] . ') and ' . $revisions . ' revision(s)',
        ));
        return true;
    }

    public function setHome($pageId, $adminId)
    {
        $page = $this->mustFind($pageId);
        $updated = $this->pages->setHome($pageId, $adminId);
        $this->events->record('page.update', array(
            'entity_type' => 'page', 'entity_id' => (string) $pageId, 'admin_id' => $adminId,
            'summary' => 'Set "' . $page['title'] . '" as the builder front page',
        ));
        return $updated;
    }

    /* ------------------------------------------------------------ revisions */

    public function restoreRevision($pageId, $revisionId, $adminId)
    {
        $page = $this->mustFind($pageId);
        $revision = $this->pages->revision($revisionId);
        if (!$revision || $revision['page_id'] !== (int) $pageId) {
            throw BuilderException::notFound('That revision does not belong to this page.');
        }
        $document = Document::fromJson($revision['document_json'], $this->validator, false);

        // The state being replaced becomes a revision of its own, so a restore
        // is itself reversible.
        $current = $this->draft($page);
        if ($current->checksum() !== $page['draft_checksum'] || true) {
            $this->pages->addRevision($pageId, $current, array(
                'title' => $page['title'], 'status' => $page['status'],
                'note' => 'Replaced by restore of revision #' . $revision['revision_no'],
                'admin_id' => $adminId,
            ));
        }
        $this->pages->saveDraft($pageId, $document, $adminId);
        $this->pages->addRevision($pageId, $document, array(
            'title' => $page['title'], 'status' => $page['status'],
            'note' => 'Restored revision #' . $revision['revision_no'], 'admin_id' => $adminId,
        ));
        $this->events->record('page.restore', array(
            'entity_type' => 'page', 'entity_id' => (string) $pageId, 'admin_id' => $adminId,
            'summary' => 'Restored revision #' . $revision['revision_no'] . ' of "' . $page['title'] . '"',
            'metadata' => array('revision_id' => (int) $revisionId),
        ));
        return array(
            'page' => $this->pages->find($pageId),
            'restored_revision' => $revision['revision_no'],
            'published_unchanged' => true,
        );
    }

    public function revisions($pageId, $limit = 30)
    {
        return $this->pages->revisions($pageId, $limit);
    }

    /* -------------------------------------------------------------- preview */

    public function issuePreview($pageId, $adminId)
    {
        $page = $this->mustFind($pageId);
        $ttl = $this->settings->integer('preview_ttl_minutes') * 60;
        $token = $this->pages->issuePreviewToken($pageId, $adminId, $ttl);
        $this->pages->purgeExpiredTokens();
        $this->events->record('page.preview', array(
            'entity_type' => 'page', 'entity_id' => (string) $pageId, 'admin_id' => $adminId,
            'summary' => 'Issued a draft preview link for "' . $page['title'] . '" valid for ' . (int) ($ttl / 60) . ' minutes',
        ));
        return array(
            'token' => $token,
            'url' => $this->previewUrl($page, $token),
            'expires_in' => $ttl,
        );
    }

    public function previewUrl(array $page, $token)
    {
        $base = $this->settings->get('public_base_path', 'builder-page.php');
        return $base . '?slug=' . rawurlencode($page['slug']) . '&preview=' . rawurlencode($token);
    }

    public function publicUrl(array $page)
    {
        $base = $this->settings->get('public_base_path', 'builder-page.php');
        if ($this->settings->flag('pretty_urls')) { return '/' . $page['slug']; }
        return $base . '?slug=' . rawurlencode($page['slug']);
    }

    /* -------------------------------------------------------------- reading */

    public function draft(array $page)
    {
        return Document::fromStorage(isset($page['document_json']) ? $page['document_json'] : '', $this->validator);
    }

    public function published(array $page)
    {
        return Document::fromStorage(isset($page['published_json']) ? $page['published_json'] : '', $this->validator);
    }

    /** Flip scheduled pages whose time has come. Safe to run repeatedly. */
    public function promoteScheduled($adminId = 0)
    {
        $promoted = array();
        foreach ($this->pages->dueScheduled() as $page) {
            $this->pages->setStatus($page['id'], 'published', $adminId, array(
                'published_at' => date('Y-m-d H:i:s'),
            ));
            $this->events->record('page.publish', array(
                'entity_type' => 'page', 'entity_id' => (string) $page['id'], 'admin_id' => $adminId,
                'summary' => 'Scheduled publication of "' . $page['title'] . '" became live',
            ));
            $promoted[] = $page['slug'];
        }
        return $promoted;
    }

    private function mustFind($pageId)
    {
        $page = $this->pages->find($pageId);
        if (!$page) { throw BuilderException::notFound('That page no longer exists.'); }
        return $page;
    }
}
