<?php
/**
 * Lifecycle service for cart recovery records.
 *
 * Every public method is defensive: the WHMCS cart and checkout must keep
 * working even if this addon's tables are missing or a query fails, so the
 * hook layer catches Throwables and these methods return null/false instead
 * of throwing into a customer request.
 */

namespace CloudHost247\CartRecovery;

use WHMCS\Database\Capsule;

final class RecoveryService
{
    /**
     * Capture or refresh a cart snapshot.
     *
     * Identity strategy (requirement 34): authenticated carts are keyed by
     * client_id, guest carts by an opaque session key. Email alone is never
     * used as the identity because one customer may legitimately have several
     * cart sessions.
     *
     * @return int|null recovery id, or null when nothing was stored
     */
    public static function capture(array $context)
    {
        if (!SettingsRepository::enabled('enabled')) {
            return null;
        }
        $cart = isset($context['cart']) && is_array($context['cart']) ? $context['cart'] : array();
        $clientId = isset($context['client_id']) ? (int) $context['client_id'] : 0;
        $sessionKey = isset($context['session_key']) ? substr((string) $context['session_key'], 0, 128) : '';
        $email = self::normaliseEmail(isset($context['email']) ? $context['email'] : '');
        $currency = isset($context['currency']) ? (string) $context['currency'] : '';
        $totals = isset($context['totals']) && is_array($context['totals']) ? $context['totals'] : array();

        if ($clientId <= 0 && $sessionKey === '') {
            return null;
        }
        if ($clientId <= 0 && (!SettingsRepository::enabled('guest_recovery') || $email === '')) {
            // Guest carts are only tracked once checkout supplies an address
            // and guest recovery is enabled.
            return null;
        }

        $existing = self::findOpen($clientId, $sessionKey);

        if (CartSnapshot::isEmpty($cart)) {
            if ($existing && in_array($existing->status, array(Schema::STATUS_ACTIVE, Schema::STATUS_ABANDONED), true)) {
                self::close((int) $existing->id, 'cart_emptied');
            }
            return null;
        }

        if ($email !== '' && self::isSuppressed($email, $clientId)) {
            // Respect the suppression list at capture time too.
            if ($existing && !in_array($existing->status, Schema::terminalStatuses(), true)) {
                self::transition((int) $existing->id, Schema::STATUS_UNSUBSCRIBED, array('next_reminder_at' => null));
            }
            return null;
        }

        $snapshot = CartSnapshot::capture($cart, $currency, $totals);
        $json = CartSnapshot::encode($snapshot);
        $fingerprint = CartSnapshot::fingerprint($cart);
        $now = self::now();

        if ($existing && in_array($existing->status, Schema::openStatuses(), true)) {
            $changed = !isset($existing->cart_fingerprint) || $existing->cart_fingerprint !== $fingerprint;
            $update = array(
                'cart_snapshot' => $json,
                'cart_total' => CartSnapshot::total($json),
                'currency' => substr($currency, 0, 8) ?: $existing->currency,
                'cart_fingerprint' => $fingerprint,
                'updated_at' => $now,
            );
            foreach (array('email' => $email, 'first_name' => isset($context['first_name']) ? $context['first_name'] : '', 'last_name' => isset($context['last_name']) ? $context['last_name'] : '') as $field => $value) {
                $value = trim((string) $value);
                if ($value !== '') {
                    $update[$field] = substr($value, 0, $field === 'email' ? 254 : 100);
                }
            }
            if ($clientId > 0 && (int) $existing->client_id !== $clientId) {
                $update['client_id'] = $clientId;
            }
            if ($sessionKey !== '' && (string) $existing->session_key !== $sessionKey) {
                $update['session_key'] = $sessionKey;
            }
            if ($changed || $existing->status !== Schema::STATUS_ACTIVE) {
                // Meaningful activity restarts the abandonment timer and the
                // reminder schedule for this lifecycle.
                $update['status'] = Schema::STATUS_ACTIVE;
                $update['last_activity_at'] = $now;
                $update['abandoned_at'] = null;
                $update['next_reminder_at'] = null;
            }
            self::table()->where('id', $existing->id)->update($update);
            Log::info('cart.captured', array('recovery_id' => (int) $existing->id, 'changed' => $changed ? 1 : 0, 'guest' => $clientId ? 0 : 1));
            return (int) $existing->id;
        }

        $raw = TokenService::generate();
        $unsubscribeToken = TokenService::unsubscribeToken($raw);
        $id = self::table()->insertGetId(array(
            'client_id' => $clientId > 0 ? $clientId : null,
            'session_key' => $sessionKey !== '' ? $sessionKey : null,
            'email' => $email !== '' ? $email : null,
            'first_name' => substr(trim((string) (isset($context['first_name']) ? $context['first_name'] : '')), 0, 100),
            'last_name' => substr(trim((string) (isset($context['last_name']) ? $context['last_name'] : '')), 0, 100),
            'currency' => substr($currency, 0, 8),
            'cart_snapshot' => $json,
            'cart_fingerprint' => $fingerprint,
            'cart_total' => CartSnapshot::total($json),
            'status' => Schema::STATUS_ACTIVE,
            'token_hash' => TokenService::hash($raw),
            'token_ciphertext' => TokenService::seal($raw),
            'unsubscribe_hash' => TokenService::unsubscribeHash($unsubscribeToken),
            'token_expires_at' => date('Y-m-d H:i:s', time() + SettingsRepository::int('token_lifetime')),
            'first_seen_at' => $now,
            'last_activity_at' => $now,
            'last_reminder_number' => 0,
            'created_at' => $now,
            'updated_at' => $now,
        ));
        Log::info('cart.captured', array('recovery_id' => (int) $id, 'new' => 1, 'guest' => $clientId ? 0 : 1));
        return (int) $id;
    }

    /**
     * Attach an email address collected during checkout to the current cart
     * record (ShoppingCartValidateCheckout). Creates the record for guests.
     */
    public static function attachEmail($email, $clientId, $sessionKey, array $context = array())
    {
        $email = self::normaliseEmail($email);
        if ($email === '') {
            return null;
        }
        $context['email'] = $email;
        $context['client_id'] = (int) $clientId;
        $context['session_key'] = $sessionKey;
        return self::capture($context);
    }

    /**
     * Promote inactive carts to "abandoned" and schedule the first reminder.
     * Batched; called by cron before reminder processing.
     *
     * @return int number of records marked
     */
    public static function markAbandoned($limit = 50)
    {
        $threshold = SettingsRepository::int('abandonment_threshold');
        $cutoff = date('Y-m-d H:i:s', time() - max(60, $threshold));
        $rows = self::table()
            ->where('status', Schema::STATUS_ACTIVE)
            ->where('last_activity_at', '<=', $cutoff)
            ->orderBy('id')
            ->limit(max(1, (int) $limit))
            ->get();

        $count = 0;
        $now = self::now();
        foreach ($rows as $row) {
            $abandonedAt = $now;
            $next = self::scheduleFor($abandonedAt, 0);
            $updated = self::table()
                ->where('id', $row->id)
                ->where('status', Schema::STATUS_ACTIVE)
                ->update(array(
                    'status' => Schema::STATUS_ABANDONED,
                    'abandoned_at' => $abandonedAt,
                    'next_reminder_at' => $next,
                    'updated_at' => $now,
                ));
            if ($updated) {
                $count++;
                Log::info('cart.abandoned', array('recovery_id' => (int) $row->id, 'next_reminder_at' => $next));
            }
        }
        return $count;
    }

    /**
     * When is reminder ($lastNumber + 1) due, relative to abandonment?
     * Disabled reminders are skipped over. Returns null when no further
     * reminder is configured.
     */
    public static function scheduleFor($abandonedAt, $lastNumber)
    {
        $max = min(3, SettingsRepository::int('maximum_reminders'));
        $base = strtotime((string) $abandonedAt);
        if ($base === false) {
            return null;
        }
        for ($number = ((int) $lastNumber) + 1; $number <= $max; $number++) {
            if (!SettingsRepository::reminderEnabled($number)) {
                continue;
            }
            return date('Y-m-d H:i:s', $base + SettingsRepository::reminderDelay($number));
        }
        return null;
    }

    /** Which reminder number is due next for this record (0 = none). */
    public static function nextReminderNumber($lastNumber)
    {
        $max = min(3, SettingsRepository::int('maximum_reminders'));
        for ($number = ((int) $lastNumber) + 1; $number <= $max; $number++) {
            if (SettingsRepository::reminderEnabled($number)) {
                return $number;
            }
        }
        return 0;
    }

    /**
     * Restore a cart from a raw recovery token.
     *
     * Returns an array describing the outcome; the caller decides what to
     * render. A guest link restores the cart only — it never authenticates
     * the visitor into a WHMCS account.
     *
     * @return array{ok:bool,reason:string,recovery_id:int|null}
     */
    public static function recover($token, &$session = null)
    {
        if ($session === null) {
            $session = &$_SESSION;
        }
        if (!SettingsRepository::enabled('enabled')) {
            return self::outcome(false, 'disabled');
        }
        if (!TokenService::valid($token)) {
            return self::outcome(false, 'invalid_token');
        }
        $row = self::table()->where('token_hash', TokenService::hash($token))->first();
        if (!$row) {
            return self::outcome(false, 'invalid_token');
        }
        if (in_array($row->status, Schema::terminalStatuses(), true)) {
            $reason = $row->status === Schema::STATUS_CONVERTED ? 'already_converted' : 'closed';
            Log::info('cart.recovery_rejected', array('recovery_id' => (int) $row->id, 'reason' => $reason));
            return self::outcome(false, $reason, (int) $row->id);
        }
        if (strtotime((string) $row->token_expires_at) <= time()) {
            self::transition((int) $row->id, Schema::STATUS_EXPIRED, array('next_reminder_at' => null));
            Log::info('cart.token_expired', array('recovery_id' => (int) $row->id));
            return self::outcome(false, 'expired', (int) $row->id);
        }
        $cart = CartSnapshot::restore($row->cart_snapshot);
        if (CartSnapshot::isEmpty($cart)) {
            self::close((int) $row->id, 'cart_emptied');
            return self::outcome(false, 'empty_cart', (int) $row->id);
        }

        // Only the sanitised cart structure is written back. No identity,
        // no authentication state, no other session key is touched.
        $session['cart'] = $cart;

        $now = self::now();
        self::table()->where('id', $row->id)->update(array(
            'status' => Schema::STATUS_RECOVERED,
            'recovered_at' => $row->recovered_at ? $row->recovered_at : $now,
            'last_activity_at' => $now,
            'next_reminder_at' => null,
            'updated_at' => $now,
        ));
        Log::info('cart.recovered', array('recovery_id' => (int) $row->id));
        return self::outcome(true, 'recovered', (int) $row->id);
    }

    /**
     * Unsubscribe using the derived unsubscribe token (never the recovery
     * token), so the link in an email cannot be replayed to open a cart.
     */
    public static function unsubscribe($unsubscribeToken)
    {
        if (!SettingsRepository::enabled('unsubscribe')) {
            return self::outcome(false, 'disabled');
        }
        if (!TokenService::valid($unsubscribeToken)) {
            return self::outcome(false, 'invalid_token');
        }
        $row = self::table()->where('unsubscribe_hash', TokenService::unsubscribeHash($unsubscribeToken))->first();
        if (!$row) {
            return self::outcome(false, 'invalid_token');
        }
        self::suppress($row->email, $row->client_id, 'unsubscribe');
        $now = self::now();
        self::table()->where('id', $row->id)->update(array(
            'status' => Schema::STATUS_UNSUBSCRIBED,
            'unsubscribed_at' => $now,
            'next_reminder_at' => null,
            'updated_at' => $now,
        ));
        // Stop every other open cart for the same recipient as well.
        $others = self::table()->whereIn('status', Schema::openStatuses());
        if ($row->client_id) {
            $others->where('client_id', (int) $row->client_id);
        } else {
            $others->where('email', (string) $row->email);
        }
        $others->update(array('status' => Schema::STATUS_UNSUBSCRIBED, 'unsubscribed_at' => $now, 'next_reminder_at' => null, 'updated_at' => $now));
        Log::info('customer.unsubscribed', array('recovery_id' => (int) $row->id));
        return self::outcome(true, 'unsubscribed', (int) $row->id);
    }

    public static function suppress($email, $clientId, $reason = 'unsubscribe')
    {
        $email = self::normaliseEmail($email);
        if ($email === '' && !$clientId) {
            return false;
        }
        $now = self::now();
        Capsule::table(Schema::SUPPRESSIONS)->updateOrInsert(
            array('email' => $email !== '' ? $email : null, 'client_id' => $clientId ? (int) $clientId : null),
            array('reason' => substr((string) $reason, 0, 64), 'created_at' => $now, 'updated_at' => $now)
        );
        return true;
    }

    public static function isSuppressed($email, $clientId = 0)
    {
        $email = self::normaliseEmail($email);
        $query = Capsule::table(Schema::SUPPRESSIONS);
        if ($email !== '' && $clientId) {
            $query->where(function ($q) use ($email, $clientId) {
                $q->where('email', $email)->orWhere('client_id', (int) $clientId);
            });
        } elseif ($email !== '') {
            $query->where('email', $email);
        } elseif ($clientId) {
            $query->where('client_id', (int) $clientId);
        } else {
            return false;
        }
        return $query->count() > 0;
    }

    /**
     * Mark a recovery as converted from authoritative WHMCS order data.
     * Reminders stop immediately.
     */
    public static function convert($recoveryId, $orderId, $revenue = null, $currency = '')
    {
        $now = self::now();
        $update = array(
            'status' => Schema::STATUS_CONVERTED,
            'order_id' => $orderId ? (int) $orderId : null,
            'converted_at' => $now,
            'next_reminder_at' => null,
            'updated_at' => $now,
        );
        if ($revenue !== null && is_numeric($revenue)) {
            $update['recovered_revenue'] = round((float) $revenue, 2);
        }
        if ($currency !== '') {
            $update['currency'] = substr((string) $currency, 0, 8);
        }
        $affected = self::table()->where('id', (int) $recoveryId)->whereIn('status', Schema::openStatuses())->update($update);
        if ($affected) {
            Log::info('cart.converted', array('recovery_id' => (int) $recoveryId, 'order_id' => (int) $orderId));
        }
        return (bool) $affected;
    }

    /**
     * Resolve the open recovery record belonging to a checkout, then convert
     * it using the authoritative WHMCS order total. Never guesses: without a
     * client or session match nothing is converted.
     */
    public static function convertForCheckout($clientId, $sessionKey, $orderId, $invoiceId = 0)
    {
        $row = self::findOpen((int) $clientId, (string) $sessionKey);
        if (!$row) {
            return false;
        }
        $order = OrderRevenue::lookup($orderId, $invoiceId, (int) $clientId);
        if (!$orderId && !empty($order['order_id'])) {
            $orderId = $order['order_id'];
        }
        return self::convert((int) $row->id, (int) $orderId, $order['amount'], $order['currency']);
    }

    /** Terminal close (cart emptied, admin cancel). */
    public static function close($recoveryId, $reason = 'closed')
    {
        $ok = self::transition((int) $recoveryId, Schema::STATUS_CLOSED, array('next_reminder_at' => null));
        if ($ok) {
            Log::info('cart.closed', array('recovery_id' => (int) $recoveryId, 'reason' => substr((string) $reason, 0, 64)));
        }
        return $ok;
    }

    public static function expire($recoveryId)
    {
        $ok = self::transition((int) $recoveryId, Schema::STATUS_EXPIRED, array('next_reminder_at' => null));
        if ($ok) {
            Log::info('cart.expired', array('recovery_id' => (int) $recoveryId));
        }
        return $ok;
    }

    /** Sweep records whose recovery token has expired. */
    public static function expireStale($limit = 200)
    {
        $now = self::now();
        $rows = self::table()
            ->whereIn('status', Schema::openStatuses())
            ->where('token_expires_at', '<=', $now)
            ->orderBy('id')
            ->limit(max(1, (int) $limit))
            ->get();
        $count = 0;
        foreach ($rows as $row) {
            if (self::expire((int) $row->id)) {
                $count++;
            }
        }
        return $count;
    }

    public static function transition($recoveryId, $status, array $extra = array())
    {
        if (!in_array($status, Schema::allStatuses(), true)) {
            return false;
        }
        $update = array_merge($extra, array('status' => $status, 'updated_at' => self::now()));
        $affected = self::table()->where('id', (int) $recoveryId)->whereIn('status', Schema::openStatuses())->update($update);
        return (bool) $affected;
    }

    public static function find($recoveryId)
    {
        return self::table()->where('id', (int) $recoveryId)->first();
    }

    /** Most recent open record for this identity. */
    public static function findOpen($clientId, $sessionKey = '')
    {
        $clientId = (int) $clientId;
        $sessionKey = substr((string) $sessionKey, 0, 128);
        if ($clientId > 0) {
            $row = self::table()->where('client_id', $clientId)->whereIn('status', Schema::openStatuses())->orderBy('id', 'desc')->first();
            if ($row) {
                return $row;
            }
        }
        if ($sessionKey !== '') {
            $query = self::table()->where('session_key', $sessionKey)->whereIn('status', Schema::openStatuses());
            if ($clientId > 0) {
                // A signed-in visitor may adopt the guest cart started in this
                // same browser session, but never a record owned by another
                // client id.
                $query->whereNull('client_id');
            }
            return $query->orderBy('id', 'desc')->first();
        }
        return null;
    }

    /** Recovery URL for a raw token, using the WHMCS system URL. */
    public static function recoveryUrl($rawToken)
    {
        return self::baseUrl() . '/modules/addons/cloudhost247_cart_recovery/recover.php?token=' . rawurlencode($rawToken);
    }

    public static function unsubscribeUrl($rawToken)
    {
        return self::baseUrl() . '/modules/addons/cloudhost247_cart_recovery/recover.php?action=unsubscribe&token='
            . rawurlencode(TokenService::unsubscribeToken($rawToken));
    }

    public static function baseUrl()
    {
        if (defined('CONFIG_SystemURL') && CONFIG_SystemURL) {
            return rtrim(CONFIG_SystemURL, '/');
        }
        try {
            if (class_exists('WHMCS\\Database\\Capsule')) {
                $row = Capsule::table('tblconfiguration')->where('setting', 'SystemURL')->first();
                if ($row && !empty($row->value)) {
                    return rtrim((string) $row->value, '/');
                }
            }
        } catch (\Throwable $e) {
            // fall through
        }
        return '';
    }

    public static function normaliseEmail($email)
    {
        $email = trim((string) $email);
        if ($email === '' || strlen($email) > 254) {
            return '';
        }
        return filter_var($email, FILTER_VALIDATE_EMAIL) ? strtolower($email) : '';
    }

    public static function table()
    {
        return Capsule::table(Schema::RECOVERIES);
    }

    public static function now()
    {
        return date('Y-m-d H:i:s');
    }

    private static function outcome($ok, $reason, $recoveryId = null)
    {
        return array('ok' => (bool) $ok, 'reason' => $reason, 'recovery_id' => $recoveryId);
    }
}
