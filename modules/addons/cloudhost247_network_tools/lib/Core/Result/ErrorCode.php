<?php
namespace CloudHost247\NetworkTools\Core\Result;

/**
 * Standardised error/result vocabulary (see docs/tools/ERRORS.md).
 *
 * Every tool outcome is expressed with one of these codes so the UI, the REST
 * API, the support-ticket integration and the admin log all agree on what
 * happened. The module never returns invented data for a failure: it returns
 * the code, an explanation and, where relevant, what the operator can do.
 */
final class ErrorCode
{
    const OK = 'OK';
    const INVALID_INPUT = 'INVALID_INPUT';
    const DOMAIN_NOT_FOUND = 'DOMAIN_NOT_FOUND';
    const DNS_LOOKUP_FAILED = 'DNS_LOOKUP_FAILED';
    const TIMEOUT = 'TIMEOUT';
    const RATE_LIMITED = 'RATE_LIMITED';
    const CONFIGURATION_REQUIRED = 'CONFIGURATION_REQUIRED';
    const PROVIDER_ERROR = 'PROVIDER_ERROR';
    const SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE';
    const ACCESS_DENIED = 'ACCESS_DENIED';
    const TARGET_BLOCKED = 'TARGET_BLOCKED';
    const AUTH_REQUIRED = 'AUTH_REQUIRED';
    const CSRF_FAILED = 'CSRF_FAILED';
    const TOOL_DISABLED = 'TOOL_DISABLED';
    const MAINTENANCE = 'MAINTENANCE';
    const CAPABILITY_UNAVAILABLE = 'CAPABILITY_UNAVAILABLE';
    const NOT_FOUND = 'NOT_FOUND';
    const UNKNOWN = 'UNKNOWN';
    const PARTIAL = 'PARTIAL';

    /**
     * @return array default message, retryable, HTTP status class
     */
    public static function describe($code)
    {
        $map = array(
            self::OK => array('The tool completed successfully.', false, 200),
            self::INVALID_INPUT => array('Some of the values supplied were not valid for this tool.', false, 400),
            self::DOMAIN_NOT_FOUND => array('That domain could not be resolved and does not appear to exist.', false, 404),
            self::DNS_LOOKUP_FAILED => array('The DNS lookup did not return an answer.', true, 502),
            self::TIMEOUT => array('The request took longer than the allowed time and was stopped.', true, 504),
            self::RATE_LIMITED => array('You have reached the allowed number of requests for this tool. Please wait and try again.', true, 429),
            self::CONFIGURATION_REQUIRED => array('This tool needs a provider to be configured by a CloudHost247 administrator.', false, 503),
            self::PROVIDER_ERROR => array('The upstream provider returned an error.', true, 502),
            self::SERVICE_UNAVAILABLE => array('This diagnostic service is temporarily unavailable.', true, 503),
            self::ACCESS_DENIED => array('You do not have access to this tool.', false, 403),
            self::TARGET_BLOCKED => array('That target is not permitted by this tool\'s security policy.', false, 403),
            self::AUTH_REQUIRED => array('Sign in to your CloudHost247 account to use this tool.', false, 401),
            self::CSRF_FAILED => array('Your session token was missing or had expired. Reload the page and try again.', true, 419),
            self::TOOL_DISABLED => array('This tool has been disabled by a CloudHost247 administrator.', false, 403),
            self::MAINTENANCE => array('This tool is in maintenance mode and is temporarily unavailable.', true, 503),
            self::CAPABILITY_UNAVAILABLE => array('This operation is not available in the current hosting environment.', false, 501),
            self::NOT_FOUND => array('Nothing was found for that request.', false, 404),
            self::PARTIAL => array('The tool completed, but some checks could not be run.', true, 200),
            self::UNKNOWN => array('The result of that request could not be determined.', true, 500),
        );
        return isset($map[$code]) ? $map[$code] : $map[self::UNKNOWN];
    }

    public static function isValid($code)
    {
        return $code !== '' && preg_match('/^[A-Z_]{3,48}$/', (string) $code) === 1;
    }

    public static function message($code)
    {
        $described = self::describe($code);
        return $described[0];
    }

    public static function retryable($code)
    {
        $described = self::describe($code);
        return (bool) $described[1];
    }

    public static function httpStatus($code)
    {
        $described = self::describe($code);
        return (int) $described[2];
    }
}
