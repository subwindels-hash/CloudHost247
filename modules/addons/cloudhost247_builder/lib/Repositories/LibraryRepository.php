<?php
namespace CloudHost247\Builder\Repositories;

use CloudHost247\Builder\Schema\Document;
use CloudHost247\Builder\Support\BuilderException;
use CloudHost247\Builder\Support\Ids;
use WHMCS\Database\Capsule;

/**
 * Reusable templates, theme parts, navigation menus and builder settings.
 *
 * Theme parts follow the same draft/published split as pages: editing a header
 * never changes what visitors see until it is published. Templates store a
 * validated document plus a checksum so an import can be verified against what
 * was exported.
 */
class LibraryRepository
{
    const TEMPLATES = 'mod_cloudhost247_builder_templates';
    const PARTS = 'mod_cloudhost247_builder_parts';
    const MENUS = 'mod_cloudhost247_builder_menus';
    const SETTINGS = 'mod_cloudhost247_builder_settings';

    const TEMPLATE_CATEGORIES = array('page', 'section', 'header', 'footer', 'hero', 'pricing', 'contact', 'landing');
    const PART_TYPES = array(
        'header' => 'Global header',
        'footer' => 'Global footer',
        'homepage' => 'Homepage layout',
        'landing' => 'Landing page layout',
        'blog' => 'Blog layout',
        'archive' => 'Archive layout',
        'service' => 'Service page layout',
        'error404' => 'Error page (404)',
        'auth_banner' => 'Login and registration banner',
    );
    const PART_STATUSES = array('draft', 'published', 'disabled');

    /* ------------------------------------------------------------ templates */

    public function templates($category = '')
    {
        $query = Capsule::table(self::TEMPLATES);
        if ($category !== '' && in_array($category, self::TEMPLATE_CATEGORIES, true)) {
            $query->where('category', $category);
        }
        $rows = $query->orderBy('category')->orderBy('name')->get();
        $templates = array();
        foreach ($rows as $row) { $templates[] = $this->hydrateTemplate($row); }
        return $templates;
    }

    public function template($id)
    {
        $row = Capsule::table(self::TEMPLATES)->where('id', (int) $id)->first();
        return $row ? $this->hydrateTemplate($row) : null;
    }

    public function templateByKey($key)
    {
        $row = Capsule::table(self::TEMPLATES)->where('template_key', (string) $key)->first();
        return $row ? $this->hydrateTemplate($row) : null;
    }

    public function saveTemplate(array $data, Document $document, $adminId)
    {
        $key = isset($data['template_key']) ? (string) $data['template_key'] : '';
        if (!Ids::isKey($key)) {
            throw BuilderException::validation('A template key may contain lowercase letters, numbers, hyphen and underscore.');
        }
        $category = isset($data['category']) && in_array($data['category'], self::TEMPLATE_CATEGORIES, true)
            ? $data['category'] : 'section';
        $now = date('Y-m-d H:i:s');
        $record = array(
            'name' => substr((string) (isset($data['name']) ? $data['name'] : $key), 0, 160),
            'category' => $category,
            'description' => substr((string) (isset($data['description']) ? $data['description'] : ''), 0, 300),
            'document_json' => $document->toJson(),
            'checksum' => $document->checksum(),
            'is_builtin' => !empty($data['is_builtin']) ? 1 : 0,
            'updated_at' => $now,
        );
        $existing = Capsule::table(self::TEMPLATES)->where('template_key', $key)->first();
        if ($existing) {
            Capsule::table(self::TEMPLATES)->where('id', (int) $existing->id)->update($record);
            return (int) $existing->id;
        }
        $record['template_key'] = $key;
        $record['created_by'] = (int) $adminId;
        $record['created_at'] = $now;
        return (int) Capsule::table(self::TEMPLATES)->insertGetId($record);
    }

    public function deleteTemplate($id)
    {
        return (int) Capsule::table(self::TEMPLATES)->where('id', (int) $id)->where('is_builtin', 0)->delete();
    }

    /* ---------------------------------------------------------- theme parts */

    public function parts($type = '')
    {
        $query = Capsule::table(self::PARTS);
        if ($type !== '' && isset(self::PART_TYPES[$type])) { $query->where('part_type', $type); }
        $rows = $query->orderBy('part_type')->orderBy('priority')->orderBy('id')->get();
        $parts = array();
        foreach ($rows as $row) { $parts[] = $this->hydratePart($row); }
        return $parts;
    }

    public function part($id)
    {
        $row = Capsule::table(self::PARTS)->where('id', (int) $id)->first();
        return $row ? $this->hydratePart($row) : null;
    }

    public function partByKey($key)
    {
        $row = Capsule::table(self::PARTS)->where('part_key', (string) $key)->first();
        return $row ? $this->hydratePart($row) : null;
    }

    /** Published parts of one type, most specific first. */
    public function publishedParts($type)
    {
        $rows = Capsule::table(self::PARTS)->where('part_type', (string) $type)->where('status', 'published')
            ->orderBy('priority')->orderBy('id')->get();
        $parts = array();
        foreach ($rows as $row) { $parts[] = $this->hydratePart($row); }
        return $parts;
    }

    public function createPart(array $data, $adminId)
    {
        $key = isset($data['part_key']) ? (string) $data['part_key'] : '';
        if (!Ids::isKey($key)) {
            throw BuilderException::validation('A part key may contain lowercase letters, numbers, hyphen and underscore.');
        }
        if ($this->partByKey($key)) {
            throw BuilderException::conflict('A theme part with the key "' . htmlspecialchars($key, ENT_QUOTES, 'UTF-8') . '" already exists.');
        }
        $now = date('Y-m-d H:i:s');
        $document = isset($data['document']) && $data['document'] instanceof Document ? $data['document'] : Document::blank();
        return (int) Capsule::table(self::PARTS)->insertGetId(array(
            'part_key' => $key,
            'name' => substr((string) (isset($data['name']) ? $data['name'] : $key), 0, 160),
            'part_type' => isset($data['part_type']) && isset(self::PART_TYPES[$data['part_type']]) ? $data['part_type'] : 'header',
            'document_json' => $document->toJson(),
            'published_json' => null,
            'status' => 'draft',
            'conditions_json' => json_encode(isset($data['conditions']) && is_array($data['conditions']) ? $data['conditions'] : array('rule' => 'all')),
            'priority' => isset($data['priority']) ? max(1, min(999, (int) $data['priority'])) : 10,
            'draft_checksum' => $document->checksum(),
            'published_checksum' => '',
            'updated_by' => (int) $adminId,
            'created_at' => $now,
            'updated_at' => $now,
        ));
    }

    public function savePartDraft($id, Document $document, $adminId)
    {
        Capsule::table(self::PARTS)->where('id', (int) $id)->update(array(
            'document_json' => $document->toJson(),
            'draft_checksum' => $document->checksum(),
            'updated_by' => (int) $adminId,
            'updated_at' => date('Y-m-d H:i:s'),
        ));
        return $this->part($id);
    }

    public function updatePart($id, array $data, $adminId)
    {
        $record = array('updated_by' => (int) $adminId, 'updated_at' => date('Y-m-d H:i:s'));
        if (isset($data['name'])) { $record['name'] = substr((string) $data['name'], 0, 160); }
        if (isset($data['part_type']) && isset(self::PART_TYPES[$data['part_type']])) { $record['part_type'] = $data['part_type']; }
        if (isset($data['priority'])) { $record['priority'] = max(1, min(999, (int) $data['priority'])); }
        if (isset($data['conditions']) && is_array($data['conditions'])) { $record['conditions_json'] = json_encode($data['conditions']); }
        if (isset($data['status']) && in_array($data['status'], self::PART_STATUSES, true)) { $record['status'] = $data['status']; }
        Capsule::table(self::PARTS)->where('id', (int) $id)->update($record);
        return $this->part($id);
    }

    public function publishPart($id, Document $document, $adminId)
    {
        $now = date('Y-m-d H:i:s');
        Capsule::table(self::PARTS)->where('id', (int) $id)->update(array(
            'published_json' => $document->toJson(),
            'published_checksum' => $document->checksum(),
            'status' => 'published',
            'published_at' => $now,
            'updated_by' => (int) $adminId,
            'updated_at' => $now,
        ));
        return $this->part($id);
    }

    public function deletePart($id)
    {
        return (int) Capsule::table(self::PARTS)->where('id', (int) $id)->delete();
    }

    /* ---------------------------------------------------------------- menus */

    public function menus()
    {
        $rows = Capsule::table(self::MENUS)->orderBy('name')->get();
        $menus = array();
        foreach ($rows as $row) { $menus[] = $this->hydrateMenu($row); }
        return $menus;
    }

    public function menu($id)
    {
        $row = Capsule::table(self::MENUS)->where('id', (int) $id)->first();
        return $row ? $this->hydrateMenu($row) : null;
    }

    public function menuByKey($key)
    {
        $row = Capsule::table(self::MENUS)->where('menu_key', (string) $key)->first();
        return $row ? $this->hydrateMenu($row) : null;
    }

    public function saveMenu(array $data, array $items, $adminId)
    {
        $key = isset($data['menu_key']) ? (string) $data['menu_key'] : '';
        if (!Ids::isKey($key)) {
            throw BuilderException::validation('A menu key may contain lowercase letters, numbers, hyphen and underscore.');
        }
        $now = date('Y-m-d H:i:s');
        $record = array(
            'name' => substr((string) (isset($data['name']) ? $data['name'] : $key), 0, 160),
            'items_json' => json_encode($items),
            'updated_by' => (int) $adminId,
            'updated_at' => $now,
        );
        $existing = Capsule::table(self::MENUS)->where('menu_key', $key)->first();
        if ($existing) {
            Capsule::table(self::MENUS)->where('id', (int) $existing->id)->update($record);
            return (int) $existing->id;
        }
        $record['menu_key'] = $key;
        $record['created_at'] = $now;
        return (int) Capsule::table(self::MENUS)->insertGetId($record);
    }

    public function deleteMenu($id)
    {
        return (int) Capsule::table(self::MENUS)->where('id', (int) $id)->delete();
    }

    /* ------------------------------------------------------------- settings */

    public function settings()
    {
        $settings = array();
        try {
            foreach (Capsule::table(self::SETTINGS)->get() as $row) {
                $settings[(string) $row->setting_key] = (string) $row->setting_value;
            }
        } catch (\Throwable $unavailable) {
            return array();
        }
        return $settings;
    }

    public function setting($key, $default = '')
    {
        $row = Capsule::table(self::SETTINGS)->where('setting_key', (string) $key)->first();
        return $row ? (string) $row->setting_value : $default;
    }

    public function saveSetting($key, $value, $adminId)
    {
        Capsule::table(self::SETTINGS)->updateOrInsert(
            array('setting_key' => (string) $key),
            array(
                'setting_value' => (string) $value,
                'value_type' => 'string',
                'updated_by' => (int) $adminId,
                'updated_at' => date('Y-m-d H:i:s'),
            )
        );
        return true;
    }

    /* -------------------------------------------------------------- shaping */

    protected function hydrateTemplate($row)
    {
        return array(
            'id' => (int) $row->id,
            'template_key' => (string) $row->template_key,
            'name' => (string) $row->name,
            'category' => (string) $row->category,
            'description' => (string) $row->description,
            'document_json' => isset($row->document_json) ? (string) $row->document_json : '',
            'checksum' => (string) $row->checksum,
            'is_builtin' => !empty($row->is_builtin),
            'created_by' => (int) $row->created_by,
            'created_at' => $row->created_at ? (string) $row->created_at : '',
            'updated_at' => $row->updated_at ? (string) $row->updated_at : '',
        );
    }

    protected function hydratePart($row)
    {
        $conditions = json_decode(isset($row->conditions_json) ? (string) $row->conditions_json : '', true);
        return array(
            'id' => (int) $row->id,
            'part_key' => (string) $row->part_key,
            'name' => (string) $row->name,
            'part_type' => (string) $row->part_type,
            'document_json' => isset($row->document_json) ? (string) $row->document_json : '',
            'published_json' => isset($row->published_json) ? (string) $row->published_json : '',
            'status' => (string) $row->status,
            'conditions' => is_array($conditions) ? $conditions : array('rule' => 'all'),
            'priority' => (int) $row->priority,
            'draft_checksum' => (string) $row->draft_checksum,
            'published_checksum' => (string) $row->published_checksum,
            'has_unpublished_changes' => (string) $row->draft_checksum !== (string) $row->published_checksum,
            'updated_by' => (int) $row->updated_by,
            'published_at' => $row->published_at ? (string) $row->published_at : '',
            'updated_at' => $row->updated_at ? (string) $row->updated_at : '',
        );
    }

    protected function hydrateMenu($row)
    {
        $items = json_decode(isset($row->items_json) ? (string) $row->items_json : '', true);
        return array(
            'id' => (int) $row->id,
            'menu_key' => (string) $row->menu_key,
            'name' => (string) $row->name,
            'items' => is_array($items) ? $items : array(),
            'updated_at' => $row->updated_at ? (string) $row->updated_at : '',
        );
    }
}
