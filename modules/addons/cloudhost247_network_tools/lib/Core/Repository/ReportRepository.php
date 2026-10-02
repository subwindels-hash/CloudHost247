<?php
namespace CloudHost247\NetworkTools\Core\Repository;

/**
 * Saved diagnostic reports (docs section 77).
 *
 * A report stores the same non-sensitive summary a support ticket would carry:
 * tool, target label, status, result code and the tool's own result payload
 * after the module's redaction pass. Report payloads are visible only to the
 * customer who created them (every query is scoped by client_id).
 */
final class ReportRepository extends Repository
{
    const TABLE = 'reports';

    public function create($clientId, $toolSlug, $targetLabel, array $payload, $title = '')
    {
        if (!$this->has(self::TABLE)) {
            return 0;
        }
        $safe = $this->redact($payload);
        $this->table(self::TABLE)->insert(array(
            'client_id' => (int) $clientId,
            'tool_slug' => substr((string) $toolSlug, 0, 96),
            'target_label' => substr((string) $targetLabel, 0, 191),
            'title' => substr((string) $title, 0, 191),
            'status' => substr((string) (isset($payload['status']) ? $payload['status'] : 'recorded'), 0, 32),
            'result_code' => substr((string) (isset($payload['code']) ? $payload['code'] : 'OK'), 0, 48),
            'payload_json' => $this->encode($safe),
            'created_at' => $this->now(),
            'updated_at' => $this->now(),
        ));
        return (int) $this->table(self::TABLE)->max('id');
    }

    public function all($clientId)
    {
        if (!$this->has(self::TABLE)) {
            return array();
        }
        return $this->table(self::TABLE)->where('client_id', (int) $clientId)->orderBy('id', 'desc')->limit(200)->get()->all();
    }

    public function find($clientId, $id)
    {
        if (!$this->has(self::TABLE)) {
            return null;
        }
        return $this->table(self::TABLE)->where('client_id', (int) $clientId)->where('id', (int) $id)->first();
    }

    public function delete($clientId, $id)
    {
        if (!$this->has(self::TABLE)) {
            return false;
        }
        return (bool) $this->table(self::TABLE)->where('client_id', (int) $clientId)->where('id', (int) $id)->delete();
    }

    public function retention($clientId, $keep)
    {
        $ids = $this->table(self::TABLE)->where('client_id', (int) $clientId)->orderBy('id', 'desc')->skip(max(1, (int) $keep))->take(500)->pluck('id');
        if ($ids) {
            $this->table(self::TABLE)->whereIn('id', (array) $ids)->delete();
        }
    }
}
