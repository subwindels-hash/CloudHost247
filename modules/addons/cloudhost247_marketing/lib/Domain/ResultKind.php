<?php
namespace CloudHost247\Marketing\Domain;

/**
 * Closed set of delivery outcome kinds (requirement #19). The retry engine
 * only ever acts on these — permanent kinds are never retried forever.
 */
final class ResultKind
{
    const ACCEPTED = 'accepted';                       // 2xx from the relay
    const TEMPORARY_FAILURE = 'temporary_failure';     // 4xx → retry with backoff
    const PERMANENT_FAILURE = 'permanent_failure';     // 5xx → no retry
    const AUTHENTICATION_FAILURE = 'authentication_failure';
    const RATE_LIMITED = 'rate_limited';               // 4xx rate-limit patterns → retry later
    const INVALID_RECIPIENT = 'invalid_recipient';     // 550/551/553-style rejections
    const PROVIDER_UNAVAILABLE = 'provider_unavailable';

    public static function all()
    {
        return array(
            self::ACCEPTED, self::TEMPORARY_FAILURE, self::PERMANENT_FAILURE,
            self::AUTHENTICATION_FAILURE, self::RATE_LIMITED, self::INVALID_RECIPIENT,
            self::PROVIDER_UNAVAILABLE,
        );
    }

    public static function isRetryable($kind)
    {
        return in_array((string) $kind, array(
            self::TEMPORARY_FAILURE, self::RATE_LIMITED, self::PROVIDER_UNAVAILABLE,
        ), true);
    }
}
