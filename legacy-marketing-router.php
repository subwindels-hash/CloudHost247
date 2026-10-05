<?php
/**
 * Preserved original marketing tracking endpoint logic
 * (was the body of cloudhost247-marketing-track.php). Reached only through
 * cloudhost247-marketing-track.php, which loads init.php first.
 */

/**
 * CloudHost247 Marketing — public tracking endpoint.
 *
 * This is the only web-reachable file of the email-marketing addon. It serves
 * four things and nothing else:
 *
 *   cloudhost247-marketing-track.php?e=open&c=<token>         1x1 pixel
 *   cloudhost247-marketing-track.php?e=click&c=<token>&l=<id> 302 to the registered link
 *   cloudhost247-marketing-track.php?e=unsubscribe&c=<token>  confirmation page
 *   POST (same URL, e=unsubscribe)                            one-click unsubscribe
 *
 * The token is a per-message secret created with the queue row; unknown tokens
 * receive a plain 404. No address, campaign name or subscriber identifier is ever
 * accepted or returned, and the click redirect only ever targets a URL registered
 * for that campaign (no open redirect).
 *
 * Copied to the WHMCS web root during installation, next to init.php. If the
 * marketing addon is not active the endpoint simply answers 404.
 */



$bootstrap = __DIR__ . '/modules/addons/cloudhost247_marketing/bootstrap.php';
if (!is_file($bootstrap)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=UTF-8');
    exit('Not found');
}
require_once $bootstrap;

try {
    $controller = new \CloudHost247\Marketing\Http\TrackController();
    $response = $controller->handle($_GET, $_POST, isset($_SERVER['REQUEST_METHOD']) ? (string) $_SERVER['REQUEST_METHOD'] : 'GET');
} catch (\Throwable $error) {
    $response = array('status' => 404, 'headers' => array('Content-Type' => 'text/plain; charset=UTF-8'), 'body' => 'Not found', 'redirect' => null);
}

http_response_code((int) $response['status']);
foreach ($response['headers'] as $name => $value) {
    header($name . ': ' . $value);
}
if ($response['redirect'] === null && $response['body'] !== '') {
    echo $response['body'];
}
exit;

