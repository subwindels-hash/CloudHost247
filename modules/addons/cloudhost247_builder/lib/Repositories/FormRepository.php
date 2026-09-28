<?php
namespace CloudHost247\Builder\Repositories;

use CloudHost247\Builder\Support\BuilderException;
use CloudHost247\Builder\Support\Ids;
use WHMCS\Database\Capsule;

/**
 * Form definitions and their submissions.
 *
 * Submissions keep only what the visitor typed into declared fields, plus a
 * hashed IP for rate limiting. No raw address, no cookies, no credentials.
 */
class FormRepository
{
    const FORMS = 'mod_cloudhost247_builder_forms';
    const SUBMISSIONS = 'mod_cloudhost247_builder_submissions';

    public function all($enabledOnly = false)
    {
        $query = Capsule::table(self::FORMS);
        if ($enabledOnly) { $query->where('enabled', 1); }
        $rows = $query->orderBy('name')->get();
        $forms = array();
        foreach ($rows as $row) { $forms[] = $this->hydrate($row); }
        return $forms;
    }

    public function find($id)
    {
        $row = Capsule::table(self::FORMS)->where('id', (int) $id)->first();
        return $row ? $this->hydrate($row) : null;
    }

    public function findByKey($key)
    {
        $row = Capsule::table(self::FORMS)->where('form_key', (string) $key)->first();
        return $row ? $this->hydrate($row) : null;
    }

    public function save(array $data, array $fields, array $settings, $adminId)
    {
        $key = isset($data['form_key']) ? (string) $data['form_key'] : '';
        if (!Ids::isKey($key)) {
            throw BuilderException::validation('A form key may contain lowercase letters, numbers, hyphen and underscore.');
        }
        $now = date('Y-m-d H:i:s');
        $record = array(
            'name' => substr((string) (isset($data['name']) ? $data['name'] : $key), 0, 160),
            'fields_json' => json_encode($fields),
            'settings_json' => json_encode($settings),
            'enabled' => empty($data['enabled']) ? 0 : 1,
            'updated_at' => $now,
        );
        $existing = Capsule::table(self::FORMS)->where('form_key', $key)->first();
        if ($existing) {
            Capsule::table(self::FORMS)->where('id', (int) $existing->id)->update($record);
            return (int) $existing->id;
        }
        $record['form_key'] = $key;
        $record['created_by'] = (int) $adminId;
        $record['created_at'] = $now;
        return (int) Capsule::table(self::FORMS)->insertGetId($record);
    }

    public function delete($id)
    {
        Capsule::table(self::SUBMISSIONS)->where('form_id', (int) $id)->delete();
        return (int) Capsule::table(self::FORMS)->where('id', (int) $id)->delete();
    }

    public function setEnabled($id, $enabled)
    {
        Capsule::table(self::FORMS)->where('id', (int) $id)->update(array(
            'enabled' => $enabled ? 1 : 0, 'updated_at' => date('Y-m-d H:i:s'),
        ));
        return $this->find($id);
    }

    /* ---------------------------------------------------------- submissions */

    public function addSubmission(array $record)
    {
        $record['created_at'] = date('Y-m-d H:i:s');
        $id = (int) Capsule::table(self::SUBMISSIONS)->insertGetId($record);
        if (!empty($record['form_id'])) {
            $form = $this->find((int) $record['form_id']);
            if ($form) {
                Capsule::table(self::FORMS)->where('id', (int) $record['form_id'])
                    ->update(array('submission_count' => (int) $form['submission_count'] + 1));
            }
        }
        return $id;
    }

    public function updateSubmission($id, array $record)
    {
        Capsule::table(self::SUBMISSIONS)->where('id', (int) $id)->update($record);
        return true;
    }

    public function submissions($formId = 0, $page = 1, $perPage = 25)
    {
        $query = Capsule::table(self::SUBMISSIONS);
        if ((int) $formId > 0) { $query->where('form_id', (int) $formId); }
        $total = (int) $query->count();
        $perPage = max(1, min(100, (int) $perPage));
        $page = max(1, (int) $page);
        $rows = $query->orderBy('id', 'desc')->limit($perPage)->offset(($page - 1) * $perPage)->get();
        $items = array();
        foreach ($rows as $row) { $items[] = $this->hydrateSubmission($row); }
        return array('rows' => $items, 'total' => $total, 'page' => $page, 'per_page' => $perPage);
    }

    /** Submissions from one hashed IP inside a time window, for rate limiting. */
    public function recentSubmissionCount($ipHash, $seconds = 300)
    {
        if ($ipHash === '') { return 0; }
        $since = date('Y-m-d H:i:s', time() - max(30, (int) $seconds));
        return (int) Capsule::table(self::SUBMISSIONS)
            ->where('ip_hash', (string) $ipHash)
            ->where('created_at', '>=', $since)
            ->count();
    }

    protected function hydrate($row)
    {
        $fields = json_decode(isset($row->fields_json) ? (string) $row->fields_json : '', true);
        $settings = json_decode(isset($row->settings_json) ? (string) $row->settings_json : '', true);
        return array(
            'id' => (int) $row->id,
            'form_key' => (string) $row->form_key,
            'name' => (string) $row->name,
            'fields' => is_array($fields) ? $fields : array(),
            'settings' => is_array($settings) ? $settings : array(),
            'enabled' => !empty($row->enabled),
            'submission_count' => (int) $row->submission_count,
            'created_at' => $row->created_at ? (string) $row->created_at : '',
            'updated_at' => $row->updated_at ? (string) $row->updated_at : '',
        );
    }

    protected function hydrateSubmission($row)
    {
        $payload = json_decode(isset($row->payload_json) ? (string) $row->payload_json : '', true);
        return array(
            'id' => (int) $row->id,
            'form_id' => (int) $row->form_id,
            'page_id' => (int) $row->page_id,
            'payload' => is_array($payload) ? $payload : array(),
            'client_id' => (int) $row->client_id,
            'ticket_id' => (int) $row->ticket_id,
            'status' => (string) $row->status,
            'notify_result' => (string) $row->notify_result,
            'created_at' => $row->created_at ? (string) $row->created_at : '',
        );
    }
}
