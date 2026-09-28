<?php
namespace CloudHost247\Builder\Repositories;

use CloudHost247\Builder\Schema\Document;
use CloudHost247\Builder\Support\BuilderException;
use CloudHost247\Builder\Support\Ids;
use CloudHost247\Builder\Support\Slug;
use WHMCS\Database\Capsule;

/**
 * Pages, revisions and draft preview tokens.
 *
 * Draft and published content are separate columns. Editing a page only ever
 * writes document_json; published_json is replaced by an explicit publish, and
 * the public resolver reads nothing else. That separation is what keeps an
 * unpublished draft off the live site even if it is saved a hundred times.
 *
 * Query builder only, no interpolated SQL.
 */
class PageRepository
{
    const PAGES = 'mod_cloudhost247_builder_pages';
    const REVISIONS = 'mod_cloudhost247_builder_revisions';
    const TOKENS = 'mod_cloudhost247_builder_preview_tokens';

    const STATUSES = array('draft', 'scheduled', 'published', 'archived');
    const VISIBILITIES = array('public', 'clients', 'admins');
    const PREVIEW_TTL_SECONDS = 1800;

    /* ----------------------------------------------------------------- read */

    public function all(array $filters = array(), $page = 1, $perPage = 25)
    {
        $query = Capsule::table(self::PAGES);
        if (!empty($filters['status']) && in_array($filters['status'], self::STATUSES, true)) {
            $query->where('status', $filters['status']);
        }
        if (!empty($filters['search'])) {
            $term = '%' . str_replace(array('%', '_'), array('\%', '\_'), (string) $filters['search']) . '%';
            $query->where(function ($inner) use ($term) {
                $inner->where('title', 'like', $term)->orWhere('slug', 'like', $term);
            });
        }
        $total = (int) $query->count();
        $perPage = max(1, min(100, (int) $perPage));
        $page = max(1, (int) $page);
        $rows = $query->orderBy('updated_at', 'desc')->orderBy('id', 'desc')
            ->limit($perPage)->offset(($page - 1) * $perPage)->get();

        $pages = array();
        foreach ($rows as $row) { $pages[] = $this->hydrate($row); }
        return array(
            'rows' => $pages,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
            'pages' => (int) ceil($total / $perPage),
        );
    }

    public function counts()
    {
        $counts = array('total' => 0);
        foreach (self::STATUSES as $status) { $counts[$status] = 0; }
        try {
            foreach (Capsule::table(self::PAGES)->get() as $row) {
                $counts['total']++;
                $status = isset($row->status) ? (string) $row->status : 'draft';
                if (isset($counts[$status])) { $counts[$status]++; }
            }
        } catch (\Throwable $unavailable) {
            return $counts;
        }
        return $counts;
    }

    public function find($id)
    {
        $row = Capsule::table(self::PAGES)->where('id', (int) $id)->first();
        return $row ? $this->hydrate($row) : null;
    }

    public function findBySlug($slug)
    {
        $row = Capsule::table(self::PAGES)->where('slug', (string) $slug)->first();
        return $row ? $this->hydrate($row) : null;
    }

    public function home()
    {
        $row = Capsule::table(self::PAGES)->where('is_home', 1)->first();
        return $row ? $this->hydrate($row) : null;
    }

    public function slugExists($slug, $exceptId = 0)
    {
        $query = Capsule::table(self::PAGES)->where('slug', (string) $slug);
        if ((int) $exceptId > 0) { $query->where('id', '!=', (int) $exceptId); }
        return (bool) $query->exists();
    }

    /* ---------------------------------------------------------------- write */

    public function create(array $data, $adminId)
    {
        $now = date('Y-m-d H:i:s');
        $record = $this->columns($data);
        $record['document_json'] = isset($data['document_json']) ? $data['document_json'] : Document::blank()->toJson();
        $record['draft_checksum'] = hash('sha256', (string) $record['document_json']);
        $record['created_by'] = (int) $adminId;
        $record['updated_by'] = (int) $adminId;
        $record['created_at'] = $now;
        $record['updated_at'] = $now;
        $record['schema_version'] = Document::VERSION;
        return (int) Capsule::table(self::PAGES)->insertGetId($record);
    }

    public function update($id, array $data, $adminId)
    {
        $record = $this->columns($data);
        $record['updated_by'] = (int) $adminId;
        $record['updated_at'] = date('Y-m-d H:i:s');
        Capsule::table(self::PAGES)->where('id', (int) $id)->update($record);
        return $this->find($id);
    }

    /** Store the working copy. Never touches published content. */
    public function saveDraft($id, Document $document, $adminId)
    {
        $json = $document->toJson();
        Capsule::table(self::PAGES)->where('id', (int) $id)->update(array(
            'document_json' => $json,
            'draft_checksum' => $document->checksum(),
            'schema_version' => Document::VERSION,
            'updated_by' => (int) $adminId,
            'updated_at' => date('Y-m-d H:i:s'),
        ));
        return $this->find($id);
    }

    /** Copy the working copy into the live column. */
    public function publish($id, Document $document, $revisionId, $adminId, $status = 'published')
    {
        $now = date('Y-m-d H:i:s');
        Capsule::table(self::PAGES)->where('id', (int) $id)->update(array(
            'published_json' => $document->toJson(),
            'published_checksum' => $document->checksum(),
            'published_revision_id' => (int) $revisionId,
            'status' => in_array($status, self::STATUSES, true) ? $status : 'published',
            'published_at' => $now,
            'updated_by' => (int) $adminId,
            'updated_at' => $now,
        ));
        return $this->find($id);
    }

    public function setStatus($id, $status, $adminId, array $extra = array())
    {
        if (!in_array($status, self::STATUSES, true)) {
            throw BuilderException::validation('Unknown page status.');
        }
        $record = array_merge($extra, array(
            'status' => $status,
            'updated_by' => (int) $adminId,
            'updated_at' => date('Y-m-d H:i:s'),
        ));
        Capsule::table(self::PAGES)->where('id', (int) $id)->update($record);
        return $this->find($id);
    }

    /** Exactly one page may be the front page. */
    public function setHome($id, $adminId)
    {
        Capsule::table(self::PAGES)->where('is_home', 1)->update(array('is_home' => 0, 'updated_at' => date('Y-m-d H:i:s')));
        Capsule::table(self::PAGES)->where('id', (int) $id)->update(array(
            'is_home' => 1, 'updated_by' => (int) $adminId, 'updated_at' => date('Y-m-d H:i:s'),
        ));
        return $this->find($id);
    }

    public function delete($id)
    {
        $id = (int) $id;
        Capsule::table(self::REVISIONS)->where('page_id', $id)->delete();
        Capsule::table(self::TOKENS)->where('page_id', $id)->delete();
        return (int) Capsule::table(self::PAGES)->where('id', $id)->delete();
    }

    /** Pages whose scheduled time has arrived; used by the cron and the resolver. */
    public function dueScheduled($now = null)
    {
        $now = $now ? $now : date('Y-m-d H:i:s');
        $rows = Capsule::table(self::PAGES)->where('status', 'scheduled')
            ->whereNotNull('publish_at')->where('publish_at', '<=', $now)->get();
        $pages = array();
        foreach ($rows as $row) { $pages[] = $this->hydrate($row); }
        return $pages;
    }

    /* ------------------------------------------------------------ revisions */

    public function addRevision($pageId, Document $document, array $meta = array())
    {
        $pageId = (int) $pageId;
        $next = (int) Capsule::table(self::REVISIONS)->where('page_id', $pageId)->max('revision_no');
        $record = array(
            'page_id' => $pageId,
            'part_key' => isset($meta['part_key']) ? (string) $meta['part_key'] : '',
            'revision_no' => $next + 1,
            'document_json' => $document->toJson(),
            'title' => isset($meta['title']) ? substr((string) $meta['title'], 0, 200) : '',
            'status_at_save' => isset($meta['status']) ? (string) $meta['status'] : 'draft',
            'note' => isset($meta['note']) ? substr((string) $meta['note'], 0, 200) : '',
            'checksum' => $document->checksum(),
            'is_autosave' => !empty($meta['autosave']) ? 1 : 0,
            'is_published_snapshot' => !empty($meta['published']) ? 1 : 0,
            'author_id' => isset($meta['admin_id']) ? (int) $meta['admin_id'] : 0,
            'created_at' => date('Y-m-d H:i:s'),
        );
        return (int) Capsule::table(self::REVISIONS)->insertGetId($record);
    }

    public function revisions($pageId, $limit = 30)
    {
        $rows = Capsule::table(self::REVISIONS)->where('page_id', (int) $pageId)
            ->orderBy('revision_no', 'desc')->limit(max(1, min(200, (int) $limit)))->get();
        $revisions = array();
        foreach ($rows as $row) { $revisions[] = $this->hydrateRevision($row); }
        return $revisions;
    }

    public function revision($id)
    {
        $row = Capsule::table(self::REVISIONS)->where('id', (int) $id)->first();
        return $row ? $this->hydrateRevision($row) : null;
    }

    public function latestRevision($pageId)
    {
        $row = Capsule::table(self::REVISIONS)->where('page_id', (int) $pageId)
            ->orderBy('revision_no', 'desc')->first();
        return $row ? $this->hydrateRevision($row) : null;
    }

    /**
     * Trim revision history.
     *
     * Published snapshots are never pruned: they are the only record of what a
     * visitor actually saw, so they stay until the page itself is deleted.
     */
    public function pruneRevisions($pageId, $keep = 30)
    {
        $keep = max(5, min(200, (int) $keep));
        $rows = Capsule::table(self::REVISIONS)->where('page_id', (int) $pageId)
            ->where('is_published_snapshot', 0)
            ->orderBy('revision_no', 'desc')->get();
        $removed = 0;
        $index = 0;
        foreach ($rows as $row) {
            $index++;
            if ($index <= $keep) { continue; }
            Capsule::table(self::REVISIONS)->where('id', (int) $row->id)->delete();
            $removed++;
        }
        return $removed;
    }

    /* -------------------------------------------------------- preview tokens */

    /**
     * Issue a short-lived draft preview link.
     *
     * The plain token is returned once, to the administrator who asked for it;
     * only its SHA-256 is stored. An expired or unknown token means the draft
     * is simply not visible.
     */
    public function issuePreviewToken($pageId, $adminId, $ttl = self::PREVIEW_TTL_SECONDS)
    {
        $token = Ids::token(32);
        Capsule::table(self::TOKENS)->insert(array(
            'page_id' => (int) $pageId,
            'part_key' => '',
            'token_hash' => Ids::fingerprint($token),
            'expires_at' => date('Y-m-d H:i:s', time() + max(60, min(86400, (int) $ttl))),
            'created_by' => (int) $adminId,
            'created_at' => date('Y-m-d H:i:s'),
        ));
        return $token;
    }

    public function verifyPreviewToken($pageId, $token)
    {
        if (!is_string($token) || strlen($token) < 32) { return false; }
        $row = Capsule::table(self::TOKENS)
            ->where('page_id', (int) $pageId)
            ->where('token_hash', Ids::fingerprint($token))
            ->first();
        if (!$row) { return false; }
        $expires = isset($row->expires_at) ? strtotime((string) $row->expires_at) : 0;
        return $expires > time();
    }

    public function purgeExpiredTokens()
    {
        return (int) Capsule::table(self::TOKENS)->where('expires_at', '<', date('Y-m-d H:i:s'))->delete();
    }

    /* --------------------------------------------------------------- shaping */

    /** Only known columns are ever written. */
    private function columns(array $data)
    {
        $allowed = array(
            'slug' => 'string', 'title' => 'string', 'status' => 'status', 'visibility' => 'visibility',
            'template_key' => 'string', 'seo_title' => 'string', 'meta_description' => 'string',
            'meta_robots' => 'string', 'canonical_url' => 'string', 'header_part' => 'string',
            'footer_part' => 'string', 'featured_media_id' => 'int', 'og_media_id' => 'int',
            'publish_at' => 'datetime', 'document_json' => 'raw', 'is_home' => 'bool',
        );
        $record = array();
        foreach ($allowed as $column => $kind) {
            if (!array_key_exists($column, $data)) { continue; }
            $value = $data[$column];
            switch ($kind) {
                case 'int': $record[$column] = (int) $value; break;
                case 'bool': $record[$column] = empty($value) ? 0 : 1; break;
                case 'status': $record[$column] = in_array($value, self::STATUSES, true) ? $value : 'draft'; break;
                case 'visibility': $record[$column] = in_array($value, self::VISIBILITIES, true) ? $value : 'public'; break;
                case 'datetime': $record[$column] = $value === null || $value === '' ? null : (string) $value; break;
                default: $record[$column] = (string) $value;
            }
        }
        if (isset($record['slug']) && !Slug::isValid($record['slug'])) {
            throw BuilderException::validation('"' . htmlspecialchars((string) $record['slug'], ENT_QUOTES, 'UTF-8') . '" is not a usable page address.');
        }
        return $record;
    }

    protected function hydrate($row)
    {
        return array(
            'id' => (int) $row->id,
            'slug' => (string) $row->slug,
            'title' => (string) $row->title,
            'status' => (string) $row->status,
            'visibility' => (string) $row->visibility,
            'template_key' => (string) $row->template_key,
            'document_json' => isset($row->document_json) ? (string) $row->document_json : '',
            'published_json' => isset($row->published_json) ? (string) $row->published_json : '',
            'published_revision_id' => (int) $row->published_revision_id,
            'schema_version' => (int) $row->schema_version,
            'seo_title' => (string) $row->seo_title,
            'meta_description' => (string) $row->meta_description,
            'meta_robots' => (string) $row->meta_robots,
            'canonical_url' => (string) $row->canonical_url,
            'featured_media_id' => (int) $row->featured_media_id,
            'og_media_id' => (int) $row->og_media_id,
            'header_part' => (string) $row->header_part,
            'footer_part' => (string) $row->footer_part,
            'is_home' => !empty($row->is_home),
            'draft_checksum' => (string) $row->draft_checksum,
            'published_checksum' => (string) $row->published_checksum,
            'publish_at' => $row->publish_at ? (string) $row->publish_at : '',
            'published_at' => $row->published_at ? (string) $row->published_at : '',
            'created_by' => (int) $row->created_by,
            'updated_by' => (int) $row->updated_by,
            'created_at' => $row->created_at ? (string) $row->created_at : '',
            'updated_at' => $row->updated_at ? (string) $row->updated_at : '',
            'has_unpublished_changes' => (string) $row->draft_checksum !== (string) $row->published_checksum,
        );
    }

    protected function hydrateRevision($row)
    {
        return array(
            'id' => (int) $row->id,
            'page_id' => (int) $row->page_id,
            'part_key' => (string) $row->part_key,
            'revision_no' => (int) $row->revision_no,
            'document_json' => isset($row->document_json) ? (string) $row->document_json : '',
            'title' => (string) $row->title,
            'status_at_save' => (string) $row->status_at_save,
            'note' => (string) $row->note,
            'checksum' => (string) $row->checksum,
            'is_autosave' => !empty($row->is_autosave),
            'is_published_snapshot' => !empty($row->is_published_snapshot),
            'author_id' => (int) $row->author_id,
            'created_at' => $row->created_at ? (string) $row->created_at : '',
        );
    }
}
