<?php
namespace CloudHost247\NetworkTools\Core\Result;

/**
 * One immutable-ish result envelope shared by every tool, the UI, the REST API
 * and the export/support integrations.
 *
 * Success shape:  ok=true, code=OK, data=<tool payload>
 * Failure shape:  ok=false, code=<ErrorCode>, message, retryable
 *
 * "No fabricated results" is enforced by construction: a failure never
 * carries a data payload, and helpers such as unavailable()/blocked() cannot
 * be given fabricated data by accident.
 */
final class ToolResult
{
    private $ok;
    private $code;
    private $message;
    private $data;
    private $warnings = array();
    private $meta = array();

    private function __construct($ok, $code, $message, array $data, array $warnings, array $meta)
    {
        $this->ok = (bool) $ok;
        $this->code = (string) $code;
        $this->message = (string) $message;
        $this->data = $data;
        $this->warnings = $warnings;
        $this->meta = $meta;
    }

    public static function success($data = array(), array $warnings = array(), array $meta = array())
    {
        return new self(true, ErrorCode::OK, 'The tool completed successfully.', is_array($data) ? $data : array('value' => $data), $warnings, $meta);
    }

    /** Completed, but part of the work could not be run (still real data). */
    public static function partial($data = array(), array $warnings = array(), array $meta = array())
    {
        return new self(true, ErrorCode::PARTIAL, 'The tool completed, but some checks could not be run.', is_array($data) ? $data : array('value' => $data), $warnings, $meta);
    }

    public static function failure($code, $message = null, array $meta = array(), array $warnings = array())
    {
        $code = ErrorCode::isValid($code) ? $code : ErrorCode::UNKNOWN;
        $message = $message === null || $message === '' ? ErrorCode::message($code) : (string) $message;
        return new self(false, $code, $message, array(), $warnings, $meta);
    }

    public static function invalid($message = null)
    {
        return self::failure(ErrorCode::INVALID_INPUT, $message);
    }

    public static function unavailable($message = null)
    {
        return self::failure(ErrorCode::SERVICE_UNAVAILABLE, $message);
    }

    public static function configurationRequired($message = null)
    {
        return self::failure(ErrorCode::CONFIGURATION_REQUIRED, $message);
    }

    public static function capabilityUnavailable($message = null)
    {
        return self::failure(ErrorCode::CAPABILITY_UNAVAILABLE, $message);
    }

    public static function blocked($message = null)
    {
        return self::failure(ErrorCode::TARGET_BLOCKED, $message);
    }

    public static function timeout($message = null)
    {
        return self::failure(ErrorCode::TIMEOUT, $message);
    }

    public static function rateLimited($message = null)
    {
        return self::failure(ErrorCode::RATE_LIMITED, $message);
    }

    public function withMeta(array $meta)
    {
        $this->meta = array_merge($this->meta, $meta);
        return $this;
    }

    public function withWarning($warning)
    {
        $warning = trim((string) $warning);
        if ($warning !== '') {
            $this->warnings[] = $warning;
        }
        return $this;
    }

    public function isOk()
    {
        return $this->ok;
    }

    public function code()
    {
        return $this->code;
    }

    public function message()
    {
        return $this->message;
    }

    public function data()
    {
        return $this->data;
    }

    public function warnings()
    {
        return $this->warnings;
    }

    public function meta()
    {
        return $this->meta;
    }

    public function retryable()
    {
        return $this->ok ? false : ErrorCode::retryable($this->code);
    }

    /** Wire representation used by the AJAX endpoint, REST API and exports. */
    public function toArray()
    {
        return array(
            'success' => $this->ok,
            'code' => $this->code,
            'message' => $this->message,
            'retryable' => $this->retryable(),
            'warnings' => $this->warnings,
            'data' => $this->ok ? $this->data : array(),
            'meta' => $this->meta,
        );
    }
}
