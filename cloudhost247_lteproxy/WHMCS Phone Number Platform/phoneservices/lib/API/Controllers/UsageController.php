<?php
/**
 * Usage REST API Controller
 */

namespace PhoneServices\API\Controllers;

use PhoneServices\Services\UsageService;

class UsageController extends BaseController
{
    private $service;
    
    public function __construct()
    {
        $this->service = new UsageService();
    }
    
    /**
     * GET /api/usage
     */
    public function index(array $params = []): array
    {
        $userId = $this->getUserId();
        $filters = $_GET;
        
        if ($userId > 0) {
            $usage = $this->service->getUserUsage($userId, $filters);
        } else {
            $usage = $this->service->getSystemUsageReport($filters);
        }
        
        return ['success' => true, 'data' => $usage];
    }
    
    /**
     * GET /api/usage/transactions
     */
    public function transactions(array $params = []): array
    {
        $userId = $this->getUserId();
        $filters = $_GET;
        
        if ($userId > 0) {
            $transactions = $this->service->getUserTransactions($userId, (int)($filters['limit'] ?? 50));
        } else {
            $transactions = $this->service->getAllTransactions($filters);
        }
        
        return ['success' => true, 'data' => $transactions];
    }
    
    /**
     * GET /api/usage/report
     */
    public function report(array $params = []): array
    {
        $userId = $this->getUserId();
        $filters = $_GET;
        
        $stats = $this->service->getSystemStats();
        $revenue = $this->service->getRevenueByService($filters['from'] ?? null, $filters['to'] ?? null);
        
        return [
            'success' => true,
            'data' => [
                'stats' => $stats,
                'revenue' => $revenue,
            ]
        ];
    }
}
