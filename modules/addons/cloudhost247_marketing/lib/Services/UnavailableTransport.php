<?php
namespace CloudHost247\Marketing\Services;

/**
 * The transport used until a real sender is wired in (SESSION 6).
 *
 * It exists so that "we cannot send right now" is a first-class, explainable
 * state instead of a silent success or a fatal error. Every test send through
 * this transport is refused with a reason the administrator can act on, and the
 * refusal is audited — a queue that cannot deliver must say so, never pretend.
 */
final class UnavailableTransport implements MessageTransport
{
    private $reason;

    public function __construct($reason = 'No delivery provider is wired into this build yet.')
    {
        $this->reason = (string) $reason;
    }

    public function key()
    {
        return 'unavailable';
    }

    public function isAvailable()
    {
        return false;
    }

    public function reason()
    {
        return $this->reason;
    }

    public function send(array $message)
    {
        return array('ok' => false, 'error' => $this->reason, 'provider_message_id' => '');
    }
}
