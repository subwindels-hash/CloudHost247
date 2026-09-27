<?php
/**
 * Twilio Webhook Handler
 * Handles inbound SMS and voice callbacks from Twilio
 */

use PhoneServices\Services\SmsService;
use PhoneServices\Services\VoipService;
use PhoneServices\Core\Logger;

require_once __DIR__ . '/../../vendor/autoload.php';

$type = $_GET['type'] ?? 'sms';

if ($type === 'sms') {
    $smsService = new SmsService();
    
    $data = [
        'provider' => 'twilio',
        'message_id' => $_POST['MessageSid'] ?? '',
        'from' => $_POST['From'] ?? '',
        'to' => $_POST['To'] ?? '',
        'body' => $_POST['Body'] ?? '',
        'channel' => 'sms',
    ];
    
    $result = $smsService->receiveInboundMessage($data);
    
    Logger::info('Twilio SMS webhook received', $data);
    
    // Return empty TwiML
    header('Content-Type: text/xml');
    echo '<?xml version="1.0" encoding="UTF-8"?>';
    echo '<Response></Response>';
    exit;
}

if ($type === 'voice') {
    $voipService = new VoipService();
    
    $callId = $_POST['CallSid'] ?? '';
    $status = $_POST['CallStatus'] ?? '';
    $from = $_POST['From'] ?? '';
    $to = $_POST['To'] ?? '';
    $duration = $_POST['CallDuration'] ?? 0;
    $price = $_POST['Price'] ?? 0;
    
    if ($callId) {
        $voipService->updateCallStatus($callId, $status, [
            'duration' => $duration,
            'price' => $price,
            'from' => $from,
            'to' => $to,
        ]);
        
        Logger::info('Twilio voice webhook received', ['call_id' => $callId, 'status' => $status]);
    }
    
    // Return TwiML response
    header('Content-Type: text/xml');
    echo '<?xml version="1.0" encoding="UTF-8"?>';
    echo '<Response>';
    echo '<Say>Thank you for calling.</Say>';
    echo '</Response>';
    exit;
}

// Status callback
if ($type === 'status') {
    $smsService = new SmsService();
    
    $messageId = $_POST['MessageSid'] ?? '';
    $status = $_POST['MessageStatus'] ?? '';
    
    if ($messageId) {
        Logger::info('Twilio status callback', ['message_id' => $messageId, 'status' => $status]);
    }
    
    http_response_code(200);
    echo 'OK';
    exit;
}
