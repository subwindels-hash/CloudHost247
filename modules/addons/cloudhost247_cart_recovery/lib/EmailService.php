<?php
/**
 * Email delivery through the existing WHMCS mail system.
 *
 * No SMTP client, queue or transport is introduced here: delivery is the
 * WHMCS Local API "SendEmail" call, and the message bodies live in normal
 * WHMCS "General" email templates so administrators can edit them in
 * Setup → Email Templates.
 */

namespace CloudHost247\CartRecovery;

use WHMCS\Database\Capsule;

final class EmailService
{
    const TEMPLATE_PREFIX = 'CloudHost247 Abandoned Cart Reminder ';

    public static function templateName($number)
    {
        return self::TEMPLATE_PREFIX . (int) $number;
    }

    /**
     * Create the three editable templates if they are missing. Existing
     * templates are never overwritten so admin edits survive upgrades.
     *
     * @return int number of templates created
     */
    public static function ensureTemplates()
    {
        $created = 0;
        for ($number = 1; $number <= 3; $number++) {
            $name = self::templateName($number);
            $exists = Capsule::table('tblemailtemplates')->where('name', $name)->first();
            if ($exists) {
                continue;
            }
            Capsule::table('tblemailtemplates')->insert(array(
                'type' => 'general',
                'name' => $name,
                'subject' => self::defaultSubject($number),
                'message' => self::defaultBody($number),
                'attachments' => '',
                'fromname' => '',
                'fromemail' => '',
                'disabled' => 0,
                'custom' => 1,
                'language' => '',
                'copyto' => '',
                'blindcopyto' => '',
                'plaintext' => 0,
            ));
            $created++;
        }
        return $created;
    }

    /**
     * Send one reminder. Throws on failure so the caller can record it; the
     * caller is always cron or an explicit admin action, never a cart page.
     *
     * @param object $recovery recovery row
     * @param int    $number   reminder number (1-3)
     * @param string $rawToken raw recovery token (URL only, never stored/logged)
     */
    public static function sendReminder($recovery, $number, $rawToken)
    {
        $email = RecoveryService::normaliseEmail(isset($recovery->email) ? $recovery->email : '');
        if ($email === '') {
            throw new \RuntimeException('Recipient address is not a valid email address');
        }
        if (!TokenService::valid($rawToken)) {
            throw new \RuntimeException('Recovery token could not be prepared for this record');
        }
        $variables = self::mergeVariables($recovery, $rawToken);

        if (empty($recovery->client_id)) {
            // Guests have no WHMCS client record, so SendEmail cannot address
            // them. WHMCS's own mailer is used instead — the same transport
            // and credentials the rest of WHMCS uses; no new SMTP layer.
            return self::sendGuest($email, $number, $variables);
        }

        if (!function_exists('localAPI')) {
            throw new \RuntimeException('WHMCS Local API is unavailable');
        }
        $result = localAPI('SendEmail', array(
            'messagename' => self::templateName($number),
            'id' => (int) $recovery->client_id,
            'customvars' => base64_encode(serialize($variables)),
        ));
        $status = is_array($result) && isset($result['result']) ? (string) $result['result'] : '';
        if ($status !== 'success') {
            $message = is_array($result) && isset($result['message']) ? (string) $result['message'] : 'unknown error';
            throw new \RuntimeException('WHMCS SendEmail rejected the message: ' . substr($message, 0, 200));
        }
        return true;
    }

    /**
     * Deliver to an address that has no WHMCS client record using WHMCS's own
     * mail infrastructure (\WHMCS\Mail\Message). The body comes from the same
     * administrator-editable template.
     */
    private static function sendGuest($email, $number, array $variables)
    {
        if (!class_exists('WHMCS\\Mail\\Message')) {
            throw new \RuntimeException('Guest delivery requires the WHMCS mail service, which is unavailable');
        }
        $message = new \WHMCS\Mail\Message();
        $message->setRecipients('to', array(array($email, $variables['customer_name'])));
        $message->setSubject(self::substitute(self::subjectFor($number), $variables));
        $message->setBody(self::renderGuestMessage($number, $variables));
        $message->send();
        return true;
    }

    /** Subject line, preferring the administrator-edited template. */
    public static function subjectFor($number)
    {
        try {
            $row = Capsule::table('tblemailtemplates')->where('name', self::templateName($number))->first();
            if ($row && !empty($row->subject)) {
                return (string) $row->subject;
            }
        } catch (\Throwable $e) {
            // fall through to the shipped default
        }
        return self::defaultSubject($number);
    }

    /** Merge variables exposed to the WHMCS template. */
    public static function mergeVariables($recovery, $rawToken)
    {
        $first = trim((string) (isset($recovery->first_name) ? $recovery->first_name : ''));
        $last = trim((string) (isset($recovery->last_name) ? $recovery->last_name : ''));
        $snapshot = isset($recovery->cart_snapshot) ? $recovery->cart_snapshot : '';
        $currency = isset($recovery->currency) ? (string) $recovery->currency : '';
        $total = isset($recovery->cart_total) && is_numeric($recovery->cart_total) ? number_format((float) $recovery->cart_total, 2) : '';

        return array(
            'customer_name' => trim($first . ' ' . $last) !== '' ? trim($first . ' ' . $last) : 'Customer',
            'customer_first_name' => $first !== '' ? $first : 'there',
            'customer_email' => (string) $recovery->email,
            'cart_items' => self::itemsHtml($snapshot),
            'cart_items_text' => CartSnapshot::label($snapshot),
            'cart_total' => $total,
            'cart_currency' => $currency,
            'recovery_url' => RecoveryService::recoveryUrl($rawToken),
            'recovery_expires' => (string) (isset($recovery->token_expires_at) ? $recovery->token_expires_at : ''),
            'unsubscribe_url' => RecoveryService::unsubscribeUrl($rawToken),
            'company_name' => self::companyName(),
            'company_domain' => RecoveryService::baseUrl(),
        );
    }

    public static function itemsHtml($snapshot)
    {
        $rows = '';
        foreach (CartSnapshot::items($snapshot) as $item) {
            $name = htmlspecialchars((string) $item['name'], ENT_QUOTES, 'UTF-8');
            $domain = $item['domain'] !== '' ? ' &mdash; ' . htmlspecialchars((string) $item['domain'], ENT_QUOTES, 'UTF-8') : '';
            $cycle = $item['billingcycle'] !== '' ? htmlspecialchars((string) $item['billingcycle'], ENT_QUOTES, 'UTF-8') : '';
            $qty = max(1, (int) $item['quantity']);
            $rows .= '<tr><td style="padding:6px 12px 6px 0">' . $name . $domain . '</td>'
                . '<td style="padding:6px 12px 6px 0">' . $cycle . '</td>'
                . '<td style="padding:6px 0">&times; ' . $qty . '</td></tr>';
        }
        if ($rows === '') {
            return '';
        }
        return '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">' . $rows . '</table>';
    }

    /** Replace {$variable} placeholders with their merge values. */
    public static function substitute($text, array $variables)
    {
        $search = array();
        $replace = array();
        foreach ($variables as $key => $value) {
            $search[] = '{$' . $key . '}';
            $replace[] = (string) $value;
        }
        return str_replace($search, $replace, (string) $text);
    }

    public static function companyName()
    {
        if (defined('CONFIG_COMPANYNAME') && CONFIG_COMPANYNAME) {
            return CONFIG_COMPANYNAME;
        }
        try {
            $row = Capsule::table('tblconfiguration')->where('setting', 'CompanyName')->first();
            if ($row && !empty($row->value)) {
                return (string) $row->value;
            }
        } catch (\Throwable $e) {
            // display-only
        }
        return 'CloudHost247';
    }

    public static function defaultSubject($number)
    {
        switch ((int) $number) {
            case 1:
                return 'Your CloudHost247 cart is still saved';
            case 2:
                return 'Still thinking it over? Your CloudHost247 cart is waiting';
            default:
                return 'Last reminder: your saved CloudHost247 cart';
        }
    }

    /**
     * Default template bodies. Deliberately factual: nothing is reserved, no
     * price is guaranteed and the customer is told plainly that no order has
     * been placed. Admins can rewrite these in WHMCS at any time.
     */
    public static function defaultBody($number)
    {
        $intro = array(
            1 => 'You left some items in your cart at {$company_name}. Nothing has been ordered yet — we saved the contents so you can pick up where you left off.',
            2 => 'Your cart at {$company_name} is still saved. No order has been placed, and the items are not reserved.',
            3 => 'This is the last reminder about the cart you saved at {$company_name}. After the link below expires the saved cart is removed and you would need to start again.',
        );
        $text = isset($intro[(int) $number]) ? $intro[(int) $number] : $intro[1];

        return '<p>Hello {$customer_first_name},</p>'
            . '<p>' . $text . '</p>'
            . '<p><strong>Your saved cart</strong></p>'
            . '{$cart_items}'
            . '<p>Estimated total at the time it was saved: {$cart_currency} {$cart_total}.'
            . ' Prices shown are the prices captured then and may change; the total is confirmed at checkout.</p>'
            . '<p><a href="{$recovery_url}" style="background:#0b5fff;color:#ffffff;padding:12px 22px;border-radius:4px;'
            . 'text-decoration:none;display:inline-block">Recover My Cart</a></p>'
            . '<p>This recovery link works until {$recovery_expires} and can only restore this cart. '
            . 'It does not sign you in to your account.</p>'
            . '<p style="font-size:12px;color:#666">Not interested? '
            . '<a href="{$unsubscribe_url}">Stop receiving abandoned-cart reminders</a>.<br>'
            . '{$company_name} &mdash; {$company_domain}</p>';
    }

    /**
     * Guest recipients have no WHMCS client record, so the body is rendered
     * from the same editable template with the merge variables substituted.
     */
    public static function renderGuestMessage($number, array $variables)
    {
        $body = null;
        try {
            $row = Capsule::table('tblemailtemplates')->where('name', self::templateName($number))->first();
            if ($row && isset($row->message)) {
                $body = (string) $row->message;
            }
        } catch (\Throwable $e) {
            $body = null;
        }
        if ($body === null || $body === '') {
            $body = self::defaultBody($number);
        }
        return self::substitute($body, $variables);
    }
}
