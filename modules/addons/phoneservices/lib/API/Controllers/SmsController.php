<?php
/**
 * SMS REST API Controller
 */

namespace PhoneServices\API\Controllers;

use PhoneServices\Services\SmsService;

class SmsController extends BaseController
{
    private $service;
    
    public function __construct()
    {
        $this->service = new SmsService();
    }
    
    /**
     * GET /api/sms/messages
     */
    public function messages(array $params = []): array
    {
        $userId = $this->getUserId();
        $filters = $_GET;
        
        if ($userId > 0) {
            $messages = $this->service->getUserMessages($userId, $filters);
        } else {
            $messages = $this->service->getAllMessages($filters);
        }
        
        return ['success' => true, 'data' => $messages];
    }
    
    /**
     * POST /api/sms/send
     */
    public function send(array $params = []): array
    {
        $input = array_merge($_POST, $this->getInput());
        $error = $this->validate($input, ['to', 'message']);
        if ($error) {
            return ['success' => false, 'error' => $error];
        }
        
        $userId = $this->getUserId();
        if (!$userId) {
            return ['success' => false, 'error' => 'Authentication required'];
        }
        
        $from = $input['from'] ?? '';
        $result = $this->service->sendSms($userId, $from, $input['to'], $input['message'], $input['options'] ?? []);
        
        if (isset($result['error'])) {
            return ['success' => false, 'error' => $result['error']];
        }
        
        $this->log('SMS sent via API', ['user' => $userId]);
        return ['success' => true, 'data' => $result];
    }
    
    /**
     * POST /api/sms/otp
     */
    public function sendOtp(array $params = []): array
    {
        $input = array_merge($_POST, $this->getInput());
        $error = $this->validate($input, ['to']);
        if ($error) {
            return ['success' => false, 'error' => $error];
        }
        
        $userId = $this->getUserId();
        if (!$userId) {
            return ['success' => false, 'error' => 'Authentication required'];
        }
        
        $result = $this->service->sendOtp($userId, $input['to'], $input['type'] ?? 'sms', (int)($input['length'] ?? 6), (int)($input['ttl'] ?? 300));
        
        if (isset($result['error'])) {
            return ['success' => false, 'error' => $result['error']];
        }
        
        return ['success' => true, 'data' => $result];
    }
    
    /**
     * POST /api/sms/whatsapp
     */
    public function sendWhatsapp(array $params = []): array
    {
        $input = array_merge($_POST, $this->getInput());
        $error = $this->validate($input, ['to', 'message']);
        if ($error) {
            return ['success' => false, 'error' => $error];
        }
        
        $userId = $this->getUserId();
        if (!$userId) {
            return ['success' => false, 'error' => 'Authentication required'];
        }
        
        $result = $this->service->sendWhatsapp($userId, $input['to'], $input['message']);
        
        if (isset($result['error'])) {
            return ['success' => false, 'error' => $result['error']];
        }
        
        return ['success' => true, 'data' => $result];
    }
    
    /**
     * POST /api/sms/email
     */
    public function sendEmail(array $params = []): array
    {
        $input = array_merge($_POST, $this->getInput());
        $error = $this->validate($input, ['to', 'subject', 'body']);
        if ($error) {
            return ['success' => false, 'error' => $error];
        }
        
        $userId = $this->getUserId();
        if (!$userId) {
            return ['success' => false, 'error' => 'Authentication required'];
        }
        
        $result = $this->service->sendEmail($userId, $input['to'], $input['subject'], $input['body'], $input['options'] ?? []);
        
        if (isset($result['error'])) {
            return ['success' => false, 'error' => $result['error']];
        }
        
        return ['success' => true, 'data' => $result];
    }
}
