<?php
namespace CloudHost247\Integrations\Api;

/**
 * Transport-level failure. Carries only a coarse, non-sensitive kind
 * (timeout, dns, tls, connect, too_large, error) — never the provider payload,
 * the request URL or any header.
 */
final class TransportException extends \RuntimeException
{
    private $kind;

    public function __construct($kind, $message = 'Provider communication failed.')
    {
        $allowed = array('timeout', 'dns', 'tls', 'connect', 'too_large', 'configuration', 'error');
        $this->kind = in_array($kind, $allowed, true) ? $kind : 'error';
        parent::__construct($message);
    }

    public function kind() { return $this->kind; }
}
