<?php
namespace CloudHost247\Marketing\Repositories;

use CloudHost247\Marketing\Security\InputValidator;
use WHMCS\Database\Capsule;

/**
 * Template library store (requirement #9).
 *
 * A template keeps the block design, the rendered HTML and the plain-text
 * alternative together, so what an operator previews is byte-for-byte what a
 * campaign copies. Builtin templates are created by the module and can be
 * archived but never deleted; operator-created templates can be deleted while
 * un-used, and archived otherwise — a sent campaign keeps its own copy anyway.
 */
final class TemplateRepository
{
    const TABLE = 'mod_cloudhost247_marketing_templates';
    const STATUSES = array('active', 'archived');

    public function find($id)
    {
        return Capsule::table(self::TABLE)->where('id', (int) $id)->first();
    }

    public function findByKey($key)
    {
        return Capsule::table(self::TABLE)->where('template_key', InputValidator::key($key, 'Template key'))->first();
    }

    public function all($status = null)
    {
        $query = Capsule::table(self::TABLE);
        if ($status !== null) { $query->where('status', (string) $status); }
        return $query->orderBy('name', 'asc')->get()->all();
    }

    public function count($status = null)
    {
        $query = Capsule::table(self::TABLE);
        if ($status !== null) { $query->where('status', (string) $status); }
        $row = $query->selectRaw('COUNT(*) AS aggregate')->first();
        return $row ? (int) $row->aggregate : 0;
    }

    public function create(array $input)
    {
        $key = InputValidator::key(isset($input['template_key']) ? $input['template_key'] : '', 'Template key');
        if ($this->findByKey($key)) { throw new \InvalidArgumentException('A template with that key already exists.'); }
        $now = date('Y-m-d H:i:s');
        $source = isset($input['source']) ? (string) $input['source'] : 'custom';
        if (!in_array($source, array('builtin', 'custom'), true)) { throw new \InvalidArgumentException('Unknown template source.'); }
        $id = Capsule::table(self::TABLE)->insertGetId(array(
            'template_key' => $key,
            'name' => InputValidator::shortText(isset($input['name']) ? $input['name'] : '', 128, 'Template name'),
            'category' => InputValidator::shortText(isset($input['category']) ? $input['category'] : 'general', 32, 'Category'),
            'design_json' => json_encode($input['design']),
            'html' => (string) $input['html'],
            'text' => (string) $input['text'],
            'source' => $source,
            'source_campaign_id' => null,
            'status' => 'active',
            'created_at' => $now,
            'updated_at' => $now,
        ));
        return $this->find($id);
    }

    public function update($id, array $input)
    {
        $template = $this->find($id);
        if (!$template) { throw new \InvalidArgumentException('Unknown template.'); }
        $updates = array('updated_at' => date('Y-m-d H:i:s'));
        if (isset($input['name'])) { $updates['name'] = InputValidator::shortText($input['name'], 128, 'Template name'); }
        if (isset($input['category'])) { $updates['category'] = InputValidator::shortText($input['category'], 32, 'Category'); }
        if (isset($input['design'])) { $updates['design_json'] = json_encode($input['design']); }
        if (isset($input['html'])) { $updates['html'] = (string) $input['html']; }
        if (isset($input['text'])) { $updates['text'] = (string) $input['text']; }
        if (isset($input['status'])) {
            $status = (string) $input['status'];
            if (!in_array($status, self::STATUSES, true)) { throw new \InvalidArgumentException('Unknown template status.'); }
            $updates['status'] = $status;
        }
        Capsule::table(self::TABLE)->where('id', (int) $template->id)->update($updates);
        return $this->find((int) $template->id);
    }

    public function archive($id) { return $this->update($id, array('status' => 'archived')); }

    public function activate($id) { return $this->update($id, array('status' => 'active')); }

    public function delete($id)
    {
        $template = $this->find($id);
        if (!$template) { throw new \InvalidArgumentException('Unknown template.'); }
        if ((string) $template->source === 'builtin') {
            throw new \InvalidArgumentException('Builtin templates can be archived but never deleted.');
        }
        return (int) Capsule::table(self::TABLE)->where('id', (int) $template->id)->delete();
    }

    /** @return array design blocks, or an empty design when unreadable */
    public static function designOf($template)
    {
        if (!$template || !isset($template->design_json)) { return array('blocks' => array()); }
        $decoded = json_decode((string) $template->design_json, true);
        return is_array($decoded) ? $decoded : array('blocks' => array());
    }
}
