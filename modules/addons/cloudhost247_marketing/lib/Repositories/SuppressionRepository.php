<?php
namespace CloudHost247\Marketing\Repositories;

use CloudHost247\Marketing\Domain\SuppressionReason;
use CloudHost247\Marketing\Security\InputValidator;
use WHMCS\Database\Capsule;

/**
 * Global suppression list (requirement #29).
 *
 * This is the one list in the platform that always wins: no campaign, import,
 * automation or manual send may address an email that appears here. A
 * suppression is only ever removed by an explicit administrator action, and a
 * later, weaker reason never overwrites an earlier, stronger one — a spam
 * complaint does not become "unsubscribed" because someone pressed a link.
 */
final class SuppressionRepository
{
    const TABLE = 'mod_cloudhost247_marketing_suppressions';
    const MAX_PER_PAGE = 200;

    /** Reasons that must never be silently replaced by a weaker one. */
    private static $weight = array(
        SuppressionReason::UNSUBSCRIBED => 10,
        SuppressionReason::INVALID_ADDRESS => 20,
        SuppressionReason::HARD_BOUNCE => 30,
        SuppressionReason::ADMIN_SUPPRESSED => 40,
        SuppressionReason::SPAM_COMPLAINT => 50,
    );

    public function findByEmail($email)
    {
        return Capsule::table(self::TABLE)->where('email', InputValidator::email($email))->first();
    }

    public function isSuppressed($email)
    {
        try {
            return $this->findByEmail($email) !== null;
        } catch (\InvalidArgumentException $error) {
            return false; // an unusable address is not "suppressed", it is not an address
        }
    }

    public function count()
    {
        $row = Capsule::table(self::TABLE)->selectRaw('COUNT(*) AS aggregate')->first();
        return $row ? (int) $row->aggregate : 0;
    }

    /**
     * Idempotent suppression. The strongest reason wins; `detail` and the
     * timestamp are refreshed. Returns whether the row was created and the
     * reason that now applies.
     */
    public function suppress($email, $reason, $source = 'system', $detail = '')
    {
        $email = InputValidator::email($email);
        if (!SuppressionReason::isValid($reason)) { throw new \InvalidArgumentException('Unknown suppression reason: ' . $reason); }
        $source = InputValidator::key($source, 'Suppression source');
        $detail = InputValidator::shortText($detail, 255, 'Detail');
        $now = date('Y-m-d H:i:s');

        $existing = $this->findByEmail($email);
        if ($existing) {
            $existingWeight = isset(self::$weight[(string) $existing->reason]) ? self::$weight[(string) $existing->reason] : 0;
            $newWeight = isset(self::$weight[$reason]) ? self::$weight[$reason] : 0;
            $updates = array('updated_at' => $now);
            if ($newWeight > $existingWeight) { $updates['reason'] = $reason; }
            if ($detail !== '') { $updates['detail'] = $detail; }
            Capsule::table(self::TABLE)->where('id', (int) $existing->id)->update($updates);
            $row = $this->findByEmail($email);
            return array('created' => false, 'row' => $row, 'reason' => (string) $row->reason);
        }

        Capsule::table(self::TABLE)->insert(array(
            'email' => $email,
            'reason' => $reason,
            'source' => $source,
            'detail' => $detail,
            'created_at' => $now,
            'updated_at' => $now,
        ));
        return array('created' => true, 'row' => $this->findByEmail($email), 'reason' => $reason);
    }

    /**
     * Administrator-only removal. Refuses to lift a spam complaint or hard
     * bounce unless the caller states explicitly that it is intentional.
     */
    public function release($email, $force = false)
    {
        $row = $this->findByEmail($email);
        if (!$row) { return false; }
        $protected = in_array((string) $row->reason, array(SuppressionReason::SPAM_COMPLAINT, SuppressionReason::HARD_BOUNCE), true);
        if ($protected && !$force) {
            throw new \RuntimeException('A ' . SuppressionReason::label($row->reason) . ' suppression requires explicit confirmation to remove.');
        }
        Capsule::table(self::TABLE)->where('id', (int) $row->id)->delete();
        return true;
    }

    public function paginate(array $filters = array(), $page = 1, $perPage = 50)
    {
        $page = max(1, (int) $page);
        $perPage = max(1, min(self::MAX_PER_PAGE, (int) $perPage));
        $query = Capsule::table(self::TABLE);
        if (!empty($filters['reason'])) { $query->where('reason', (string) $filters['reason']); }
        if (!empty($filters['source'])) { $query->where('source', (string) $filters['source']); }
        if (!empty($filters['search'])) {
            $term = '%' . str_replace('%', '', (string) $filters['search']) . '%';
            $query->where('email', 'like', $term);
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

    public function countsByReason()
    {
        $counts = array();
        foreach (SuppressionReason::all() as $reason) {
            $row = Capsule::table(self::TABLE)->where('reason', $reason)->selectRaw('COUNT(*) AS aggregate')->first();
            $counts[$reason] = $row ? (int) $row->aggregate : 0;
        }
        return $counts;
    }
}
