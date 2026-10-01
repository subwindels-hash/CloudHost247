<?php
/**
 * Uniform result envelope.
 *
 * Every provider adapter and service method returns this shape, so callers
 * never have to guess whether they received a bool, a string or an exception.
 *
 * Keys:
 *   success   bool
 *   code      string   machine readable outcome/error code
 *   message   string   operator-safe message (never contains secrets)
 *   data      array    payload
 *   uncertain bool     the remote side MAY have applied the change (timeout,
 *                      network error after send) - callers must reconcile
 *                      rather than retry blindly
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

namespace CloudHost247\Email\Support;

final class Result
{
    const CODE_OK              = 'ok';
    const CODE_CONFIG          = 'configuration_error';
    const CODE_PERMISSION      = 'permission_error';
    const CODE_VALIDATION      = 'validation_error';
    const CODE_CAPACITY        = 'capacity_error';
    const CODE_NOT_SUPPORTED   = 'not_supported';
    const CODE_NOT_FOUND       = 'not_found';
    const CODE_CONFLICT        = 'conflict';
    const CODE_RATE_LIMIT      = 'rate_limited';
    const CODE_TRANSPORT       = 'transport_error';
    const CODE_REMOTE          = 'remote_error';
    const CODE_UNCERTAIN       = 'uncertain';

    /**
     * @param  array<string,mixed> $data
     * @return array<string,mixed>
     */
    public static function ok(array $data = [], string $message = ''): array
    {
        return [
            'success'   => true,
            'code'      => self::CODE_OK,
            'message'   => $message,
            'data'      => $data,
            'uncertain' => false,
        ];
    }

    /**
     * @param  array<string,mixed> $data
     * @return array<string,mixed>
     */
    public static function fail(string $code, string $message, array $data = [], bool $uncertain = false): array
    {
        return [
            'success'   => false,
            'code'      => $code,
            'message'   => $message,
            'data'      => $data,
            'uncertain' => $uncertain,
        ];
    }

    /**
     * An operation whose outcome is unknown: the request may have been applied
     * remotely. Never retried automatically - queued for reconciliation.
     *
     * @param  array<string,mixed> $data
     * @return array<string,mixed>
     */
    public static function uncertain(string $message, array $data = []): array
    {
        return self::fail(self::CODE_UNCERTAIN, $message, $data, true);
    }

    /**
     * @param array<string,mixed> $result
     */
    public static function isOk($result): bool
    {
        return is_array($result) && !empty($result['success']);
    }

    /**
     * @param array<string,mixed> $result
     */
    public static function isUncertain($result): bool
    {
        return is_array($result) && !empty($result['uncertain']);
    }

    /**
     * WHMCS provisioning modules signal success with the literal string
     * 'success' and failure with any other (displayed) string.
     *
     * @param array<string,mixed> $result
     */
    public static function toWhmcs($result): string
    {
        if (self::isOk($result)) {
            return 'success';
        }

        $message = is_array($result) ? (string) ($result['message'] ?? '') : 'Unknown error';
        $code = is_array($result) ? (string) ($result['code'] ?? '') : '';

        return $message !== ''
            ? $message . ($code !== '' ? ' [' . $code . ']' : '')
            : 'The operation failed.';
    }
}
