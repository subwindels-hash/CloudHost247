<?php
/**
 * VoIP REST API Controller
 */

namespace PhoneServices\API\Controllers;

use PhoneServices\Services\VoipService;

class VoipController extends BaseController
{
    private $service;
    
    public function __construct()
    {
        $this->service = new VoipService();
    }
    
    /**
     * GET /api/voip/calls
     */
    public function calls(array $params = []): array
    {
        $userId = $this->getUserId();
        $filters = $_GET;
        
        if ($userId > 0) {
            $calls = $this->service->getUserCallLogs($userId, $filters);
        } else {
            $calls = $this->service->getAllCallLogs($filters);
        }
        
        return ['success' => true, 'data' => $calls];
    }
    
    /**
     * POST /api/voip/call
     */
    public function initiateCall(array $params = []): array
    {
        $input = array_merge($_POST, $this->getInput());
        $error = $this->validate($input, ['from', 'to']);
        if ($error) {
            return ['success' => false, 'error' => $error];
        }
        
        $userId = $this->getUserId();
        if (!$userId) {
            return ['success' => false, 'error' => 'Authentication required'];
        }
        
        $result = $this->service->initiateCall($userId, $input['from'], $input['to'], $input['options'] ?? []);
        
        if (isset($result['error'])) {
            return ['success' => false, 'error' => $result['error']];
        }
        
        $this->log('Call initiated via API', ['user' => $userId]);
        return ['success' => true, 'data' => $result];
    }
    
    /**
     * POST /api/voip/call/:id/end
     */
    public function endCall(array $params = []): array
    {
        $callId = $params['id'] ?? '';
        $userId = $this->getUserId();
        
        if (empty($callId)) {
            return ['success' => false, 'error' => 'Call ID required'];
        }
        
        $result = $this->service->endCall($userId, $callId);
        return ['success' => $result];
    }
    
    /**
     * GET /api/voip/token
     */
    public function getToken(array $params = []): array
    {
        $userId = $this->getUserId();
        if (!$userId) {
            return ['success' => false, 'error' => 'Authentication required'];
        }
        
        $config = $this->service->getWebRtcConfig($userId);
        return ['success' => true, 'data' => $config];
    }
}
