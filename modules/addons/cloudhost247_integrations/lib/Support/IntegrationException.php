<?php
namespace CloudHost247\Integrations\Support;

/**
 * Controlled application error raised when an integration cannot be used.
 *
 * The message is always a fixed, safe sentence plus a result code; provider
 * payloads, credentials and stack traces are never attached.
 */
class IntegrationException extends \RuntimeException
{
    private $resultCode;
    private $providerKey;
    private $correlationId;

    public function __construct($resultCode, $providerKey = '', $correlationId = '', $message = '')
    {
        $this->resultCode = ResultCode::isValid($resultCode) ? $resultCode : ResultCode::PROVIDER_UNAVAILABLE;
        $this->providerKey = preg_match('/^[a-z0-9_]{0,64}$/', (string) $providerKey) ? (string) $providerKey : '';
        $this->correlationId = preg_match('/^[a-f0-9]{0,64}$/', (string) $correlationId) ? (string) $correlationId : '';
        $safe = $message !== '' ? Redactor::text($message, 160) : ResultCode::label($this->resultCode);
        parent::__construct($safe . ($this->correlationId ? ' Reference: ' . $this->correlationId : ''));
    }

    public function resultCode() { return $this->resultCode; }
    public function providerKey() { return $this->providerKey; }
    public function correlationId() { return $this->correlationId; }
}
