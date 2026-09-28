<?php
/**
 * Twilio Webhook Handler
 * Handles inbound SMS and voice callbacks from Twilio
 */

use PhoneServices\Services\SmsService;
use PhoneServices\Services\VoipService;
use PhoneServices\Core\Logger;

require_once dirname(__DIR__, 2) . '/bootstrap.php';

// Reject forged callbacks before any state change. Twilio signs the exact public URL.
$signature = $_SERVER['HTTP_X_TWILIO_SIGNATURE'] ?? '';
$authToken = (string) \PhoneServices\Core\Config::get('twilio_auth_token', '');
$publicBase = rtrim((string) \PhoneServices\Core\Config::get('webhook_base_url', ''), '/');
$requestUrl = $publicBase
    ? $publicBase . ($_SERVER['REQUEST_URI'] ?? '')
    : ((isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? '') . ($_SERVER['REQUEST_URI'] ?? ''));
if (!$signature || !$authToken || !class_exists('Twilio\\Security\\RequestValidator')
    || !(new \Twilio\Security\RequestValidator($authToken))->validate($signature, $requestUrl, $_POST)) {
    http_response_code(403);
    echo 'Invalid signature';
    exit;
}

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
