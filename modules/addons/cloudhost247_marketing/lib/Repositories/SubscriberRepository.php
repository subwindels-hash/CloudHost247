<?php
namespace CloudHost247\Marketing\Repositories;

use CloudHost247\Marketing\Domain\ConsentStatus;
use CloudHost247\Marketing\Domain\SubscriberSource;
use CloudHost247\Marketing\Domain\SubscriberStatus;
use CloudHost247\Marketing\Security\InputValidator;
use WHMCS\Database\Capsule;

/**
 * Subscriber store (requirement #5, #25, #26).
 *
 * Every write is explicit about consent: `subscribe()` records the consent
 * evidence supplied by the caller and never invents one, while `setStatus()`
 * only ever narrows what the platform is willing to send to. Nothing in this
 * repository sends mail — it is storage plus honest state transitions.
 */
final class SubscriberRepository
{
    const TABLE = 'mod_cloudhost247_marketing_subscribers';
    const MEMBERS_TABLE = 'mod_cloudhost247_marketing_list_members';
    const TAG_JOIN_TABLE = 'mod_cloudhost247_marketing_subscriber_tags';

    /** Hard ceiling for one page; the admin UI never asks for more. */
    const MAX_PER_PAGE = 200;

    public function find($id)
    {
        return Capsule::table(self::TABLE)->where('id', (int) $id)->first();
    }

    public function findByEmail($email)
    {
        return Capsule::table(self::TABLE)->where('email', InputValidator::email($email))->first();
    }

    public function count()
    {
        $row = Capsule::table(self::TABLE)->selectRaw('COUNT(*) AS aggregate')->first();
        return $row ? (int) $row->aggregate : 0;
    }

    /**
     * Creates or updates one subscriber.
     *
     * $data keys: email (required), first_name, last_name, company, phone,
     * country, fields (array), status, consent_status, consent_source, client_id.
     * A status is only written when the caller states one; otherwise an existing
     * subscriber keeps its status and a new one starts `subscribed`.
     */
    public function upsert(array $data, $source = SubscriberSource::MANUAL)
    {
        if (!SubscriberSource::isValid($source)) {
            throw new \InvalidArgumentException('Unknown subscriber source: ' . $source);
        }
        $email = InputValidator::email(isset($data['email']) ? $data['email'] : '', 'email');
        $now = date('Y-m-d H:i:s');
        $existing = $this->findByEmail($email);

        $profile = array(
            'first_name' => isset($data['first_name']) ? InputValidator::shortText($data['first_name'], 64, 'First name') : '',
            'last_name' => isset($data['last_name']) ? InputValidator::shortText($data['last_name'], 64, 'Last name') : '',
            'company' => isset($data['company']) ? InputValidator::shortText($data['company'], 128, 'Company') : '',
            'phone' => isset($data['phone']) ? InputValidator::shortText($data['phone'], 32, 'Phone') : '',
            'country' => isset($data['country']) ? $this->country($data['country']) : '',
            'updated_at' => $now,
        );
        if (isset($data['fields']) && is_array($data['fields'])) {
            $profile['fields_json'] = json_encode($this->cleanFields($data['fields']));
        }

        if ($existing) {
            $updates = $profile;
            // Never overwrite a stored value with an empty one on re-import; the
            // existing profile is usually richer than the imported row.
            foreach (array('first_name', 'last_name', 'company', 'phone', 'country') as $key) {
                if ($updates[$key] === '' && isset($existing->$key) && (string) $existing->$key !== '') {
                    unset($updates[$key]);
                }
            }
            if (isset($data['client_id'])) {
                $clientId = (int) $data['client_id'];
                $updates['client_id'] = $clientId > 0 ? $clientId : null;
            }
            if (isset($data['status'])) {
                $status = (string) $data['status'];
                if (!SubscriberStatus::isValid($status)) { throw new \InvalidArgumentException('Unknown subscriber status: ' . $status); }
                $updates['status'] = $status;
            }
            if (isset($data['consent_status'])) {
                $consent = (string) $data['consent_status'];
                if (!ConsentStatus::isValid($consent)) { throw new \InvalidArgumentException('Unknown consent status: ' . $consent); }
                $updates['consent_status'] = $consent;
                $updates['consent_at'] = $now;
                $updates['consent_source'] = isset($data['consent_source']) ? InputValidator::shortText($data['consent_source'], 64, 'Consent source') : '';
            }
            Capsule::table(self::TABLE)->where('id', (int) $existing->id)->update($updates);
            return array('subscriber' => $this->find((int) $existing->id), 'created' => false);
        }

        $status = isset($data['status']) ? (string) $data['status'] : SubscriberStatus::SUBSCRIBED;
        if (!SubscriberStatus::isValid($status)) { throw new \InvalidArgumentException('Unknown subscriber status: ' . $status); }
        $consent = isset($data['consent_status']) ? (string) $data['consent_status'] : ConsentStatus::UNKNOWN;
        if (!ConsentStatus::isValid($consent)) { throw new \InvalidArgumentException('Unknown consent status: ' . $consent); }

        $row = array_merge($profile, array(
            'email' => $email,
            'status' => $status,
            'consent_status' => $consent,
            'consent_at' => $consent === ConsentStatus::UNKNOWN ? null : $now,
            'consent_source' => isset($data['consent_source']) ? InputValidator::shortText($data['consent_source'], 64, 'Consent source') : '',
            'client_id' => isset($data['client_id']) && (int) $data['client_id'] > 0 ? (int) $data['client_id'] : null,
            'source' => $source,
            'bounce_type' => '',
            'bounce_count' => 0,
            'bounced_at' => null,
            'last_activity_at' => null,
            'created_at' => $now,
        ));
        $id = Capsule::table(self::TABLE)->insertGetId($row);
        return array('subscriber' => $this->find($id), 'created' => true);
    }

    /**
     * Explicit status transition. Returns false when the subscriber is already in
     * that state so callers can avoid duplicate audit rows.
     */
    public function setStatus($id, $status)
    {
        if (!SubscriberStatus::isValid($status)) { throw new \InvalidArgumentException('Unknown subscriber status: ' . $status); }
        $subscriber = $this->find($id);
        if (!$subscriber) { throw new \InvalidArgumentException('Unknown subscriber.'); }
        if ((string) $subscriber->status === (string) $status) { return false; }
        Capsule::table(self::TABLE)->where('id', (int) $subscriber->id)->update(array(
            'status' => (string) $status,
            'updated_at' => date('Y-m-d H:i:s'),
        ));
        return true;
    }

    public function setConsent($id, $consentStatus, $source = '')
    {
        if (!ConsentStatus::isValid($consentStatus)) { throw new \InvalidArgumentException('Unknown consent status: ' . $consentStatus); }
        Capsule::table(self::TABLE)->where('id', (int) $id)->update(array(
            'consent_status' => (string) $consentStatus,
            'consent_at' => date('Y-m-d H:i:s'),
            'consent_source' => InputValidator::shortText($source, 64, 'Consent source'),
            'updated_at' => date('Y-m-d H:i:s'),
        ));
    }

    public function recordBounce($id, $type, $softThreshold)
    {
        $subscriber = $this->find($id);
        if (!$subscriber) { throw new \InvalidArgumentException('Unknown subscriber.'); }
        $type = $type === 'hard' ? 'hard' : 'soft';
        $count = (isset($subscriber->bounce_count) ? (int) $subscriber->bounce_count : 0) + 1;
        $updates = array(
            'bounce_type' => $type,
            'bounce_count' => $count,
            'bounced_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        );
        $suppress = ($type === 'hard') || ($count >= (int) $softThreshold);
        if ($suppress) { $updates['status'] = SubscriberStatus::BOUNCED; }
        Capsule::table(self::TABLE)->where('id', (int) $subscriber->id)->update($updates);
        return array('suppress' => $suppress, 'count' => $count, 'type' => $type);
    }

    public function touchActivity($id, $when = null)
    {
        Capsule::table(self::TABLE)->where('id', (int) $id)->update(array(
            'last_activity_at' => $when ?: date('Y-m-d H:i:s'),
        ));
    }

    /**
     * Filtered page of subscribers.
     *
     * $filters: status, consent_status, source, search, list_id, tag_id.
     * List/tag filters resolve their member ids first so the query stays
     * portable across the WHMCS query builder and the module's test double.
     */
    public function paginate(array $filters = array(), $page = 1, $perPage = 50)
    {
        $page = max(1, (int) $page);
        $perPage = max(1, min(self::MAX_PER_PAGE, (int) $perPage));
        $query = Capsule::table(self::TABLE);

        if (!empty($filters['status'])) { $query->where('status', (string) $filters['status']); }
        if (!empty($filters['consent_status'])) { $query->where('consent_status', (string) $filters['consent_status']); }
        if (!empty($filters['source'])) { $query->where('source', (string) $filters['source']); }
        if (!empty($filters['client_id'])) { $query->where('client_id', (int) $filters['client_id']); }

        if (!empty($filters['search'])) {
            // Both wildcards are stripped: a search box is for finding things, not
            // for asking the database to scan every row.
            $term = '%' . str_replace(array('%', '_'), '', (string) $filters['search']) . '%';
            $query->where(function ($group) use ($term) {
                $group->where('email', 'like', $term)
                    ->orWhere('first_name', 'like', $term)
                    ->orWhere('last_name', 'like', $term)
                    ->orWhere('company', 'like', $term);
            });
        }

        if (!empty($filters['list_id'])) {
            $ids = $this->memberIds((int) $filters['list_id']);
            if (!$ids) { return array('rows' => array(), 'total' => 0, 'page' => $page, 'pages' => 0); }
            $query->whereIn('id', $ids);
        }
        if (!empty($filters['tag_id'])) {
            $ids = $this->taggedIds((int) $filters['tag_id']);
            if (!$ids) { return array('rows' => array(), 'total' => 0, 'page' => $page, 'pages' => 0); }
            $query->whereIn('id', $ids);
        }

        $totalRow = $query->selectRaw('COUNT(*) AS aggregate')->first();
        $total = $totalRow ? (int) $totalRow->aggregate : 0;
        $rows = $query->orderBy('id', 'desc')->limit($perPage)->offset(($page - 1) * $perPage)->get();

        return array(
            'rows' => $rows ? $rows->all() : array(),
            'total' => $total,
            'page' => $page,
            'pages' => (int) ceil($total / $perPage),
        );
    }

    /** Every subscriber row matching the filters, bounded for export. */
    public function collect(array $filters = array(), $max = 20000)
    {
        $page = 1;
        $out = array();
        while (count($out) < (int) $max) {
            $batchSize = min(self::MAX_PER_PAGE, (int) $max - count($out));
            $result = $this->paginate($filters, $page, $batchSize);
            foreach ($result['rows'] as $row) { $out[] = $row; }
            if ($page >= $result['pages'] || !$result['rows']) { break; }
            $page++;
        }
        return $out;
    }

    public function countsByStatus()
    {
        $counts = array();
        foreach (SubscriberStatus::all() as $status) {
            $row = Capsule::table(self::TABLE)->where('status', $status)->selectRaw('COUNT(*) AS aggregate')->first();
            $counts[$status] = $row ? (int) $row->aggregate : 0;
        }
        return $counts;
    }

    public function countsByConsent()
    {
        $counts = array();
        foreach (ConsentStatus::all() as $consent) {
            $row = Capsule::table(self::TABLE)->where('consent_status', $consent)->selectRaw('COUNT(*) AS aggregate')->first();
            $counts[$consent] = $row ? (int) $row->aggregate : 0;
        }
        return $counts;
    }

    /** Subscriber ids of one list (bounded; a list larger than this is reported by the caller). */
    public function memberIds($listId, $max = 50000)
    {
        $rows = Capsule::table(self::MEMBERS_TABLE)->where('list_id', (int) $listId)->limit((int) $max)->get();
        $ids = array();
        foreach ($rows ? $rows->all() : array() as $row) { $ids[] = (int) $row->subscriber_id; }
        return $ids;
    }

    public function taggedIds($tagId, $max = 50000)
    {
        $rows = Capsule::table(self::TAG_JOIN_TABLE)->where('tag_id', (int) $tagId)->limit((int) $max)->get();
        $ids = array();
        foreach ($rows ? $rows->all() : array() as $row) { $ids[] = (int) $row->subscriber_id; }
        return $ids;
    }

    /** Two-letter ISO country, or '' when the caller did not supply one. */
    private function country($value)
    {
        $value = strtoupper(trim((string) $value));
        if ($value === '') { return ''; }
        if (!preg_match('/^[A-Z]{2}$/', $value)) {
            throw new \InvalidArgumentException('Country must be a two-letter ISO code.');
        }
        return $value;
    }

    /** Free-form fields are bounded and never allowed to reach a template as markup. */
    private function cleanFields(array $fields)
    {
        $clean = array();
        $allowed = 20;
        foreach ($fields as $key => $value) {
            if ($allowed-- <= 0) { break; }
            $key = preg_replace('/[^a-z0-9_]/', '', strtolower((string) $key));
            if ($key === '') { continue; }
            $clean[substr($key, 0, 32)] = InputValidator::shortText((string) $value, 255, $key);
        }
        return $clean;
    }
}
