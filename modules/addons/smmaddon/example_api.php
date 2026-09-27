<?php
/**
 * Example SMM Panel API Integration Script
 * 
 * This demonstrates the expected API format for your SMM panel.
 * You can use this as a reference when configuring the module.
 */

// Example 1: Check Balance
$balancePayload = [
    'key'    => 'your_api_key_here',
    'action' => 'balance',
];

// Example 2: Get Services
$servicesPayload = [
    'key'    => 'your_api_key_here',
    'action' => 'services',
];

// Example 3: Place Order
$orderPayload = [
    'key'      => 'your_api_key_here',
    'action'   => 'add',
    'service'  => '123',       // SMM Service ID
    'link'     => 'https://instagram.com/username',
    'quantity' => '1000',      // Amount to order
    // Optional parameters:
    // 'comments'  => "comment1\ncomment2\ncomment3",
    // 'usernames' => "user1\nuser2\nuser3",
    // 'hashtag'   => 'myhashtag',
    // 'runs'      => 10,
    // 'interval'  => 60,
];

// Example 4: Check Order Status
$statusPayload = [
    'key'    => 'your_api_key_here',
    'action' => 'status',
    'order'  => '123456789',   // SMM Order ID returned from add action
];

// Example 5: Check Multiple Orders
$multiStatusPayload = [
    'key'    => 'your_api_key_here',
    'action' => 'status',
    'orders' => '123456789,987654321,111222333',
];

// Example 6: Refill Order
$refillPayload = [
    'key'    => 'your_api_key_here',
    'action' => 'refill',
    'order'  => '123456789',
];

// Example 7: Cancel Order
$cancelPayload = [
    'key'    => 'your_api_key_here',
    'action' => 'cancel',
    'order'  => '123456789',
];

/**
 * Example cURL Request Helper
 */
function smmApiRequest($apiUrl, $payload) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $apiUrl);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($payload));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/x-www-form-urlencoded',
        'Accept: application/json',
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($error) {
        return ['error' => $error];
    }
    
    $decoded = json_decode($response, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        return ['error' => 'Invalid JSON response', 'raw' => $response];
    }
    
    return $decoded;
}

/**
 * Expected Success Responses
 */

// Balance Response
$balanceResponse = [
    "balance"  => "100.50",
    "currency" => "USD",
];

// Services Response (array of services)
$servicesResponse = [
    [
        "service"  => "123",
        "name"     => "Instagram Followers - Real",
        "type"     => "default",
        "category" => "Instagram",
        "rate"     => "0.50",    // Price per 1000
        "min"      => "100",
        "max"      => "100000",
        "refill"   => true,
        "cancel"   => true,
    ],
    [
        "service"  => "124",
        "name"     => "YouTube Views - HQ",
        "type"     => "default",
        "category" => "YouTube",
        "rate"     => "1.20",
        "min"      => "1000",
        "max"      => "1000000",
        "refill"   => false,
        "cancel"   => true,
    ],
];

// Add Order Response
$addOrderSuccess = [
    "order" => 123456789,
];

$addOrderError = [
    "error" => "Invalid link format",
];

// Status Response
$statusResponse = [
    "status"      => "In progress",     // Pending, In progress, Completed, Canceled, Partial, Refunded
    "charge"      => "0.5000",
    "start_count" => "1500",
    "remains"     => "500",
    "currency"    => "USD",
];

// Multiple Status Response
$multiStatusResponse = [
    "123456789" => [
        "status" => "Completed",
        "charge" => "0.50",
    ],
    "987654321" => [
        "status" => "In progress",
        "charge" => "1.20",
    ],
];

// Refill Response
$refillSuccess = [
    "refill" => "98765",    // Refill request ID
];

$refillError = [
    "error" => "This order cannot be refilled",
];

// Cancel Response
$cancelSuccess = [
    "cancel" => "ok",
];

$cancelError = [
    "error" => "Order is too old to cancel",
];

/**
 * Status Mapping used by WHMCS Module
 */
$statusMapping = [
    'pending'      => 'pending',
    'processing'   => 'processing',
    'in progress'  => 'inprogress',
    'inprogress'   => 'inprogress',
    'completed'    => 'completed',
    'complete'     => 'completed',
    'canceled'     => 'canceled',
    'cancelled'    => 'canceled',
    'partial'      => 'partial',
    'refunded'     => 'refunded',
    'error'        => 'error',
];

echo "SMM API Integration Reference loaded. Use the payloads above to test your panel API.\n";
