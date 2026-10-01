<?php
/**
 * Webhook authentication and replay protection.
 *
 * Supported today:
 *
 *   professional  HMAC-SHA256 over the raw body with a shared secret, sent in
 *                 X-Hostx-Signature, plus X-Hostx-Timestamp and X-Hostx-Event-Id.
 *                 The secret lives in the server access-hash JSON
 *                 ({"webhook_secret": "..."}) - i.e. encrypted by WHMCS.
 *
 *   microsoft365  Graph change notifications use a validationToken handshake
 *                 and a clientState value chosen by the subscriber. Only
 *                 handled when a clientState is configured; otherwise refused.
 *
 *   google        The Admin SDK does not document signed push notifications for
 *                 user directory events, so unauthenticated callbacks are
 *                 refused outright rather than trusted.
 *
 * Refusing is always safe: the cron reconciler keeps state fresh regardless.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

namespace CloudHost247\Email\Webhook;

use CloudHost247\Email\Support\Logger;
use CloudHost247\Email\Support\Result;
use WHMCS\Database\Capsule;

final class Verifier
{
    const TABLE = 'mod_hostx_email_webhooks';

    /** Maximum age of a signed request, in seconds. */
    const MAX_SKEW = 300;

    /**
     * Providers for which this module can genuinely authenticate a callback.
     *
     * @var array<int,string>
     */
    const SUPPORTED = ['professional', 'microsoft365'];

    /**
     * Verify an HMAC-SHA256 signature over the raw body.
     *
     * Pure helper (unit tested): constant-time comparison, timestamp binding.
     *
     * @return array{valid:bool,reason:string}
     */
    public static function verifyHmac(string $rawBody, string $signature, string $secret, string $timestamp = '', int $now = 0): array
    {
        if ($secret === '') {
            return ['valid' => false, 'reason' => 'No webhook secret is configured.'];
        }

        if ($signature === '') {
            return ['valid' => false, 'reason' => 'Missing signature header.'];
        }

        $now = $now > 0 ? $now : time();

        if ($timestamp !== '') {
            if (!ctype_digit($timestamp)) {
                return ['valid' => false, 'reason' => 'Malformed timestamp header.'];
            }

            if (abs($now - (int) $timestamp) > self::MAX_SKEW) {
                return ['valid' => false, 'reason' => 'Timestamp outside the accepted window (replay protection).'];
            }
        }

        // The timestamp is part of the signed material when present, so a
        // captured signature cannot be replayed with a fresh timestamp.
        $material = $timestamp !== '' ? $timestamp . '.' . $rawBody : $rawBody;
        $expected = hash_hmac('sha256', $material, $secret);

        // Accept both the bare hex digest and the "sha256=" prefixed form.
        $candidate = stripos($signature, 'sha256=') === 0 ? substr($signature, 7) : $signature;

        if (!hash_equals($expected, strtolower(trim($candidate)))) {
            return ['valid' => false, 'reason' => 'Signature mismatch.'];
        }

        return ['valid' => true, 'reason' => ''];
    }

    /**
     * Record a webhook receipt. Returns false when the event id has already
     * been processed (replay).
     */
    public static function remember(string $provider, string $eventId, string $eventType, string $rawBody, bool $verified, string $outcome, ?int $serviceId = null): bool
    {
        try {
            Capsule::table(self::TABLE)->insert([
                'provider'     => substr($provider, 0, 32),
                'event_id'     => substr($eventId, 0, 191),
                'event_type'   => substr($eventType, 0, 96),
                'service_id'   => $serviceId,
                'verified'     => (int) $verified,
                'outcome'      => substr($outcome, 0, 48),
                'payload_hash' => hash('sha256', $rawBody),
                'received_at'  => date('Y-m-d H:i:s'),
            ]);

            return true;
        } catch (\Throwable $e) {
            // Unique (provider,event_id) violation = replay.
            Logger::warning('webhook.replay_ignored', [
                'provider' => $provider,
                'event_id' => substr($eventId, 0, 64),
            ]);

            return false;
        }
    }

    /**
     * Has this exact event already been seen?
     */
    public static function seen(string $provider, string $eventId): bool
    {
        try {
            return Capsule::table(self::TABLE)
                ->where('provider', $provider)
                ->where('event_id', $eventId)
                ->exists();
        } catch (\Throwable $e) {
            // Fail closed: if we cannot tell, do not act on the event.
            return true;
        }
    }

    /**
     * Housekeeping.
     */
    public static function prune(int $days = 30): int
    {
        try {
            return (int) Capsule::table(self::TABLE)
                ->where('received_at', '<', date('Y-m-d H:i:s', strtotime('-' . max(1, $days) . ' days')))
                ->delete();
        } catch (\Throwable $e) {
            return 0;
        }
    }

    /**
     * @return array<string,mixed>
     */
    public static function unsupported(string $provider): array
    {
        return Result::fail(
            Result::CODE_NOT_SUPPORTED,
            sprintf(
                'No authenticated webhook is documented for %s, so callbacks are refused. Status stays current through '
                . 'the scheduled reconciler instead.',
                $provider
            )
        );
    }
}
