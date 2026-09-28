<?php
namespace CloudHost247\Builder\Repositories;

use WHMCS\Database\Capsule;

/**
 * Media library index.
 *
 * The row records where a file was stored, what it was verified to be and who
 * uploaded it. The file itself is written by MediaService, which is the only
 * component allowed to touch the media directory.
 */
class MediaRepository
{
    const TABLE = 'mod_cloudhost247_builder_media';
    const CATEGORIES = array('general', 'logo', 'icon', 'photo', 'video', 'document');

    public function all(array $filters = array(), $page = 1, $perPage = 40)
    {
        $query = Capsule::table(self::TABLE);
        if (!empty($filters['category']) && in_array($filters['category'], self::CATEGORIES, true)) {
            $query->where('category', $filters['category']);
        }
        if (!empty($filters['search'])) {
            $term = '%' . str_replace(array('%', '_'), array('\%', '\_'), (string) $filters['search']) . '%';
            $query->where(function ($inner) use ($term) {
                $inner->where('file_name', 'like', $term)
                    ->orWhere('title', 'like', $term)
                    ->orWhere('alt_text', 'like', $term);
            });
        }
        if (!empty($filters['images_only'])) {
            $query->where('mime', 'like', 'image/%');
        }
        $total = (int) $query->count();
        $perPage = max(1, min(200, (int) $perPage));
        $page = max(1, (int) $page);
        $rows = $query->orderBy('id', 'desc')->limit($perPage)->offset(($page - 1) * $perPage)->get();
        $items = array();
        foreach ($rows as $row) { $items[] = $this->hydrate($row); }
        return array('rows' => $items, 'total' => $total, 'page' => $page, 'per_page' => $perPage);
    }

    public function find($id)
    {
        $row = Capsule::table(self::TABLE)->where('id', (int) $id)->first();
        return $row ? $this->hydrate($row) : null;
    }

    public function findByChecksum($checksum)
    {
        $row = Capsule::table(self::TABLE)->where('checksum', (string) $checksum)->first();
        return $row ? $this->hydrate($row) : null;
    }

    public function insert(array $record)
    {
        $record['created_at'] = date('Y-m-d H:i:s');
        return (int) Capsule::table(self::TABLE)->insertGetId($record);
    }

    public function updateMeta($id, array $data)
    {
        $record = array();
        if (isset($data['alt_text'])) { $record['alt_text'] = substr((string) $data['alt_text'], 0, 250); }
        if (isset($data['title'])) { $record['title'] = substr((string) $data['title'], 0, 200); }
        if (isset($data['category']) && in_array($data['category'], self::CATEGORIES, true)) {
            $record['category'] = $data['category'];
        }
        if (!$record) { return $this->find($id); }
        Capsule::table(self::TABLE)->where('id', (int) $id)->update($record);
        return $this->find($id);
    }

    public function delete($id)
    {
        return (int) Capsule::table(self::TABLE)->where('id', (int) $id)->delete();
    }

    public function totalBytes()
    {
        try {
            return (int) Capsule::table(self::TABLE)->sum('size_bytes');
        } catch (\Throwable $unavailable) {
            return 0;
        }
    }

    protected function hydrate($row)
    {
        return array(
            'id' => (int) $row->id,
            'file_name' => (string) $row->file_name,
            'stored_path' => (string) $row->stored_path,
            'url_path' => (string) $row->url_path,
            'mime' => (string) $row->mime,
            'extension' => (string) $row->extension,
            'size_bytes' => (int) $row->size_bytes,
            'width' => (int) $row->width,
            'height' => (int) $row->height,
            'checksum' => (string) $row->checksum,
            'alt_text' => (string) $row->alt_text,
            'title' => (string) $row->title,
            'category' => (string) $row->category,
            'uploaded_by' => (int) $row->uploaded_by,
            'created_at' => $row->created_at ? (string) $row->created_at : '',
            'is_image' => strncmp((string) $row->mime, 'image/', 6) === 0,
        );
    }
}
