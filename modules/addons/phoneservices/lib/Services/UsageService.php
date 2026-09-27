<?php
/**
 * Usage Service
 * Handles tracking, analytics, reporting, and transactions
 */

namespace PhoneServices\Services;

use PhoneServices\Core\Database;
use PhoneServices\Core\Logger;
use PhoneServices\Core\Config;

class UsageService
{
    /**
     * Record usage for any service type
     */
    public function recordUsage(int $userId, string $serviceType, int $referenceId, float $used, float $total = null, string $unit = 'unit'): int
    {
        $record = [
            'user_id' => $userId,
            'service_type' => $serviceType,
            'reference_id' => $referenceId,
            'used_value' => $used,
            'total_value' => $total,
            'unit' => $unit,
            'recorded_at' => date('Y-m-d H:i:s'),
        ];
        
        $id = Database::insert('mod_phoneservices_usage', $record);
        Logger::info('Usage recorded', ['id' => $id, 'user' => $userId, 'type' => $serviceType, 'used' => $used]);
        return $id;
    }
    
    /**
     * Get user usage summary
     */
    public function getUserUsage(int $userId, array $filters = []): array
    {
        $sql = "SELECT 
                    service_type,
                    COUNT(*) as total_records,
                    SUM(used_value) as total_used,
                    MAX(recorded_at) as last_recorded
                FROM mod_phoneservices_usage 
                WHERE user_id = " . (int)$userId;
        
        if (!empty($filters['service_type'])) {
            $sql .= " AND service_type = '" . db_escape_string($filters['service_type']) . "'";
        }
        if (!empty($filters['from'])) {
            $sql .= " AND recorded_at >= '" . db_escape_string($filters['from']) . "'";
        }
        if (!empty($filters['to'])) {
            $sql .= " AND recorded_at <= '" . db_escape_string($filters['to']) . "'";
        }
        
        $sql .= " GROUP BY service_type";
        
        $result = full_query($sql);
        $usage = [];
        while ($row = mysql_fetch_assoc($result)) {
            $usage[$row['service_type']] = $row;
        }
        
        return $usage;
    }
    
    /**
     * Get user transactions
     */
    public function getUserTransactions(int $userId, int $limit = 50): array
    {
        return Database::select('mod_phoneservices_transactions', '*', ['user_id' => $userId], 'id', 'DESC', $limit);
    }
    
    /**
     * Get all transactions (admin)
     */
    public function getAllTransactions(array $filters = []): array
    {
        $where = [];
        if (!empty($filters['user_id'])) {
            $where['user_id'] = $filters['user_id'];
        }
        if (!empty($filters['service_type'])) {
            $where['service_type'] = $filters['service_type'];
        }
        if (!empty($filters['status'])) {
            $where['status'] = $filters['status'];
        }
        
        return Database::select('mod_phoneservices_transactions', '*', $where, 'id', 'DESC', $filters['limit'] ?? 100);
    }
    
    /**
     * Create transaction record
     */
    public function createTransaction(int $userId, string $serviceType, int $referenceId, float $amount, string $currency = 'USD', string $status = 'pending'): int
    {
        $record = [
            'user_id' => $userId,
            'service_type' => $serviceType,
            'reference_id' => $referenceId,
            'amount' => $amount,
            'currency' => $currency,
            'status' => $status,
            'created_at' => date('Y-m-d H:i:s'),
        ];
        
        $id = Database::insert('mod_phoneservices_transactions', $record);
        Logger::info('Transaction created', ['id' => $id, 'user' => $userId, 'amount' => $amount]);
        return $id;
    }
    
    /**
     * Update transaction status
     */
    public function updateTransactionStatus(int $transactionId, string $status, array $metadata = []): bool
    {
        $update = ['status' => $status];
        if (!empty($metadata['invoice_id'])) {
            $update['invoice_id'] = $metadata['invoice_id'];
        }
        if (!empty($metadata['gateway'])) {
            $update['gateway'] = $metadata['gateway'];
        }
        if (!empty($metadata['gateway_transaction_id'])) {
            $update['gateway_transaction_id'] = $metadata['gateway_transaction_id'];
        }
        
        Database::update('mod_phoneservices_transactions', $update, ['id' => $transactionId]);
        Logger::info('Transaction status updated', ['id' => $transactionId, 'status' => $status]);
        return true;
    }
    
    /**
     * Get system-wide stats
     */
    public function getSystemStats(): array
    {
        $stats = [];
        
        $stats['total_numbers'] = Database::count('mod_phoneservices_numbers');
        $stats['active_numbers'] = Database::count('mod_phoneservices_numbers', ['status' => 'active']);
        $stats['total_calls'] = Database::count('mod_phoneservices_calls');
        $stats['total_messages'] = Database::count('mod_phoneservices_messages');
        $stats['total_esims'] = Database::count('mod_phoneservices_esims');
        $stats['active_esims'] = Database::count('mod_phoneservices_esims', ['status' => 'active']);
        $stats['total_transactions'] = Database::count('mod_phoneservices_transactions');
        $stats['total_revenue'] = $this->getTotalRevenue();
        
        // Recent activity
        $stats['recent_calls'] = Database::select('mod_phoneservices_calls', '*', [], 'id', 'DESC', 5);
        $stats['recent_messages'] = Database::select('mod_phoneservices_messages', '*', [], 'id', 'DESC', 5);
        $stats['recent_transactions'] = Database::select('mod_phoneservices_transactions', '*', [], 'id', 'DESC', 5);
        
        return $stats;
    }
    
    /**
     * Get system usage report
     */
    public function getSystemUsageReport(array $filters = []): array
    {
        $sql = "SELECT 
                    DATE(recorded_at) as date,
                    service_type,
                    COUNT(*) as count,
                    SUM(used_value) as total_used
                FROM mod_phoneservices_usage 
                WHERE 1=1";
        
        if (!empty($filters['from'])) {
            $sql .= " AND recorded_at >= '" . db_escape_string($filters['from']) . "'";
        }
        if (!empty($filters['to'])) {
            $sql .= " AND recorded_at <= '" . db_escape_string($filters['to']) . "'";
        }
        if (!empty($filters['service_type'])) {
            $sql .= " AND service_type = '" . db_escape_string($filters['service_type']) . "'";
        }
        
        $sql .= " GROUP BY DATE(recorded_at), service_type ORDER BY date DESC";
        
        $result = full_query($sql);
        $report = [];
        while ($row = mysql_fetch_assoc($result)) {
            $report[] = $row;
        }
        
        return $report;
    }
    
    /**
     * Get total revenue
     */
    public function getTotalRevenue(): float
    {
        $sql = "SELECT SUM(amount) as total FROM mod_phoneservices_transactions WHERE status = 'completed'";
        $result = full_query($sql);
        $row = mysql_fetch_assoc($result);
        return (float) ($row['total'] ?? 0);
    }
    
    /**
     * Get revenue by service type
     */
    public function getRevenueByService(string $from = null, string $to = null): array
    {
        $sql = "SELECT service_type, SUM(amount) as revenue, COUNT(*) as count 
                FROM mod_phoneservices_transactions 
                WHERE status = 'completed'";
        
        if ($from) {
            $sql .= " AND created_at >= '" . db_escape_string($from) . "'";
        }
        if ($to) {
            $sql .= " AND created_at <= '" . db_escape_string($to) . "'";
        }
        
        $sql .= " GROUP BY service_type";
        
        $result = full_query($sql);
        $revenue = [];
        while ($row = mysql_fetch_assoc($result)) {
            $revenue[$row['service_type']] = $row;
        }
        
        return $revenue;
    }
    
    /**
     * Count user calls
     */
    public function countUserCalls(int $userId): int
    {
        return Database::count('mod_phoneservices_calls', ['user_id' => $userId]);
    }
    
    /**
     * Count user SMS
     */
    public function countUserSms(int $userId): int
    {
        return Database::count('mod_phoneservices_messages', ['user_id' => $userId]);
    }
    
    /**
     * Count user eSIMs
     */
    public function countUserEsims(int $userId): int
    {
        return Database::count('mod_phoneservices_esims', ['user_id' => $userId, 'status' => 'active']);
    }
    
    /**
     * Daily usage report (for cron)
     */
    public function generateDailyReport(): array
    {
        $yesterday = date('Y-m-d', strtotime('-1 day'));
        
        $sql = "SELECT 
                    service_type,
                    COUNT(*) as count,
                    SUM(used_value) as total_used,
                    AVG(used_value) as avg_used
                FROM mod_phoneservices_usage 
                WHERE DATE(recorded_at) = '{$yesterday}'
                GROUP BY service_type";
        
        $result = full_query($sql);
        $report = [];
        while ($row = mysql_fetch_assoc($result)) {
            $report[$row['service_type']] = $row;
        }
        
        Logger::info('Daily report generated', ['date' => $yesterday, 'services' => count($report)]);
        return $report;
    }
    
    /**
     * Cleanup old usage records
     */
    public function cleanupOldUsage(int $days = 365): int
    {
        $cutoff = date('Y-m-d H:i:s', strtotime("-{$days} days"));
        full_query("DELETE FROM mod_phoneservices_usage WHERE recorded_at < '" . db_escape_string($cutoff) . "'");
        $affected = mysql_affected_rows();
        Logger::info('Old usage cleaned', ['days' => $days, 'deleted' => $affected]);
        return $affected;
    }
}
