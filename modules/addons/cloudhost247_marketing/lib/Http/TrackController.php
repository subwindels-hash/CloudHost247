<?php
namespace CloudHost247\Marketing\Http;

use CloudHost247\Marketing\Services\TrackingService;

/**
 * Public tracking endpoints (requirement #25/#26/#29).
 *
 * This controller is the only part of the module reachable without an admin
 * session, so it behaves like a public endpoint should:
 *
 *   - It is addressed by an unguessable per-message token. Unknown or malformed
 *     tokens get the same generic 404 as a missing table; nothing is confirmed
 *     to a stranger, and no address is ever echoed back.
 *   - A GET never changes state. The open pixel and click redirects record an
 *     event (idempotent per message) but the unsubscribe route only *asks*:
 *     it acts on POST, which is also what the List-Unsubscribe one-click header
 *     requires. Mail scanners fetch links; they must not unsubscribe anybody.
 *   - Redirect targets come exclusively from the campaign's own registered links,
 *     so this cannot be abused as an open redirect.
 *   - Responses are tiny, uncacheable and free of personal data.
 *
 * The controller returns a plain structure (status/headers/body/redirect) so the
 * endpoint is testable without a web server; `cloudhost247-marketing-track.php`
 * emits it.
 */
final class TrackController
{
    /**
     * The standard transparent 1x1 GIF, written as its real bytes (43 of them)
     * rather than an encoded blob: the framing is visible, nothing is obfuscated,
     * and no decoder runs on a request from a mail client.
     */
    const PIXEL = "GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!"
        . "\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;";

    private $tracking;

    public function __construct(TrackingService $tracking = null)
    {
        $this->tracking = $tracking ?: new TrackingService();
    }

    /**
     * @param array $get query parameters ($_GET)
     * @param array $post body parameters ($_POST)
     * @param string $method HTTP method
     * @return array{status:int,headers:array<string,string>,body:string,redirect:?string}
     */
    public function handle(array $get, array $post, $method = 'GET')
    {
        $method = strtoupper((string) $method);
        $event = isset($get['e']) ? (string) $get['e'] : '';
        $token = isset($get['c']) ? (string) $get['c'] : '';

        try {
            if ($event === 'open') { return $this->open($token); }
            if ($event === 'click') { return $this->click($token, isset($get['l']) ? (int) $get['l'] : 0); }
            if ($event === 'unsubscribe') { return $this->unsubscribe($token, $method, $post); }
        } catch (\Throwable $error) {
            // A tracking endpoint must never leak an exception into a mail client.
            return $this->notFound();
        }
        return $this->notFound();
    }

    // ------------------------------------------------------------------ routes

    private function open($token)
    {
        $row = $this->tracking->resolveToken($token);
        if (!$row) { return $this->notFound(); }
        $this->tracking->recordOpen($row);
        return array(
            'status' => 200,
            'headers' => array(
                'Content-Type' => 'image/gif',
                'Cache-Control' => 'no-store, no-cache, must-revalidate, max-age=0, private',
                'Pragma' => 'no-cache',
                'Content-Length' => (string) strlen(self::PIXEL),
                'X-Robots-Tag' => 'noindex, nofollow',
            ),
            'body' => self::PIXEL,
            'redirect' => null,
        );
    }

    private function click($token, $linkId)
    {
        $row = $this->tracking->resolveToken($token);
        if (!$row || $linkId <= 0) { return $this->notFound(); }
        $destination = $this->tracking->linkDestination((int) $row->campaign_id, $linkId);
        if ($destination === null) { return $this->notFound(); }
        $this->tracking->recordClick($row, $linkId);
        return array(
            'status' => 302,
            'headers' => array(
                'Location' => $destination,
                'Cache-Control' => 'no-store, no-cache, must-revalidate, max-age=0, private',
                'X-Robots-Tag' => 'noindex, nofollow',
            ),
            'body' => '',
            'redirect' => $destination,
        );
    }

    private function unsubscribe($token, $method, array $post)
    {
        $row = $this->tracking->resolveToken($token);
        if (!$row) { return $this->notFound(); }

        // RFC 8058 one-click posts "List-Unsubscribe=One-Click"; a plain form POST
        // carries the token again. Both act only on POST.
        $oneClick = isset($post['List-Unsubscribe']) && (string) $post['List-Unsubscribe'] === 'One-Click';
        if ($method === 'POST' && ($oneClick || isset($post['confirm']))) {
            $result = $this->tracking->unsubscribe($row, 'recipient');
            return array(
                'status' => 200,
                'headers' => array(
                    'Content-Type' => 'text/html; charset=UTF-8',
                    'Cache-Control' => 'no-store, max-age=0, private',
                    'X-Robots-Tag' => 'noindex, nofollow',
                ),
                'body' => $this->page(
                    'Unsubscribed',
                    '<p>This address has been removed from CloudHost247 marketing email.</p>'
                    . '<p class="muted">You will not receive further campaign email. Transactional messages about your services are unaffected.</p>',
                    '',
                    !empty($result['ok'])
                ),
                'redirect' => null,
            );
        }

        return array(
            'status' => 200,
            'headers' => array(
                'Content-Type' => 'text/html; charset=UTF-8',
                'Cache-Control' => 'no-store, max-age=0, private',
                'X-Robots-Tag' => 'noindex, nofollow',
            ),
            'body' => $this->page(
                'Unsubscribe from marketing email',
                '<p>Confirm that you no longer want to receive CloudHost247 marketing campaigns at this address.</p>'
                . '<p class="muted">This page has not changed anything yet: opening a link is not consent to unsubscribe.</p>',
                '<form method="post" action="">'
                . '<input type="hidden" name="c" value="' . htmlspecialchars($token, ENT_QUOTES, 'UTF-8') . '" />'
                . '<input type="hidden" name="e" value="unsubscribe" />'
                . '<button type="submit" name="confirm" value="1" '
                . 'style="background:#1f4e79;color:#fff;border:0;border-radius:4px;padding:10px 18px;font-size:15px;cursor:pointer;">'
                . 'Unsubscribe this address</button></form>',
                true
            ),
            'redirect' => null,
        );
    }

    // ------------------------------------------------------------------- output

    private function notFound()
    {
        return array(
            'status' => 404,
            'headers' => array('Content-Type' => 'text/plain; charset=UTF-8', 'Cache-Control' => 'no-store', 'X-Robots-Tag' => 'noindex, nofollow'),
            'body' => 'Not found',
            'redirect' => null,
        );
    }

    /** Minimal self-contained page: no client-area theme, no third-party assets. */
    private function page($title, $content, $form, $ok)
    {
        return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />'
            . '<meta name="viewport" content="width=device-width, initial-scale=1" />'
            . '<meta name="robots" content="noindex, nofollow" />'
            . '<title>' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . ' — CloudHost247</title>'
            . '<style>body{margin:0;padding:40px 16px;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#243447;}'
            . '.card{max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3e8ee;border-radius:6px;padding:28px;}'
            . 'h1{font-size:20px;margin:0 0 12px;}p{line-height:1.5;}.muted{color:#6b7a8d;font-size:13px;}'
            . '.ok{color:#1e7a3c;font-weight:600;}</style></head><body><div class="card">'
            . '<h1>' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</h1>'
            . ($ok ? '' : '')
            . $content . $form
            . '</div></body></html>';
    }
}
