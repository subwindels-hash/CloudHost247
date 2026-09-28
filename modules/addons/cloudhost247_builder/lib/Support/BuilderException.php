<?php
namespace CloudHost247\Builder\Support;

use RuntimeException;

/**
 * Single failure type for the Website Builder.
 *
 * Every rejection carries a machine-readable reason so the controller can pick
 * the right HTTP status and audit outcome, and the message stays safe to show
 * to an administrator: it never contains a filesystem path outside the module,
 * a credential, or a raw database error.
 */
final class BuilderException extends RuntimeException
{
    const REASON_VALIDATION = 'validation';
    const REASON_SCHEMA = 'schema';
    const REASON_PERMISSION = 'permission';
    const REASON_NOT_FOUND = 'not_found';
    const REASON_CONFLICT = 'conflict';
    const REASON_UPLOAD = 'upload';
    const REASON_STORAGE = 'storage';
    const REASON_STATE = 'state';
    const REASON_IMPORT = 'import';
    const REASON_RATE_LIMIT = 'rate_limit';

    const REASONS = array(
        self::REASON_VALIDATION, self::REASON_SCHEMA, self::REASON_PERMISSION, self::REASON_NOT_FOUND,
        self::REASON_CONFLICT, self::REASON_UPLOAD, self::REASON_STORAGE, self::REASON_STATE,
        self::REASON_IMPORT, self::REASON_RATE_LIMIT,
    );

    private $reason;
    private $correlationId;
    private $details;

    public function __construct($message, $reason = self::REASON_VALIDATION, $correlationId = '', array $details = array())
    {
        parent::__construct((string) $message);
        $this->reason = in_array($reason, self::REASONS, true) ? $reason : self::REASON_VALIDATION;
        $this->correlationId = (string) $correlationId;
        $this->details = $details;
    }

    public function reason() { return $this->reason; }

    public function correlationId() { return $this->correlationId; }

    /** Field-level messages, used to mark up a rejected form or document. */
    public function details() { return $this->details; }

    public function httpStatus()
    {
        switch ($this->reason) {
            case self::REASON_PERMISSION: return 403;
            case self::REASON_NOT_FOUND: return 404;
            case self::REASON_CONFLICT: return 409;
            case self::REASON_RATE_LIMIT: return 429;
            case self::REASON_STORAGE: return 500;
            default: return 422;
        }
    }

    public static function validation($message, array $details = array())
    {
        return new self($message, self::REASON_VALIDATION, '', $details);
    }

    public static function schema($message, array $details = array())
    {
        return new self($message, self::REASON_SCHEMA, '', $details);
    }

    public static function notFound($message) { return new self($message, self::REASON_NOT_FOUND); }

    public static function conflict($message) { return new self($message, self::REASON_CONFLICT); }

    public static function permission($message) { return new self($message, self::REASON_PERMISSION); }

    public static function storage($message) { return new self($message, self::REASON_STORAGE); }

    public static function upload($message) { return new self($message, self::REASON_UPLOAD); }

    public static function state($message) { return new self($message, self::REASON_STATE); }

    public static function import($message, array $details = array())
    {
        return new self($message, self::REASON_IMPORT, '', $details);
    }

    public static function rateLimit($message) { return new self($message, self::REASON_RATE_LIMIT); }
}
