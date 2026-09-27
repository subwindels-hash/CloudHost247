<?php
/**
 * eSIM REST API Controller
 */

namespace PhoneServices\API\Controllers;

use PhoneServices\Services\EsimService;

class EsimController extends BaseController
{
    private $service;
    
    public function __construct()
    {
        $this->service = new EsimService();
    }
    
    /**
     * GET /api/esim/profiles
     */
    public function profiles(array $params = []): array
    {
        $userId = $this->getUserId();
        $filters = $_GET;
        
        if ($userId > 0) {
            $profiles = $this->service->getUserProfiles($userId);
        } else {
            $profiles = $this->service->getAllProfiles($filters);
        }
        
        return ['success' => true, 'data' => $profiles];
    }
    
    /**
     * POST /api/esim/purchase
     */
    public function purchase(array $params = []): array
    {
        $input = array_merge($_POST, $this->getInput());
        $error = $this->validate($input, ['plan_id']);
        if ($error) {
            return ['success' => false, 'error' => $error];
        }
        
        $userId = $this->getUserId();
        if (!$userId) {
            return ['success' => false, 'error' => 'Authentication required'];
        }
        
        $result = $this->service->purchasePlan($userId, $input['plan_id'], $input['options'] ?? []);
        
        if (isset($result['error'])) {
            return ['success' => false, 'error' => $result['error']];
        }
        
        $this->log('eSIM purchased via API', ['user' => $userId]);
        return ['success' => true, 'data' => $result];
    }
    
    /**
     * GET /api/esim/:id/qrcode
     */
    public function qrCode(array $params = []): array
    {
        $id = (int) ($params['id'] ?? 0);
        $userId = $this->getUserId();
        
        $esim = $this->service->getEsimDetails($id);
        if (!$esim || ($userId > 0 && $esim['user_id'] != $userId)) {
            return ['success' => false, 'error' => 'eSIM not found'];
        }
        
        $result = $this->service->getQrCode($id);
        return $result;
    }
    
    /**
     * GET /api/esim/plans
     */
    public function plans(array $params = []): array
    {
        $country = $_GET['country'] ?? null;
        $region = $_GET['region'] ?? null;
        
        $plans = $this->service->getAvailablePlans($country, $region);
        
        if (isset($plans['error'])) {
            return ['success' => false, 'error' => $plans['error']];
        }
        
        return ['success' => true, 'data' => $plans];
    }
}
