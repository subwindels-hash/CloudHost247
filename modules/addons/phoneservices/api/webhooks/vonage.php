<?php
/**
 * Vonage Webhook Handler
 * Handles inbound SMS and voice callbacks from Vonage
 */

use PhoneServices\Services\SmsService;
use PhoneServices\Services\VoipService;
use PhoneServices\Core\Logger;

require_once __DIR__ . '/../../vendor/autoload.php';

$input = file_get_contents('php://input');
$data = json_decode($input, true);

$type = $_GET['type'] ?? 'sms';

if ($type === 'sms') {
    $smsService = new SmsService();
    
    $messageData = [
        'provider' => 'vonage',
        'message_id' => $data['messageId'] ?? '',
        'from' => $data['msisdn'] ?? '',
        'to' => $data['to'] ?? '',
        'body' => $data['text'] ?? '',
        'channel' => 'sms',
    ];
    
    $result = $smsService->receiveInboundMessage($messageData);
    
    Logger::info('Vonage SMS webhook received', $messageData);
    
    http_response_code(200);
    echo 'OK';
    exit;
}

if ($type === 'voice') {
    $voipService = new VoipService();
    
    $callId = $data['uuid'] ?? '';
    $status = $data['status'] ?? '';
    $direction = $data['direction'] ?? '';
    $duration = $data['duration'] ?? 0;
    
    if ($callId) {
        $voipService->updateCallStatus($callId, $status, [
            'duration' => $duration,
            'direction' => $direction,
        ]);
        
        Logger::info('Vonage voice webhook received', ['call_id' => $callId, 'status' => $status]);
    }
    
    http_response_code(200);
    echo 'OK';
    exit;
}

if ($type === 'dlr') {
    $messageId = $data['messageId'] ?? '';
    $status = $data['status'] ?? '';
    
    Logger::info('Vonage DLR received', ['message_id' => $messageId, 'status' => $status]);
    
    http_response_code(200);
    echo 'OK';
    exit;
}
