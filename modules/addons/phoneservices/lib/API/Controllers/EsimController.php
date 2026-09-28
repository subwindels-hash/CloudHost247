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

    /**
     * GET /api/esim/:id/usage
     *
     * @return array<string,mixed>
     */
    public function usage(array $params = []): array
    {
        $id = (int) ($params['id'] ?? 0);

        if ($id <= 0) {
            return $this->error('An eSIM id is required');
        }

        if (!$this->isSystemContext() && !$this->ownsOrFail('mod_phoneservices_esims', $id)) {
            return $this->error('eSIM not found', 404);
        }

        $usage = $this->service->checkUsage($id);

        if (!empty($usage['error'])) {
            return $this->error((string) $usage['error']);
        }

        return $this->ok($usage);
    }

    /**
     * POST /api/esim/:id/topup  { "plan_id": "..." }
     *
     * @return array<string,mixed>
     */
    public function topUp(array $params = []): array
    {
        $id = (int) ($params['id'] ?? 0);
        $input = array_merge($_POST, $this->getInput());
        $planId = (string) ($input['plan_id'] ?? '');

        if ($id <= 0 || $planId === '') {
            return $this->error('An eSIM id and plan_id are required');
        }

        if (!$this->isSystemContext() && !$this->ownsOrFail('mod_phoneservices_esims', $id)) {
            return $this->error('eSIM not found', 404);
        }

        $result = $this->service->topUp($id, $planId);

        if (!empty($result['error'])) {
            return $this->error((string) $result['error']);
        }

        return $this->ok($result);
    }

}
