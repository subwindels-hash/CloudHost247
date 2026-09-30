<?php
/**
 * Internal failure signal for every Passkey ceremony.
 *
 * Carries a machine-readable code so the HTTP layer can answer with a generic
 * message (never "unknown user", "wrong signature", ... — see SafeResponse)
 * while the security log keeps the precise reason.
 */

namespace CloudHost247\Passkey;

class PasskeyException extends \RuntimeException
{
    /** @var string */
    private $reason;

    public function __construct($message, $reason = 'verification_failed', $previous = null)
    {
        parent::__construct($message, 0, $previous);
        $this->reason = (string) $reason;
    }

    public function reason()
    {
        return $this->reason;
    }
}
