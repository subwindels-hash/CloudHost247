<?php
namespace CloudHost247\Marketing\Services;

use CloudHost247\Marketing\Domain\EventType;
use CloudHost247\Marketing\Domain\SuppressionReason;
use CloudHost247\Marketing\Repositories\CampaignRepository;
use CloudHost247\Marketing\Repositories\EventRepository;
use CloudHost247\Marketing\Repositories\QueueRepository;
use CloudHost247\Marketing\Repositories\SettingsRepository;
use CloudHost247\Marketing\Repositories\SubscriberRepository;
use CloudHost247\Marketing\Security\InputValidator;
use WHMCS\Database\Capsule;

/**
 * Open/click/unsubscribe tracking (requirement #25, #26, #29).
 *
 * How it works, and what it refuses to do:
 *
 *   - Every message gets an opaque 128-bit `tracking_token` (created with the
 *     queue row). Tracking URLs carry only that token and — for clicks — a link
 *     id. No address, no subscriber id, no campaign name ever appears in a URL.
 *   - Clicks redirect **only** to URLs that are registered for that campaign in
 *     `…_links`. A forged link id resolves to nothing, so this endpoint can never
 *     be used as an open redirect for somebody else's site.
 *   - Opens and clicks are recorded once per message (a pixel fetched twice by a
 *     scanner, or an inbox prefetching a link, must not inflate a report), but a
 *     recipient clicking the same link again still reaches the destination.
 *   - Unsubscribing is a POST-or-confirm flow: a GET never changes anything,
 *     because mail clients and security scanners fetch links automatically.
 *   - Every rate a report shows is a count of these recorded events.
 */
final class TrackingService
{
    /** Closed set of personalisation tokens allowed in campaign content. */
    const TOKENS = array('first_name', 'last_name', 'email', 'company', 'unsubscribe_url', 'physical_address');

    private $campaigns;
    private $queue;
    private $events;
    private $subscribers;
    private $settings;
    private $subscriptions;

    public function __construct(
        CampaignRepository $campaigns = null,
        QueueRepository $queue = null,
        EventRepository $events = null,
        SubscriberRepository $subscribers = null,
        SettingsRepository $settings = null,
        SubscriptionService $subscriptions = null
    ) {
        $this->campaigns = $campaigns ?: new CampaignRepository();
        $this->queue = $queue ?: new QueueRepository();
        $this->events = $events ?: new EventRepository();
        $this->subscribers = $subscribers ?: new SubscriberRepository();
        $this->settings = $settings ?: new SettingsRepository();
        $this->subscriptions = $subscriptions ?: new SubscriptionService();
    }

    // ------------------------------------------------------------- composition

    /**
     * Builds the message a real send hands to the transport: personalisation,
     * registered+rewritten links, the open pixel and the unsubscribe footer.
     *
     * @param object $campaign campaign row
     * @param object $queueRow the claimed queue row (token + idempotency)
     * @param object|null $subscriber subscriber row, when the recipient has one
     * @param array $content optional override from a queued automation step
     *                       (subject, html, text, from_name, from_email, reply_to)
     * @return array message for MessageTransport::send()
     */
    public function compose($campaign, $queueRow, $subscriber = null, array $content = array())
    {
        $token = (string) $queueRow->tracking_token;
        $personal = $this->personalisation($subscriber, (string) $queueRow->email);
        $base = $this->baseUrl();

        // A queued automation message carries its own content: the step's
        // template, subject and sender. The container campaign still owns the
        // links and the ledger rows, so everything downstream is unchanged.
        // The subject is personalised too, in text context: a recipient who is
        // greeted by name in the body should be greeted by name in the inbox.
        $subject = $this->personalise(isset($content['subject']) ? (string) $content['subject'] : (string) $campaign->subject, $personal, '', false);
        $htmlSource = isset($content['html']) ? (string) $content['html'] : (string) $campaign->html;
        $textSource = isset($content['text']) ? (string) $content['text'] : (string) $campaign->text;
        $fromEmail = isset($content['from_email']) && trim((string) $content['from_email']) !== '' ? (string) $content['from_email'] : (string) $campaign->from_email;
        $fromName = isset($content['from_name']) && trim((string) $content['from_name']) !== '' ? (string) $content['from_name'] : (string) $campaign->from_name;
        $replyTo = isset($content['reply_to']) && trim((string) $content['reply_to']) !== '' ? (string) $content['reply_to'] : (string) $campaign->reply_to;

        // Personalisation values are subscriber-controlled, so in the HTML part
        // they are escaped: a name is a name, never markup. The text part stays
        // literal because there is no markup context to escape for.
        $html = $this->personalise($htmlSource, $personal, $token, true);
        $text = $this->personalise($textSource, $personal, $token);

        if ($this->settingEnabled('open_tracking_enabled') && $html !== '') {
            $html = $this->rewriteLinks($campaign, $html, $token);
            $html = $this->injectPixel($html, $token);
        } elseif ($html !== '' && $this->settingEnabled('click_tracking_enabled')) {
            $html = $this->rewriteLinks($campaign, $html, $token);
        }

        // The unsubscribe route must exist even when HTML tracking is off: an
        // address that cannot leave a list is a compliance problem, not a feature.
        $unsubscribeUrl = $this->unsubscribeUrl($token);
        $html = $this->appendFooter($html, $unsubscribeUrl);
        $text = rtrim($text) . "\n\n--\nUnsubscribe: " . $unsubscribeUrl . "\n";

        $body = array(
            'to' => (string) $queueRow->email,
            'to_name' => trim($personal['first_name'] . ' ' . $personal['last_name']),
            'subject' => $subject,
            'html' => $html,
            'text' => $text,
            'from_email' => $fromEmail,
            'from_name' => $fromName,
            'reply_to' => $replyTo,
            'headers' => array(
                'X-CloudHost247-Campaign' => (int) $campaign->id,
                'List-Unsubscribe' => '<' . $unsubscribeUrl . '>',
                'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click',
            ),
        );
        return $body;
    }

    /**
     * A test message: same personalisation and footer, but no pixel, no click
     * rewriting and no token — a test must never appear in a campaign's numbers.
     */
    public function composeTest($campaign, $to, $subscriber = null)
    {
        $personal = $this->personalisation($subscriber, (string) $to);
        $html = $this->personalise((string) $campaign->html, $personal, '', true);
        $text = $this->personalise((string) $campaign->text, $personal, '');
        $notice = 'This is a test message sent from the CloudHost247 Marketing console. '
            . 'Tracking is disabled for tests, and the unsubscribe link appears only in real sends.';
        if ($html !== '') { $html = $this->appendFooter($html, '', $notice); }
        return array(
            'to' => (string) $to,
            'to_name' => trim($personal['first_name'] . ' ' . $personal['last_name']),
            'subject' => '[Test] ' . (string) $campaign->subject,
            'html' => $html,
            'text' => rtrim($text) . "\n\n--\n" . $notice . "\n",
            'from_email' => (string) $campaign->from_email,
            'from_name' => (string) $campaign->from_name,
            'reply_to' => (string) $campaign->reply_to,
            'headers' => array('X-CloudHost247-Campaign' => (int) $campaign->id, 'X-CloudHost247-Test' => '1'),
        );
    }

    /**
     * Registers every http(s) link in a campaign body and returns the rewritten
     * HTML with click URLs. Only http(s) survives; anything else (javascript:,
     * data:, mailto:) is left untouched and can never be tracked or redirected.
     */
    public function rewriteLinks($campaign, $html, $token)
    {
        if (strpos($html, '<') === false) { return $html; }
        $campaignId = (int) $campaign->id;
        return (string) preg_replace_callback(
            '/(<a\\s[^>]*href\\s*=\\s*)(["\\\'])([^"\\\']+)(["\\\'])/i',
            function ($match) use ($campaignId, $token) {
                $url = html_entity_decode($match[3], ENT_QUOTES, 'UTF-8');
                $safe = $this->safeHttpUrl($url);
                if ($safe === '') { return $match[0]; }
                $link = $this->registerLink($campaignId, $safe);
                if ($link === null) { return $match[0]; }
                $tracked = $this->escape($this->clickUrl($token, (int) $link->id));
                return $match[1] . $match[2] . $tracked . $match[4];
            },
            $html
        );
    }

    /** Inserts the 1x1 pixel immediately before </body> (or appends it). */
    public function injectPixel($html, $token)
    {
        if (trim($html) === '') { return $html; }
        $pixel = '<img src="' . $this->escape($this->openUrl($token)) . '" width="1" height="1" alt="" '
            . 'style="display:block;border:0;outline:none;" />';
        $position = stripos($html, '</body>');
        if ($position === false) { return $html . $pixel; }
        return substr($html, 0, $position) . $pixel . substr($html, $position);
    }

    /**
     * Substitutes the closed token set; unknown tokens are blanked, never echoed.
     *
     * `$htmlContext` escapes the substituted values for HTML. Those values come
     * from the subscriber's own record (a first name, a company), so without this
     * a subscriber could put markup — or a phishing link — inside somebody
     * else's email by editing their own profile.
     */
    public function personalise($content, array $personal, $token = '', $htmlContext = false)
    {
        $values = array(
            'first_name' => isset($personal['first_name']) ? (string) $personal['first_name'] : '',
            'last_name' => isset($personal['last_name']) ? (string) $personal['last_name'] : '',
            'email' => isset($personal['email']) ? (string) $personal['email'] : '',
            'company' => isset($personal['company']) ? (string) $personal['company'] : '',
        );
        if ($token !== '') { $values['unsubscribe_url'] = $this->unsubscribeUrl($token); }
        $values['physical_address'] = (string) $this->settings->get('physical_address');

        return (string) preg_replace_callback('/\\{\\{\\s*([a-z_]+)\\s*\\}\\}/i', function ($match) use ($values, $htmlContext) {
            $key = strtolower($match[1]);
            if (!in_array($key, self::TOKENS, true)) { return ''; }
            if ($key === 'unsubscribe_url' && !isset($values[$key])) { return ''; }
            $value = isset($values[$key]) ? (string) $values[$key] : '';
            return $htmlContext ? $this->escape($value) : $value;
        }, (string) $content);
    }

    public function personalisation($subscriber, $email = '')
    {
        if (!$subscriber) { return array('first_name' => '', 'last_name' => '', 'company' => '', 'email' => (string) $email); }
        return array(
            'first_name' => isset($subscriber->first_name) ? (string) $subscriber->first_name : '',
            'last_name' => isset($subscriber->last_name) ? (string) $subscriber->last_name : '',
            'company' => isset($subscriber->company) ? (string) $subscriber->company : '',
            'email' => isset($subscriber->email) ? (string) $subscriber->email : (string) $email,
        );
    }

    /**
     * Registered links are read and written here (module table only — the module
     * never touches WHMCS core tables). The table is the redirect allow-list, so
     * link rows must only ever be created from composed campaign content.
     */
    /** Registered links for a campaign (admin + analytics view). */
    public function linksFor($campaignId)
    {
        $rows = Capsule::table('mod_cloudhost247_marketing_links')
            ->where('campaign_id', (int) $campaignId)
            ->orderBy('id', 'asc')
            ->limit(500)
            ->get();
        return $rows ? $rows->all() : array();
    }

    public function registerLink($campaignId, $url)
    {
        $url = $this->safeHttpUrl($url);
        if ($url === '') { throw new \InvalidArgumentException('Only http(s) links can be tracked.'); }
        $hash = hash('sha256', $url);
        $existing = Capsule::table('mod_cloudhost247_marketing_links')
            ->where('campaign_id', (int) $campaignId)
            ->where('url_hash', $hash)
            ->first();
        if ($existing) { return $existing; }
        $id = Capsule::table('mod_cloudhost247_marketing_links')->insertGetId(array(
            'campaign_id' => (int) $campaignId,
            'url_hash' => $hash,
            'url' => substr($url, 0, 255),
            'label' => '',
            'created_at' => date('Y-m-d H:i:s'),
        ));
        return Capsule::table('mod_cloudhost247_marketing_links')->where('id', (int) $id)->first();
    }

    /** The registered destination for a link id, or null (never a redirect target). */
    public function linkDestination($campaignId, $linkId)
    {
        $row = Capsule::table('mod_cloudhost247_marketing_links')
            ->where('id', (int) $linkId)
            ->where('campaign_id', (int) $campaignId)
            ->first();
        if (!$row) { return null; }
        $url = $this->safeHttpUrl((string) $row->url);
        return $url === '' ? null : $url;
    }

    // ------------------------------------------------------------- endpoint work

    /** Resolves a tracking token; returns null for anything unknown or malformed. */
    public function resolveToken($token)
    {
        $token = strtolower(trim((string) $token));
        if (!preg_match('/^[a-f0-9]{32,64}$/', $token)) { return null; }
        return $this->queue->findByTrackingToken($token);
    }

    /** Records one open per message; returns true when it was the first. */
    public function recordOpen($queueRow)
    {
        if ($this->events->exists(EventType::OPENED, (int) $queueRow->id)) { return false; }
        $this->events->record(EventType::OPENED, (int) $queueRow->campaign_id, (int) $queueRow->id, $queueRow->subscriber_id, array());
        return true;
    }

    /** Records one click per link per message; a repeat click is not a new click. */
    public function recordClick($queueRow, $linkId)
    {
        if ($this->events->exists(EventType::CLICKED, (int) $queueRow->id, array('link_id' => (int) $linkId))) { return false; }
        $this->events->record(EventType::CLICKED, (int) $queueRow->campaign_id, (int) $queueRow->id, $queueRow->subscriber_id, array('link_id' => (int) $linkId));
        return true;
    }

    /**
     * Unsubscribes the address behind a token and records the event once.
     * Suppression is applied by SubscriptionService, so the address leaves every
     * future audience as well as this campaign's.
     */
    public function unsubscribe($queueRow, $source = 'recipient')
    {
        $email = (string) $queueRow->email;
        $result = $this->subscriptions->unsubscribe($email, $source, 'campaign unsubscribe link');
        // Only a call that changed something is an event. Mail clients, scanners
        // and people double-click: a repeat unsubscribe request must not inflate
        // the reporting the operator reads.
        $changed = !empty($result['changed']) || !empty($result['suppression_created']);
        if (!empty($result['ok']) && $changed) {
            $this->events->record(EventType::UNSUBSCRIBED, (int) $queueRow->campaign_id, (int) $queueRow->id, $queueRow->subscriber_id, array('source' => $source));
        }
        return $result;
    }

    /**
     * Records bounce evidence for an address. Bounces are only ever recorded from
     * real evidence (a DSN pasted by an operator in SESSION 8, a provider report
     * later); this never guesses that a message bounced because time passed.
     *
     * @return array{ok:bool,type:string,reason:string}
     */
    public function recordBounce($email, $type, $detail = '')
    {
        $type = $type === 'hard' ? 'hard' : ($type === 'soft' ? 'soft' : '');
        if ($type === '') { return array('ok' => false, 'type' => '', 'reason' => 'unknown_type'); }
        try {
            $email = InputValidator::email($email);
        } catch (\InvalidArgumentException $error) {
            return array('ok' => false, 'type' => $type, 'reason' => 'invalid_address');
        }
        $subscriber = $this->subscribers->findByEmail($email);
        $result = $this->subscriptions->recordBounce($email, $type, (int) $this->settings->get('bounce_soft_threshold'));
        $this->events->record(EventType::BOUNCED, null, null, $subscriber ? (int) $subscriber->id : null, array(
            'kind' => $type,
            'source' => $detail !== '' ? substr($detail, 0, 60) : 'dsn',
        ));
        return array('ok' => true, 'type' => $type, 'reason' => isset($result['reason']) ? (string) $result['reason'] : '');
    }

    // ------------------------------------------------------------------ urls

    /**
     * The public base for tracking links: the module's own setting (Delivery
     * Settings → Public tracking base URL). The module never reads WHMCS core
     * tables, and a request-derived host is only a last resort for the endpoint
     * itself — a cron has no request, so an unset base URL produces relative
     * links and the campaign checklist refuses to send until it is configured.
     */
    public function baseUrl()
    {
        $configured = trim((string) $this->settings->get('tracking_base_url'));
        if ($configured !== '' && $this->safeHttpUrl($configured) !== '') {
            return rtrim($configured, '/');
        }
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $host = isset($_SERVER['HTTP_HOST']) ? (string) $_SERVER['HTTP_HOST'] : '';
        $host = preg_match('/^[A-Za-z0-9.\-]+(:\d{1,5})?$/', $host) ? $host : '';
        return $host === '' ? '' : $scheme . '://' . $host;
    }

    public function endpointUrl()
    {
        $base = $this->baseUrl();
        return $base === '' ? 'cloudhost247-marketing-track.php' : $base . '/cloudhost247-marketing-track.php';
    }

    public function openUrl($token)
    {
        return $this->endpointUrl() . '?e=open&c=' . rawurlencode((string) $token);
    }

    public function clickUrl($token, $linkId)
    {
        return $this->endpointUrl() . '?e=click&c=' . rawurlencode((string) $token) . '&l=' . (int) $linkId;
    }

    public function unsubscribeUrl($token)
    {
        return $this->endpointUrl() . '?e=unsubscribe&c=' . rawurlencode((string) $token);
    }

    // ----------------------------------------------------------------- helpers

    private function appendFooter($html, $unsubscribeUrl, $notice = '')
    {
        if (trim($html) === '') { return $html; }
        $company = trim((string) $this->settings->get('company_name'));
        $address = trim((string) $this->settings->get('physical_address'));
        $footer = '<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e3e8ee;'
            . 'font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b7a8d;">';
        if ($notice !== '') { $footer .= '<p style="margin:0 0 6px;">' . $this->escape($notice) . '</p>'; }
        if ($company !== '') { $footer .= '<p style="margin:0 0 4px;">' . $this->escape($company) . '</p>'; }
        if ($address !== '') { $footer .= '<p style="margin:0 0 4px;">' . $this->escape($address) . '</p>'; }
        if ($unsubscribeUrl !== '') {
            $footer .= '<p style="margin:0;">You are receiving this because you subscribed to CloudHost247 updates. '
                . '<a href="' . $this->escape($unsubscribeUrl) . '" style="color:#5b6b7d;">Unsubscribe</a>.</p>';
        }
        $footer .= '</div>';
        $position = stripos($html, '</body>');
        if ($position === false) { return $html . $footer; }
        return substr($html, 0, $position) . $footer . substr($html, $position);
    }

    /** http/https only, no credentials, no control characters, bounded length. */
    private function safeHttpUrl($url)
    {
        $url = trim((string) $url);
        if ($url === '' || strlen($url) > 255) { return ''; }
        if (preg_match('/[\x00-\x20\x7F]/', $url)) { return ''; }
        if (!preg_match('#^https?://#i', $url)) { return ''; }
        $parts = parse_url($url);
        if (!is_array($parts) || empty($parts['host'])) { return ''; }
        if (isset($parts['user']) || isset($parts['pass'])) { return ''; }
        if (!preg_match('/^[A-Za-z0-9.\-]+$/', (string) $parts['host'])) { return ''; }
        return $url;
    }

    private function settingEnabled($key)
    {
        return (string) $this->settings->get($key) === '1';
    }

    private function escape($value)
    {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    }
}
