<?php
/**
 * Numbers REST API Controller
 */

namespace PhoneServices\API\Controllers;

use PhoneServices\Services\NumberService;

class NumbersController extends BaseController
{
    private $service;
    
    public function __construct()
    {
        $this->service = new NumberService();
    }
    
    /**
     * GET /api/numbers
     */
    public function index(array $params = []): array
    {
        $userId = $this->getUserId();
        $filters = $_GET;
        
        if ($userId > 0) {
            $numbers = $this->service->getUserNumbers($userId);
        } else {
            $numbers = $this->service->getAllNumbers($filters);
        }
        
        return ['success' => true, 'data' => $numbers];
    }
    
    /**
     * POST /api/numbers/purchase
     */
    public function purchase(array $params = []): array
    {
        $input = array_merge($_POST, $this->getInput());
        $error = $this->validate($input, ['number', 'country']);
        if ($error) {
            return ['success' => false, 'error' => $error];
        }
        
        $userId = $this->getUserId();
        if (!$userId) {
            return ['success' => false, 'error' => 'Authentication required'];
        }
        
        $result = $this->service->purchaseNumber(
            $userId,
            $input['number'],
            $input['country'],
            $input['type'] ?? 'local',
            $input['options'] ?? []
        );
        
        if (isset($result['error'])) {
            return ['success' => false, 'error' => $result['error']];
        }
        
        $this->log('Number purchased via API', ['user' => $userId]);
        return ['success' => true, 'data' => $result];
    }
    
    /**
     * POST /api/numbers/:id/renew
     */
    public function renew(array $params = []): array
    {
        $id = (int) ($params['id'] ?? 0);
        $userId = $this->getUserId();
        
        $number = $this->service->getNumber($id);
        if (!$number || ($userId > 0 && $number['user_id'] != $userId)) {
            return ['success' => false, 'error' => 'Number not found'];
        }
        
        $result = $this->service->renewNumber($id, (int) ($_POST['months'] ?? 1));
        return $result;
    }
    
    /**
     * POST /api/numbers/:id/suspend
     */
    public function suspend(array $params = []): array
    {
        $id = (int) ($params['id'] ?? 0);
        $userId = $this->getUserId();
        
        $number = $this->service->getNumber($id);
        if (!$number || ($userId > 0 && $number['user_id'] != $userId)) {
            return ['success' => false, 'error' => 'Number not found'];
        }
        
        $this->service->suspendNumber($id, $_POST['reason'] ?? '');
        return ['success' => true];
    }
    
    /**
     * POST /api/numbers/:id/release
     */
    public function release(array $params = []): array
    {
        $id = (int) ($params['id'] ?? 0);
        $userId = $this->getUserId();
        
        $number = $this->service->getNumber($id);
        if (!$number || ($userId > 0 && $number['user_id'] != $userId)) {
            return ['success' => false, 'error' => 'Number not found'];
        }
        
        $this->service->releaseNumber($id);
        return ['success' => true];
    }
}
