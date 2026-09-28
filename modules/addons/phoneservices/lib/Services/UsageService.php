<?php
/**
 * Usage & Analytics Service
 *
 * Owns metered usage (calls, SMS, data), the transaction ledger and every
 * report consumed by the client dashboard and the admin reporting screens.
 * All queries are parameterised.
 *
 * @package PhoneServices
 */

namespace PhoneServices\Services;

use PhoneServices\Core\Config;
use PhoneServices\Core\Database;
use PhoneServices\Core\Logger;

class UsageService
{
    const USAGE_TABLE = 'mod_phoneservices_usage';
    const TRANSACTION_TABLE = 'mod_phoneservices_transactions';

    const SERVICE_TYPES = ['call', 'sms', 'data', 'whatsapp', 'email', 'number'];

    /**
     * Record a metered usage event.
     */
    public function recordUsage(
        int $userId,
        string $serviceType,
        int $referenceId,
        float $used,
        ?float $total = null,
        string $unit = 'unit'
    ): int {
        $id = Database::insert(self::USAGE_TABLE, [
            'user_id'      => $userId,
            'service_type' => $serviceType,
            'reference_id' => $referenceId,
            'used_value'   => $used,
            'total_value'  => $total,
            'unit'         => $unit,
            'recorded_at'  => date('Y-m-d H:i:s'),
        ]);

        Logger::debug('Usage recorded', [
            'id'   => $id,
            'user' => $userId,
            'type' => $serviceType,
            'used' => $used,
            'unit' => $unit,
        ]);

        return $id;
    }

    /**
     * Per-service usage summary for a client.
     *
     * @param array{service_type?:string,from?:string,to?:string} $filters
     * @return array<string,array<string,mixed>>
     */
    public function getUserUsage(int $userId, array $filters = []): array
    {
        $sql = 'SELECT service_type,
                       COUNT(*) AS total_records,
                       SUM(used_value) AS total_used,
                       MAX(recorded_at) AS last_recorded,
                       unit
                  FROM ' . self::USAGE_TABLE . '
                 WHERE user_id = ?';
        $bindings = [$userId];

        if (!empty($filters['service_type'])) {
            $sql .= ' AND service_type = ?';
            $bindings[] = $filters['service_type'];
        }
        if (!empty($filters['from'])) {
            $sql .= ' AND recorded_at >= ?';
            $bindings[] = $filters['from'];
        }
        if (!empty($filters['to'])) {
            $sql .= ' AND recorded_at <= ?';
            $bindings[] = $filters['to'];
        }

        $sql .= ' GROUP BY service_type, unit';

        $usage = [];
        foreach (Database::raw($sql, $bindings) as $row) {
            $usage[(string) $row['service_type']] = $row;
        }

        return $usage;
    }

    /**
     * Day-by-day usage for the client analytics chart.
     *
     * @return array<int,array<string,mixed>>
     */
    public function getUserDailyUsage(int $userId, int $days = 30): array
    {
        $from = date('Y-m-d 00:00:00', strtotime('-' . max(1, $days) . ' days'));

        return Database::raw(
            'SELECT DATE(recorded_at) AS date, service_type,
                    COUNT(*) AS events, SUM(used_value) AS total_used
               FROM ' . self::USAGE_TABLE . '
              WHERE user_id = ? AND recorded_at >= ?
              GROUP BY DATE(recorded_at), service_type
              ORDER BY date ASC',
            [$userId, $from]
        );
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function getUserTransactions(int $userId, int $limit = 50): array
    {
        return Database::select(self::TRANSACTION_TABLE, '*', ['user_id' => $userId], 'id', 'DESC', $limit);
    }

    /**
     * Total completed spend for a client.
     */
    public function getUserSpend(int $userId): float
    {
        return Database::sum(self::TRANSACTION_TABLE, 'amount', [
            'user_id' => $userId,
            'status'  => 'completed',
        ]);
    }

    /**
     * Admin transaction browser.
     *
     * @param array<string,mixed> $filters
     * @return array<int,array<string,mixed>>
     */
    public function getAllTransactions(array $filters = []): array
    {
        [$sql, $bindings] = $this->transactionQuery($filters);

        $sql = 'SELECT * FROM ' . self::TRANSACTION_TABLE . $sql . ' ORDER BY id DESC LIMIT ' . (int) ($filters['limit'] ?? 200);

        return Database::raw($sql, $bindings);
    }

    /**
     * Totals for the filtered transaction set (billing report header).
     *
     * @param array<string,mixed> $filters
     * @return array{count:int,total:float,completed:float,pending:float,refunded:float}
     */
    public function getTransactionTotals(array $filters = []): array
    {
        [$where, $bindings] = $this->transactionQuery($filters);

        $rows = Database::raw(
            'SELECT COUNT(*) AS cnt,
                    COALESCE(SUM(amount),0) AS total,
                    COALESCE(SUM(CASE WHEN status = "completed" THEN amount ELSE 0 END),0) AS completed,
                    COALESCE(SUM(CASE WHEN status = "pending" THEN amount ELSE 0 END),0) AS pending,
                    COALESCE(SUM(CASE WHEN status = "refunded" THEN amount ELSE 0 END),0) AS refunded
               FROM ' . self::TRANSACTION_TABLE . $where,
            $bindings
        );

        $row = $rows[0] ?? [];

        return [
            'count'     => (int) ($row['cnt'] ?? 0),
            'total'     => (float) ($row['total'] ?? 0),
            'completed' => (float) ($row['completed'] ?? 0),
            'pending'   => (float) ($row['pending'] ?? 0),
            'refunded'  => (float) ($row['refunded'] ?? 0),
        ];
    }

    /**
     * Build the shared WHERE clause for transaction queries.
     *
     * @param array<string,mixed> $filters
     * @return array{0:string,1:array<int,mixed>}
     */
    private function transactionQuery(array $filters): array
    {
        $sql = ' WHERE 1 = 1';
        $bindings = [];

        if (!empty($filters['user_id'])) {
            $sql .= ' AND user_id = ?';
            $bindings[] = (int) $filters['user_id'];
        }
        if (!empty($filters['service_type'])) {
            $sql .= ' AND service_type = ?';
            $bindings[] = (string) $filters['service_type'];
        }
        if (!empty($filters['status'])) {
            $sql .= ' AND status = ?';
            $bindings[] = (string) $filters['status'];
        }
        if (!empty($filters['from'])) {
            $sql .= ' AND created_at >= ?';
            $bindings[] = date('Y-m-d 00:00:00', strtotime((string) $filters['from']));
        }
        if (!empty($filters['to'])) {
            $sql .= ' AND created_at <= ?';
            $bindings[] = date('Y-m-d 23:59:59', strtotime((string) $filters['to']));
        }

        return [$sql, $bindings];
    }

    /**
     * Append a row to the transaction ledger.
     */
    public function createTransaction(
        int $userId,
        string $serviceType,
        int $referenceId,
        float $amount,
        string $currency = 'USD',
        string $status = 'pending'
    ): int {
        $id = Database::insert(self::TRANSACTION_TABLE, [
            'user_id'      => $userId,
            'service_type' => $serviceType,
            'reference_id' => $referenceId,
            'amount'       => $amount,
            'currency'     => $currency ?: (string) Config::get('currency', 'USD'),
            'status'       => $status,
            'created_at'   => date('Y-m-d H:i:s'),
        ]);

        Logger::info('Transaction created', [
            'id'     => $id,
            'user'   => $userId,
            'type'   => $serviceType,
            'amount' => $amount,
        ]);

        return $id;
    }

    /**
     * @param array<string,mixed> $metadata
     */
    public function updateTransactionStatus(int $transactionId, string $status, array $metadata = []): bool
    {
        if ($transactionId <= 0) {
            return false;
        }

        $update = ['status' => $status, 'updated_at' => date('Y-m-d H:i:s')];

        foreach (['invoice_id', 'gateway', 'gateway_transaction_id'] as $key) {
            if (!empty($metadata[$key])) {
                $update[$key] = $metadata[$key];
            }
        }

        $affected = Database::update(self::TRANSACTION_TABLE, $update, ['id' => $transactionId]);

        Logger::info('Transaction status updated', ['id' => $transactionId, 'status' => $status]);

        return $affected > 0;
    }

    /**
     * Mark every pending transaction attached to a WHMCS invoice as paid.
     */
    public function markInvoicePaid(int $invoiceId): int
    {
        if ($invoiceId <= 0) {
            return 0;
        }

        return Database::update(self::TRANSACTION_TABLE, [
            'status'     => 'completed',
            'gateway'    => 'whmcs',
            'updated_at' => date('Y-m-d H:i:s'),
        ], ['invoice_id' => $invoiceId, 'status' => 'pending']);
    }

    /**
     * Dashboard counters.
     *
     * @return array<string,mixed>
     */
    public function getSystemStats(): array
    {
        return [
            'total_numbers'       => Database::count('mod_phoneservices_numbers'),
            'active_numbers'      => Database::count('mod_phoneservices_numbers', ['status' => 'active']),
            'total_calls'         => Database::count('mod_phoneservices_calls'),
            'total_messages'      => Database::count('mod_phoneservices_messages'),
            'total_esims'         => Database::count('mod_phoneservices_esims'),
            'active_esims'        => Database::count('mod_phoneservices_esims', ['status' => 'active']),
            'total_transactions'  => Database::count(self::TRANSACTION_TABLE),
            'total_revenue'       => $this->getTotalRevenue(),
            'revenue_by_service'  => $this->getRevenueByService(),
            'recent_calls'        => Database::select('mod_phoneservices_calls', '*', [], 'id', 'DESC', 5),
            'recent_messages'     => Database::select('mod_phoneservices_messages', '*', [], 'id', 'DESC', 5),
            'recent_transactions' => Database::select(self::TRANSACTION_TABLE, '*', [], 'id', 'DESC', 5),
        ];
    }

    /**
     * Usage grouped by day and service type.
     *
     * @param array<string,mixed> $filters
     * @return array<int,array<string,mixed>>
     */
    public function getSystemUsageReport(array $filters = []): array
    {
        $sql = 'SELECT DATE(recorded_at) AS date, service_type,
                       COUNT(*) AS count, SUM(used_value) AS total_used
                  FROM ' . self::USAGE_TABLE . '
                 WHERE 1 = 1';
        $bindings = [];

        if (!empty($filters['from'])) {
            $sql .= ' AND recorded_at >= ?';
            $bindings[] = date('Y-m-d 00:00:00', strtotime((string) $filters['from']));
        }
        if (!empty($filters['to'])) {
            $sql .= ' AND recorded_at <= ?';
            $bindings[] = date('Y-m-d 23:59:59', strtotime((string) $filters['to']));
        }
        if (!empty($filters['service_type'])) {
            $sql .= ' AND service_type = ?';
            $bindings[] = (string) $filters['service_type'];
        }

        $sql .= ' GROUP BY DATE(recorded_at), service_type ORDER BY date DESC LIMIT 500';

        return Database::raw($sql, $bindings);
    }

    public function getTotalRevenue(): float
    {
        return Database::sum(self::TRANSACTION_TABLE, 'amount', ['status' => 'completed']);
    }

    /**
     * @return array<string,array<string,mixed>>
     */
    public function getRevenueByService(?string $from = null, ?string $to = null): array
    {
        $sql = 'SELECT service_type, SUM(amount) AS revenue, COUNT(*) AS count
                  FROM ' . self::TRANSACTION_TABLE . '
                 WHERE status = ?';
        $bindings = ['completed'];

        if ($from) {
            $sql .= ' AND created_at >= ?';
            $bindings[] = date('Y-m-d 00:00:00', strtotime($from));
        }
        if ($to) {
            $sql .= ' AND created_at <= ?';
            $bindings[] = date('Y-m-d 23:59:59', strtotime($to));
        }

        $sql .= ' GROUP BY service_type';

        $revenue = [];
        foreach (Database::raw($sql, $bindings) as $row) {
            $revenue[(string) $row['service_type']] = $row;
        }

        return $revenue;
    }

    public function countUserCalls(int $userId): int
    {
        return Database::count('mod_phoneservices_calls', ['user_id' => $userId]);
    }

    public function countUserSms(int $userId): int
    {
        return Database::count('mod_phoneservices_messages', ['user_id' => $userId]);
    }

    public function countUserEsims(int $userId): int
    {
        return Database::count('mod_phoneservices_esims', ['user_id' => $userId, 'status' => 'active']);
    }

    /**
     * Yesterday's usage roll-up (cron).
     *
     * @return array<string,array<string,mixed>>
     */
    public function generateDailyReport(): array
    {
        $yesterday = date('Y-m-d', strtotime('-1 day'));

        $rows = Database::raw(
            'SELECT service_type, COUNT(*) AS count,
                    SUM(used_value) AS total_used, AVG(used_value) AS avg_used
               FROM ' . self::USAGE_TABLE . '
              WHERE DATE(recorded_at) = ?
              GROUP BY service_type',
            [$yesterday]
        );

        $report = [];
        foreach ($rows as $row) {
            $report[(string) $row['service_type']] = $row;
        }

        Logger::info('Daily usage report generated', ['date' => $yesterday, 'services' => count($report)]);

        return $report;
    }

    /**
     * Prune usage rows older than the retention window.
     */
    public function cleanupOldUsage(?int $days = null): int
    {
        $days = $days ?: Config::getInt('usage_retention_days', 365);
        $cutoff = date('Y-m-d H:i:s', strtotime('-' . max(1, $days) . ' days'));

        $affected = Database::statement(
            'DELETE FROM ' . self::USAGE_TABLE . ' WHERE recorded_at < ?',
            [$cutoff]
        );

        if ($affected > 0) {
            Logger::info('Old usage records pruned', ['days' => $days, 'deleted' => $affected]);
        }

        return $affected;
    }
}
