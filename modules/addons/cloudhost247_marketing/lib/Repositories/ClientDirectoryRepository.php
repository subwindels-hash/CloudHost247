<?php
namespace CloudHost247\Marketing\Repositories;

use CloudHost247\Marketing\Domain\SegmentField;
use WHMCS\Database\Capsule;

/**
 * Read-only view of the WHMCS customer record for segmentation (requirement #8).
 *
 * Design rules, all of them deliberate:
 *
 *   1. Only the columns named in `SegmentField` are selected. Password hashes,
 *      tax ids, street addresses and custom fields never leave the database.
 *   2. Lookups are batched by e-mail, because the marketing subscriber table is
 *      keyed by e-mail while WHMCS customers are keyed by id. No arbitrary join
 *      is ever offered to a stored definition.
 *   3. Failures fail closed. If the customer table cannot be read, every
 *      client-side rule evaluates as "not matched" and the caller is told how
 *      many subscribers could not be verified — an honest undercount, never a
 *      silent over-send.
 */
final class ClientDirectoryRepository
{
    const CLIENT_TABLE = 'tblclients';
    const HOSTING_TABLE = 'tblhosting';
    const DOMAIN_TABLE = 'tbldomains';

    /** Hard ceiling for one batch; evaluation pages through subscribers anyway. */
    const MAX_BATCH = 1000;

    /**
     * Customer facts for a batch of e-mail addresses.
     *
     * @param string[] $emails
     * @param string[] $fields subset of SegmentField client keys
     * @return array{facts:array<string,array>,error:string}
     */
    public function factsByEmail(array $emails, array $fields)
    {
        $emails = array_values(array_unique(array_filter(array_map(function ($email) {
            return strtolower(trim((string) $email));
        }, $emails))));
        if (!$emails) { return array('facts' => array(), 'error' => ''); }
        if (count($emails) > self::MAX_BATCH) { $emails = array_slice($emails, 0, self::MAX_BATCH); }

        $wanted = array();
        foreach ($fields as $field) {
            if (SegmentField::isClientField($field)) { $wanted[$field] = true; }
        }
        if (!$wanted) { return array('facts' => array(), 'error' => ''); }

        try {
            if (!$this->hasClientTable()) {
                return array('facts' => array(), 'error' => 'The WHMCS customer table is not available in this environment.');
            }
            $rows = Capsule::table(self::CLIENT_TABLE)
                ->whereIn('email', $emails)
                ->select('id', 'email', 'country', 'status', 'datecreated', 'lastlogin')
                ->get();
        } catch (\Throwable $error) {
            return array('facts' => array(), 'error' => 'The WHMCS customer table could not be read.');
        }

        $facts = array();
        $ids = array();
        foreach ($rows ? $rows->all() : array() as $row) {
            $email = strtolower((string) $row->email);
            if ($email === '') { continue; }
            $facts[$email] = array();
            $ids[] = (int) $row->id;
            if (isset($wanted['client.country'])) { $facts[$email]['client.country'] = trim((string) $row->country); }
            if (isset($wanted['client.status'])) { $facts[$email]['client.status'] = strtolower(trim((string) $row->status)); }
            if (isset($wanted['client.created'])) { $facts[$email]['client.created'] = (string) $row->datecreated; }
            if (isset($wanted['client.last_login'])) { $facts[$email]['client.last_login'] = (string) $row->lastlogin; }
            if (isset($wanted['client.has_active_service']) || isset($wanted['client.has_active_domain'])) {
                $facts[$email]['client.id'] = (int) $row->id;
            }
        }

        if ($ids && (isset($wanted['client.has_active_service']) || isset($wanted['client.has_active_domain']))) {
            $activeServices = array();
            $activeDomains = array();
            if (isset($wanted['client.has_active_service'])) {
                $activeServices = $this->idsWith(self::HOSTING_TABLE, 'userid', 'domainstatus', 'Active', $ids, $facts, 'client.has_active_service');
            }
            if (isset($wanted['client.has_active_domain'])) {
                $activeDomains = $this->idsWith(self::DOMAIN_TABLE, 'userid', 'status', 'Active', $ids, $facts, 'client.has_active_domain');
            }
            $blind = array();
            if (isset($wanted['client.has_active_service']) && $activeServices === null) { $blind[] = 'services'; }
            if (isset($wanted['client.has_active_domain']) && $activeDomains === null) { $blind[] = 'domains'; }
            if ($blind) {
                return array('facts' => $facts, 'error' => 'Active ' . implode(' and ', $blind) . ' could not be read for the whole batch.');
            }
        }

        return array('facts' => $facts, 'error' => '');
    }

    public function hasClientTable()
    {
        try {
            return (bool) Capsule::schema()->hasTable(self::CLIENT_TABLE);
        } catch (\Throwable $error) {
            return false;
        }
    }

    /**
     * Returns the ids that have at least one active row, or null when the table
     * cannot be read (fail-closed signal for the caller).
     *
     * @return int[]|null
     */
    private function idsWith($table, $idColumn, $statusColumn, $status, array $ids, array &$facts, $field)
    {
        try {
            if (!Capsule::schema()->hasTable($table)) { return null; }
            $rows = Capsule::table($table)
                ->whereIn($idColumn, $ids)
                ->where($statusColumn, $status)
                ->select($idColumn)
                ->get();
        } catch (\Throwable $error) {
            return null;
        }

        $found = array();
        foreach ($rows ? $rows->all() : array() as $row) {
            $found[(int) $row->{$idColumn}] = true;
        }
        foreach ($facts as $email => $fact) {
            if (!isset($fact['client.id'])) { continue; }
            $facts[$email][$field] = isset($found[(int) $fact['client.id']]);
        }
        return array_keys($found);
    }
}
