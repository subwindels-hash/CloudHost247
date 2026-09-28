<?php
namespace CloudHost247\Smm\Support;

use RuntimeException;

/** Base exception for every SMM module failure. Carries a safe, admin-safe message. */
class ModuleException extends RuntimeException
{
    /** @var string|null provider-facing raw detail that must never reach a customer */
    protected $rawDetail;

    public function __construct($message = '', $code = 0, $rawDetail = null)
    {
        parent::__construct($message, (int) $code);
        $this->rawDetail = $rawDetail === null ? null : (string) $rawDetail;
    }

    public function rawDetail()
    {
        return $this->rawDetail;
    }
}
