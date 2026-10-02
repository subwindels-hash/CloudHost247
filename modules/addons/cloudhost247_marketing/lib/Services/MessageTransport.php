<?php
namespace CloudHost247\Marketing\Services;

/**
 * The contract between campaign logic and whatever actually delivers a message.
 *
 * Campaign code never talks to SMTP, sockets or the integration vault. It builds
 * a message and asks a transport to send it; the transport owns credentials,
 * timeouts and provider errors. That separation is what lets SESSION 6 swap the
 * refusal transport for the cPanel SMTP sender without touching a single line of
 * campaign, queue or tracking logic — and what keeps credentials out of this
 * module entirely.
 */
interface MessageTransport
{
    /** Stable provider key, e.g. `cpanel_smtp`. */
    public function key();

    /** True only when a message could be handed over right now. */
    public function isAvailable();

    /** Human explanation shown when `isAvailable()` is false. */
    public function reason();

    /**
     * Delivers one fully built message.
     *
     * @param array $message to, to_name, subject, html, text, from_email,
     *                       from_name, reply_to, headers
     * @return array{ok:bool,error:string,provider_message_id:string}
     */
    public function send(array $message);
}
