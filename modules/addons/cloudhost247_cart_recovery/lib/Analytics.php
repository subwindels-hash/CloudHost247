<?php
/**
 * Dashboard metrics. Every figure is a live aggregate of the addon's own
 * tables and of authoritative WHMCS order data — nothing is synthesised, and
 * an empty installation reports zeroes.
 */

namespace CloudHost247\CartRecovery;

use WHMCS\Database\Capsule;

final class Analytics
{
    /**
     * Recovery rate definition (documented in README):
     *   (recovered + converted) / (abandoned + recovered + converted + expired + unsubscribed) * 100
     * i.e. carts that came back divided by every cart that became eligible
     * for recovery. Carts still "active" never became eligible and are
     * excluded; "closed" carts (emptied deliberately) are excluded too.
     */
    public static function summary()
    {
        $counts = array();
        foreach (Schema::allStatuses() as $status) {
            $counts[$status] = (int) RecoveryService::table()->where('status', $status)->count();
        }

        $eligible = $counts[Schema::STATUS_ABANDONED] + $counts[Schema::STATUS_RECOVERED]
            + $counts[Schema::STATUS_CONVERTED] + $counts[Schema::STATUS_EXPIRED] + $counts[Schema::STATUS_UNSUBSCRIBED];
        $returned = $counts[Schema::STATUS_RECOVERED] + $counts[Schema::STATUS_CONVERTED];

        $sent = (int) Capsule::table(Schema::REMINDER_LOGS)->where('status', 'sent')->count();
        $failed = (int) Capsule::table(Schema::REMINDER_LOGS)->where('status', 'failed')->count();
        $pending = (int) Capsule::table(Schema::REMINDER_LOGS)->whereIn('status', array('pending', 'sending'))->count();

        $revenue = 0.0;
        foreach (RecoveryService::table()->where('status', Schema::STATUS_CONVERTED)->get() as $row) {
            if (isset($row->recovered_revenue) && is_numeric($row->recovered_revenue)) {
                $revenue += (float) $row->recovered_revenue;
            }
        }

        return array(
            'total_carts' => array_sum($counts),
            'abandoned' => $counts[Schema::STATUS_ABANDONED],
            'active' => $counts[Schema::STATUS_ACTIVE],
            'recovered' => $counts[Schema::STATUS_RECOVERED],
            'converted' => $counts[Schema::STATUS_CONVERTED],
            'expired' => $counts[Schema::STATUS_EXPIRED],
            'closed' => $counts[Schema::STATUS_CLOSED],
            'unsubscribed' => $counts[Schema::STATUS_UNSUBSCRIBED],
            'suppressed_contacts' => (int) Capsule::table(Schema::SUPPRESSIONS)->count(),
            'reminders_sent' => $sent,
            'reminders_failed' => $failed,
            'reminders_pending' => $pending,
            'eligible' => $eligible,
            'recovery_rate' => $eligible > 0 ? round($returned / $eligible * 100, 2) : 0.0,
            'conversion_rate' => $eligible > 0 ? round($counts[Schema::STATUS_CONVERTED] / $eligible * 100, 2) : 0.0,
            'recovered_revenue' => round($revenue, 2),
        );
    }

    /**
     * Filtered, paginated record list for the admin table.
     *
     * @param string $status one of the lifecycle statuses, or '' for all
     * @param string $search customer name, email or order id
     */
    public static function records($status = '', $search = '', $page = 1, $perPage = 25)
    {
        $perPage = max(5, min(100, (int) $perPage));
        $page = max(1, (int) $page);

        $build = function () use ($status, $search) {
            $query = RecoveryService::table();
            if (in_array($status, Schema::allStatuses(), true)) {
                $query->where('status', $status);
            }
            $search = trim((string) $search);
            if ($search !== '') {
                $query->where(function ($q) use ($search) {
                    $like = '%' . str_replace(array('%', '_'), array('\%', '\_'), $search) . '%';
                    $q->where('email', 'like', $like)
                        ->orWhere('first_name', 'like', $like)
                        ->orWhere('last_name', 'like', $like);
                    if (ctype_digit($search)) {
                        $q->orWhere('order_id', (int) $search);
                        $q->orWhere('client_id', (int) $search);
                    }
                });
            }
            return $query;
        };

        $total = (int) $build()->count();
        $rows = $build()->orderBy('updated_at', 'desc')->orderBy('id', 'desc')
            ->offset(($page - 1) * $perPage)->limit($perPage)->get();

        $list = array();
        foreach ($rows as $row) {
            $list[] = $row;
        }
        return array(
            'rows' => $list,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
            'pages' => $total > 0 ? (int) ceil($total / $perPage) : 1,
        );
    }
}
